package com.hifzi.app;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Arms the prayer-time takeover alarms behind the auto-opening adhan page.
 *
 * Each prayer is an <b>alarm-clock</b> alarm ({@link AlarmManager#setAlarmClock}) targeting
 * {@link AdhanOverlayReceiver}, which posts a full-screen-intent notification — the
 * sanctioned way for a closed app to put its own activity on the screen. The alarm-clock
 * API (rather than a plain exact alarm) is what makes the adhan survive the OEM battery
 * cleaners on Xiaomi/Oppo/Huawei skins, which otherwise drop a closed app's alarms
 * without a word. The receiver owns the notification (sound included, via the prayer
 * channel); this plugin owns the arming, and hands the launch/tap payload to JS so the
 * overlay opens on the right prayer.
 *
 * The JS scheduler calls {@code schedule()} with the whole drift-compensated batch on
 * every rebuild (mirroring the notification queue's swap semantics) and
 * {@code cancelAll()} when notifications are off.
 */
@CapacitorPlugin(name = "AdhanOverlay")
public class AdhanOverlay extends Plugin {

    static final String ACTION_ADHAN = "com.hifzi.app.action.ADHAN";

    private static final String TAG = "AdhanOverlay";
    private static final String PREFS = "adhan_overlay";
    private static final String KEY_ARMED_IDS = "armedIds";
    /**
     * The last batch JS armed, verbatim. Android wipes a package's alarms on
     * reboot, on update and whenever an OEM cleaner feels lucky — this copy is
     * what lets {@link BootReceiver} and {@link AdhanHealJob} put them back
     * with no WebView and no user action.
     */
    private static final String KEY_ARMED_BATCH = "armedBatch";

    /**
     * Slack allowed between the soonest stored prayer and the system's next alarm clock
     * when deciding whether the batch was dropped — see {@link #healIfMissing}.
     */
    private static final long ALARM_CLOCK_SLACK_MS = 60_000L;

    /**
     * Serialises every arm/cancel pass.
     *
     * The JS side rebuilds the queue from several places at once — app open, every
     * resume, every clock correction, every settings change — and two overlapping passes
     * used to interleave their cancel and arm phases: the second pass cancelled a list of
     * ids the first had not written yet, so the first pass's alarms survived as orphans
     * nothing could ever cancel again. One lock, and the phases always pair.
     */
    private static final Object LOCK = new Object();

    /**
     * Ids this plugin never hands out: the self-test alarm's own request code.
     *
     * It sits at the very top of the million reserved for the native side, above the
     * «تأخّر التنبيه» notices — see `AdhanOverlayReceiver.lateRequestId` for the layout
     * of that block. A self-test card and a late notice must never be able to replace
     * one another: the reader would see a test and read it as a real report, or the
     * other way round.
     */
    static final int TEST_ALARM_ID = 8_999_999;

    /** The live plugin instance, so the receiver can reach JS while the app is open. */
    private static volatile AdhanOverlay active;

    @Override
    public void load() {
        active = this;
        // Cold start straight from the full-screen intent: Capacitor replays a retained
        // event to whoever subscribes later, so JS gets it once its listeners attach.
        consumeLaunchIntent(getActivity() != null ? getActivity().getIntent() : null, true);
    }

    @Override
    public void handleOnNewIntent(Intent intent) {
        // singleTask reuse: a tap on the card (or the takeover while the app is alive)
        // arrives here with fresh extras.
        consumeLaunchIntent(intent, false);
    }

    @Override
    protected void handleOnResume() {
        // A retained event nobody consumed (page already closed by then) must not
        // reopen the adhan page on the next resume.
        clearLaunchExtras(getActivity() != null ? getActivity().getIntent() : null);
    }

    @Override
    protected void handleOnDestroy() {
        active = null;
        super.handleOnDestroy();
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray alarms = call.getArray("alarms");
        if (alarms == null) {
            call.reject("قائمة تنبيهات الأذان مطلوبة.", "invalid-alarms");
            return;
        }

        Context context = getContext();
        AlarmManager alarmManager =
            (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            call.reject("تعذّر الوصول إلى خدمة المنبهات.", "alarm-manager-unavailable");
            return;
        }

        JSONArray batch;
        try {
            batch = new JSONArray(alarms.toString());
        } catch (JSONException e) {
            Logger.error(TAG, "Could not read the adhan alarm batch", e);
            call.reject("بيانات تنبيهات الأذان غير صالحة.", "invalid-alarms");
            return;
        }

        synchronized (LOCK) {
            cancelArmed(alarmManager);
            ArmResult armed;
            try {
                armed = armBatch(context, alarmManager, batch);
            } catch (JSONException e) {
                Logger.error(TAG, "Could not arm the adhan alarm batch", e);
                call.reject("بيانات تنبيهات الأذان غير صالحة.", "invalid-alarms");
                return;
            }

            // Kept so the device can restore this exact batch itself after a reboot,
            // an update or an OEM cleanup — see healIfMissing().
            prefs(context).edit().putString(KEY_ARMED_BATCH, batch.toString()).apply();
            AdhanHealJob.register(context);

            // Arming is not the same as being armed. `armBatch` swallows nothing — it
            // skips what it cannot arm and downgrades when exact alarms are revoked — so
            // the answer is handed back: JS keeps its sound fallbacks when the takeover
            // is inexact or unverifiable, and warns the reader instead of assuming a
            // silent prayer will ring.
            call.resolve(verification(context, alarmManager, armed));
        }
    }

    /**
     * What {@link #armBatch} actually managed, and whether the system really holds it.
     *
     * `verified` asks the platform rather than trusting the return of the arming call:
     * `getNextAlarmClock()` reports the soonest alarm-clock alarm on file for this
     * package, and nothing else in the app arms one — so if that row is not the prayer
     * we just armed, the batch did not stick.
     */
    private static JSObject verification(
        Context context, AlarmManager alarmManager, ArmResult armed
    ) {
        boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || alarmManager.canScheduleExactAlarms();
        boolean verified = false;
        if (canExact && armed.soonestAt != Long.MAX_VALUE) {
            try {
                AlarmManager.AlarmClockInfo next = alarmManager.getNextAlarmClock();
                verified = next != null
                    && Math.abs(next.getTriggerTime() - armed.soonestAt) <= ALARM_CLOCK_SLACK_MS;
            } catch (RuntimeException e) {
                Logger.warn(TAG, "Could not verify the armed adhan alarms: " + e.getMessage());
            }
        }
        JSObject out = new JSObject();
        out.put("armed", armed.armed);
        out.put("inexact", armed.inexact);
        out.put("verified", verified);
        return out;
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        synchronized (LOCK) {
            cancelArmed((AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE));
        }
        call.resolve();
    }

    /**
     * Arms one throwaway alarm through the very same receiver the adhan uses.
     *
     * The self test this exists for is the only honest answer to «هل الأذان شغّال على
     * ده الموبايل؟»: it exercises the whole chain — the platform's alarm-clock
     * registration, the receiver, the prayer channel's sound, the full-screen takeover
     * and the page — in seconds, on whatever phone is in hand. It never touches the armed
     * batch, its own request code sits outside every notification id range, and JS opens
     * the page it raises as a *preview*, so a test can never stamp a record onto a prayer.
     */
    @PluginMethod
    public void testAlarm(PluginCall call) {
        Context context = getContext();
        AlarmManager alarmManager =
            (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            call.reject("تعذّر الوصول إلى خدمة المنبهات.", "alarm-manager-unavailable");
            return;
        }

        String channelId = call.getString("channelId");
        String prayerKey = call.getString("prayerKey");
        String prayerName = call.getString("prayerName");
        String title = call.getString("title");
        String body = call.getString("body");
        String sound = call.getString("sound");
        String soundPath = call.getString("soundPath");
        Integer delayMs = call.getInt("delayMs");
        if (channelId == null || prayerKey == null || title == null) {
            call.reject("بيانات اختبار الأذان غير مكتملة.", "invalid-alarms");
            return;
        }

        long at = System.currentTimeMillis() + (delayMs != null ? Math.max(delayMs, 1_000) : 10_000);
        Intent intent = new Intent(context, AdhanOverlayReceiver.class);
        intent.setAction(ACTION_ADHAN);
        intent.putExtra(AdhanOverlayReceiver.EXTRA_ID, TEST_ALARM_ID);
        intent.putExtra(AdhanOverlayReceiver.EXTRA_CHANNEL_ID, channelId);
        intent.putExtra(AdhanOverlayReceiver.EXTRA_TITLE, title);
        intent.putExtra(AdhanOverlayReceiver.EXTRA_BODY, body != null ? body : title);
        intent.putExtra(AdhanOverlayReceiver.EXTRA_PRAYER_KEY, prayerKey);
        if (prayerName != null) intent.putExtra(AdhanOverlayReceiver.EXTRA_PRAYER_NAME, prayerName);
        // The instant is taken from the same clock the alarm is armed on, not from the
        // one JS read it from: the receiver compares the two, and a clock that differs
        // by even a few seconds would have the test report itself as a late alarm.
        intent.putExtra(AdhanOverlayReceiver.EXTRA_TIME, isoInstant(at));
        intent.putExtra(AdhanOverlayReceiver.EXTRA_TYPE, "test");
        intent.putExtra(AdhanOverlayReceiver.EXTRA_SOUND, sound);
        intent.putExtra(AdhanOverlayReceiver.EXTRA_SOUND_PATH, soundPath);

        PendingIntent pending = PendingIntent.getBroadcast(
            context, TEST_ALARM_ID, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || alarmManager.canScheduleExactAlarms();
        if (canExact) {
            alarmManager.setAlarmClock(
                new AlarmManager.AlarmClockInfo(at, showIntent(context, TEST_ALARM_ID, intent)),
                pending);
        } else {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        }

        JSObject out = new JSObject();
        out.put("at", at);
        out.put("exact", canExact);
        // The same shape the batch answer uses, so a caller can treat the self-test
        // and the real schedule the same way: an alarm that could only be armed
        // inexactly may not ring on time, and the reader has to be told which it was.
        out.put("armed", 1);
        out.put("inexact", !canExact);
        out.put("verified", canExact);
        call.resolve(out);
    }

    /**
     * Re-arms the stored batch when the alarms it created are gone.
     *
     * Reboots and app updates wipe a package's alarms, and several OEM skins
     * (MIUI, EMUI, ColorOS and relatives) drop them whenever they "clean" the
     * process out of memory — no broadcast announces any of it, and until the
     * person happened to open the app the adhan would simply stay silent. This
     * puts the batch back straight from storage: no WebView, no visible launch,
     * no user action. A user's own force-stop remains unreachable by design
     * (Android sleeps the app until the person opens it again), and the next
     * open re-arms everything anyway.
     *
     * "Gone" is judged by the platform's alarm-clock registration rather than by
     * the armed intents alone: a PendingIntent outlives its alarm, so the intents
     * can all still be found while the OEM has already dropped every prayer (see
     * the probe inside).
     *
     * @return true when a re-arm actually happened.
     */
    static boolean healIfMissing(Context context) {
        JSONArray batch = storedBatch(context);
        if (batch == null) return false;

        AlarmManager alarmManager =
            (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return false;

        synchronized (LOCK) {
            long now = System.currentTimeMillis();
            long soonestFuture = Long.MAX_VALUE;
            boolean hasMissingAlarm = false;
            try {
                for (int i = 0; i < batch.length(); i += 1) {
                    JSONObject alarm = batch.getJSONObject(i);
                    long at = alarm.optLong("at", 0L);
                    if (at <= now) continue;
                    soonestFuture = Math.min(soonestFuture, at);

                    int id = alarm.optInt("id", -1);
                    if (id < 0) {
                        Logger.warn(TAG, "Stored future adhan alarm has no valid id");
                        return false;
                    }
                    Intent probe = new Intent(context, AdhanOverlayReceiver.class);
                    probe.setAction(ACTION_ADHAN);
                    PendingIntent armed = PendingIntent.getBroadcast(
                        context, id, probe, PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
                    if (armed == null) hasMissingAlarm = true;
                }
                if (soonestFuture == Long.MAX_VALUE) return false;

                // The intent probe above cannot see the failure this job exists for: a
                // PendingIntent outlives the alarm behind it (the system keeps the intent
                // until someone cancels *it*), so an OEM that drops a package's alarms leaves
                // every probe alive while the prayers themselves are gone. The alarm-clock
                // registration is the question worth asking instead — `getNextAlarmClock()`
                // reports the soonest alarm-clock alarm actually on file for this package, and
                // nothing else in the app arms one, so if the soonest stored prayer is not it,
                // the batch was dropped. (Where exact alarms are not permitted the batch goes
                // out via `setAndAllowWhileIdle`, which this API cannot see; the intent probe
                // is all that corner allows, and the protection banner pushes for the grant.)
                boolean clockDropped = false;
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                    || alarmManager.canScheduleExactAlarms()) {
                    // Guarded all the way: some builds restrict this query, and a heal pass that
                    // throws is a heal pass that leaves the prayers unarmed.
                    try {
                        AlarmManager.AlarmClockInfo next = alarmManager.getNextAlarmClock();
                        long nextAt = next != null ? next.getTriggerTime() : Long.MAX_VALUE;
                        clockDropped = nextAt > soonestFuture + ALARM_CLOCK_SLACK_MS;
                    } catch (RuntimeException e) {
                        Logger.warn(TAG, "Could not read the next alarm clock: " + e.getMessage());
                    }
                }

                if (!hasMissingAlarm && !clockDropped) return false;

                armBatch(context, alarmManager, batch);
                Logger.info(TAG, "One or more future adhan alarms were missing - re-armed the stored batch");
                return true;
            } catch (JSONException e) {
                Logger.error(TAG, "Stored adhan batch is unreadable", e);
                return false;
            }
        }
    }

    /** What one {@link #armBatch} pass actually put on the platform. */
    private static final class ArmResult {
        /** How many alarms were armed (past ones are skipped on purpose). */
        final int armed;
        /** True when at least one went out inexact — exact alarms not permitted. */
        final boolean inexact;
        /** The soonest armed instant, device-clock side; {@link Long#MAX_VALUE} when none. */
        final long soonestAt;

        ArmResult(int armed, boolean inexact, long soonestAt) {
            this.armed = armed;
            this.inexact = inexact;
            this.soonestAt = soonestAt;
        }
    }

    /**
     * Arms one batch and records its ids for {@link #cancelArmed}. Alarms whose
     * instant has already passed are skipped: re-arming one would ring the adhan
     * on the spot.
     *
     * The instants arrive device-clock-side and drift-compensated (the same
     * convention the notification plugin uses): Android alarms always fire
     * against the device clock, so no further correction belongs here.
     */
    private static ArmResult armBatch(
        Context context, AlarmManager alarmManager, JSONArray batch
    ) throws JSONException {
        boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || alarmManager.canScheduleExactAlarms();
        long now = System.currentTimeMillis();

        int armed = 0;
        long soonestAt = Long.MAX_VALUE;
        JSONArray armedIds = new JSONArray();
        for (int i = 0; i < batch.length(); i += 1) {
            JSObject alarm = new JSObject(batch.getJSONObject(i).toString());
            int id = alarm.getInt("id");
            long at = alarm.getLong("at");
            String channelId = alarm.getString("channelId");
            String prayerKey = alarm.getString("prayerKey");
            if (channelId == null || prayerKey == null || at <= 0L || at <= now) continue;

            Intent intent = new Intent(context, AdhanOverlayReceiver.class);
            intent.setAction(ACTION_ADHAN);
            intent.putExtra(AdhanOverlayReceiver.EXTRA_ID, id);
            intent.putExtra(AdhanOverlayReceiver.EXTRA_CHANNEL_ID, channelId);
            intent.putExtra(AdhanOverlayReceiver.EXTRA_TITLE, alarm.getString("title"));
            intent.putExtra(AdhanOverlayReceiver.EXTRA_BODY, alarm.getString("body"));
            intent.putExtra(AdhanOverlayReceiver.EXTRA_PRAYER_KEY, prayerKey);
            intent.putExtra(AdhanOverlayReceiver.EXTRA_PRAYER_NAME, alarm.getString("prayerName"));
            intent.putExtra(AdhanOverlayReceiver.EXTRA_TIME, alarm.getString("time"));
            // The channel's sound rides along, so the receiver can build the channel
            // *with* it if the channel is missing. Android fixes a channel's sound at
            // creation, so a channel the receiver mints without one stays silent for
            // good — which is how a cleared app data set turned into «التنبيه بيوصل من
            // غير صوت» with no way back.
            intent.putExtra(AdhanOverlayReceiver.EXTRA_SOUND, alarm.getString("sound"));
            intent.putExtra(AdhanOverlayReceiver.EXTRA_SOUND_PATH, alarm.getString("soundPath"));
            // Type defaults to "prayer" for backwards compatibility
            String type = alarm.has("type") ? alarm.getString("type") : "prayer";
            intent.putExtra(AdhanOverlayReceiver.EXTRA_TYPE, type);

            PendingIntent pending = PendingIntent.getBroadcast(
                context, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            if (canExact) {
                // `setAlarmClock`, not `setExactAndAllowWhileIdle`.
                //
                // Both are exact and both survive Doze, but only the alarm-clock API is
                // something the *system* treats as a clock the person set and is waiting
                // for. Ordinary exact alarms — including `setExactAndAllowWhileIdle` — are
                // still fair game for the OEM "battery cleaners" on MIUI, ColorOS, EMUI and
                // friends: they drop a package's alarms without any broadcast, which is
                // exactly the «الأذان ما بيطلعش والتطبيق مغلق» report. An alarm-clock
                // alarm is instead held to the same standard as the built-in clock, is
                // exempt from the doze idle-quota that defers the ordinary kind, and puts
                // this app in the platform's allowlist to start work from the background
                // (the full-screen takeover that follows it needs that standing).
                alarmManager.setAlarmClock(
                    new AlarmManager.AlarmClockInfo(at, showIntent(context, id, intent)),
                    pending);
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            }
            armed += 1;
            soonestAt = Math.min(soonestAt, at);
            armedIds.put(id);
        }
        prefs(context).edit().putString(KEY_ARMED_IDS, armedIds.toString()).apply();
        return new ArmResult(armed, !canExact && armed > 0, soonestAt);
    }

    /**
     * The intent behind the system's own «next alarm» row (status bar, lock screen,
     * the built-in clock's list). It must open an <em>activity</em> — handing it the
     * broadcast above would make that row fire a receiver the system already fired,
     * so it is a launch of the adhan page instead, carrying the same prayer.
     *
     * It used to be built from the receiver-targeting intent, which no activity can be
     * resolved from: the row appeared (an alarm-clock alarm always puts one there) and
     * tapping it did nothing at all. The payload now rides a real launch of
     * {@link MainActivity}, the same one the card and the takeover carry.
     */
    private static PendingIntent showIntent(Context context, int id, Intent receiver) {
        Intent launch = new Intent(context, MainActivity.class);
        launch.setAction(receiver.getAction());
        launch.putExtra(AdhanOverlayReceiver.EXTRA_ID, receiver.getIntExtra(AdhanOverlayReceiver.EXTRA_ID, id));
        copyExtra(receiver, launch, AdhanOverlayReceiver.EXTRA_CHANNEL_ID);
        copyExtra(receiver, launch, AdhanOverlayReceiver.EXTRA_TITLE);
        copyExtra(receiver, launch, AdhanOverlayReceiver.EXTRA_BODY);
        copyExtra(receiver, launch, AdhanOverlayReceiver.EXTRA_PRAYER_KEY);
        copyExtra(receiver, launch, AdhanOverlayReceiver.EXTRA_PRAYER_NAME);
        copyExtra(receiver, launch, AdhanOverlayReceiver.EXTRA_TIME);
        copyExtra(receiver, launch, AdhanOverlayReceiver.EXTRA_TYPE);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            context, id, launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static void copyExtra(Intent from, Intent to, String key) {
        String value = from.getStringExtra(key);
        if (value != null) to.putExtra(key, value);
    }

    /**
     * An instant as the ISO-8601 form the JS side sends and the receiver parses.
     *
     * The exact shape {@code Date#toISOString()} produces, because the receiver reads
     * it back with a matching pattern — a different format would make the self-test
     * report itself as a late alarm.
     */
    private static String isoInstant(long epochMs) {
        SimpleDateFormat format =
            new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(epochMs));
    }

    private static JSONArray storedBatch(Context context) {
        String raw = prefs(context).getString(KEY_ARMED_BATCH, null);
        if (raw == null) return null;
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return null;
        }
    }

    /**
     * Creates (or updates) a prayer channel whose sound is a file stored by the app.
     *
     * A channel's sound must be an Android resource, so a voice the user downloaded
     * cannot go through the notification plugin's channel builder: a raw path or a URL
     * there resolves to nothing and the prayer comes in silent. The stored file is
     * handed to the system through the app's FileProvider — the same route the plugin
     * uses for bundled web assets — with {@code res/xml/file_paths.xml} covering the
     * {@code adhan_store/} directory this store writes into.
     */
    @PluginMethod
    public void setChannel(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }

        String id = call.getString("id");
        String name = call.getString("name");
        String soundPath = call.getString("soundPath");
        if (id == null || name == null || soundPath == null) {
            call.reject("بيانات قناة الأذان غير مكتملة.", "invalid-channel");
            return;
        }

        File sound = new File(soundPath);
        if (!sound.isFile() || sound.length() == 0L) {
            call.reject("ملف صوت الأذان غير موجود.", "missing-sound");
            return;
        }

        Uri soundUri = FileProvider.getUriForFile(
            getContext(), getContext().getPackageName() + ".fileprovider", sound);

        // A FileProvider URI is readable only by whoever holds a grant — and the file is
        // opened by the *system* when the channel rings, not by this app. Without a grant
        // the notification arrives and simply stays silent on a number of devices, at
        // prayer time, which is the one moment silence is not an option. Granting is
        // best-effort: a ROM that refuses still gets the channel exactly as before.
        grantUriReadToSoundPlayers(soundUri);

        // Callers that are not a prayer — the hifz/review/hadith/azkar reminder
        // channels — pass their own importance, because «تذكير مراجعة» has no business
        // taking over the screen the way a prayer does. Default stays HIGH for the adhan.
        Integer requestedImportance = call.getInt("importance");
        int importance = requestedImportance != null
            ? requestedImportance
            : NotificationManager.IMPORTANCE_HIGH;

        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription(call.getString("description"));
        channel.enableVibration(true);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        channel.setSound(soundUri, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());

        NotificationManager manager = (NotificationManager)
            getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            call.reject("تعذّر الوصول إلى خدمة الإشعارات.", "notification-manager-unavailable");
            return;
        }
        manager.createNotificationChannel(channel);
        call.resolve();
    }

    /**
     * Let the packages that actually play a channel's sound read its file.
     *
     * Channel audio is opened by whoever owns the ringing — the system UI, not this app —
     * so a {@code content://} URI needs an explicit read grant or it resolves to nothing.
     * The exact package differs per ROM, so each is attempted and none is required: a
     * failure leaves the channel exactly as it was before this call existed.
     */
    private void grantUriReadToSoundPlayers(Uri soundUri) {
        String[] players = {
            "com.android.systemui",
            getContext().getPackageName(),
        };
        for (String player : players) {
            try {
                getContext().grantUriPermission(
                    player, soundUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {
                // Some ROMs refuse cross-package grants for a non-exported provider.
                // The channel below is created either way — silence, but never a crash
                // on the path that used to work.
            }
        }
    }

    /**
     * Hold the screen while the adhan page is showing ({@code on: true}) and hand it
     * back when the page closes ({@code on: false}).
     *
     * The takeover already wakes the screen, but Android's timeout would put it back to
     * sleep while the call is still in the air — a page nobody is touching looks dead.
     * The flag lives on the window, so backgrounding the app releases it on its own;
     * JS additionally caps the hold so a page left open cannot keep the display lit
     * all night.
     */
    @PluginMethod
    public void setKeepScreenOn(PluginCall call) {
        Boolean on = call.getBoolean("on");
        Activity activity = getActivity();
        if (activity == null || on == null) {
            call.reject("طلب إبقاء الشاشة مضاءة غير مكتمل.", "invalid-keep-screen-on");
            return;
        }
        activity.runOnUiThread(() -> {
            if (on) {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            call.resolve();
        });
    }

    /**
     * Whether anything sits between this app and a ringing phone: notifications
     * switched off in the system, exact-alarm permission revoked (Android 12+),
     * or battery optimisation free to postpone everything until morning. The JS
     * side turns this into a banner whose fixes are one tap each — no reader
     * should have to know which of their phone's settings screens is the one
     * keeping the adhan silent.
     */
    @PluginMethod
    public void protectionStatus(PluginCall call) {
        Context context = getContext();
        JSObject out = new JSObject();

        out.put("notificationsEnabled",
            NotificationManagerCompat.from(context).areNotificationsEnabled());

        AlarmManager alarmManager =
            (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        out.put("exactAlarmsAllowed", alarmManager != null
            && (Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                || alarmManager.canScheduleExactAlarms()));

        NotificationManager notificationManager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        out.put("fullScreenIntentAllowed", notificationManager != null
            && (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                || notificationManager.canUseFullScreenIntent()));

        boolean ignoringBattery = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            ignoringBattery = powerManager != null
                && powerManager.isIgnoringBatteryOptimizations(context.getPackageName());
        }
        out.put("ignoringBatteryOptimizations", ignoringBattery);

        // Three more silencers, and the three that explain «التنبيه بيوصل من غير صوت»
        // almost every time. Each of them is invisible to a WebView: the notification is
        // posted perfectly, the card stands there, and not a sound comes out. They are
        // read here so the settings page can say which one it is and open its fix.
        out.put("dndActive", isDndActive(context));
        out.put("ringerSilent", isRingerSilent(context));

        // Optional: a specific prayer channel's own sound. Android channels are immutable
        // once created, so a channel minted before the adhan sound existed stays silent
        // forever no matter what the app does afterwards — only deleting and rebuilding
        // it fixes that. The two answers are kept apart on purpose: `channelSoundOk` is
        // the app's own bug (repaired silently by the scheduler), while `channelMuted`
        // is a choice the reader made in the system settings, which the app must report
        // and never quietly undo.
        String channelId = call.getString("channelId");
        if (channelId != null && !channelId.isEmpty()) {
            out.put("channelSoundOk", channelHasSound(context, channelId));
            out.put("channelMuted", channelIsMuted(context, channelId));
        }

        call.resolve(out);
    }

    /**
     * Do Not Disturb is on: every notification the app posts arrives in silence, including
     * the adhan. The single most common cause of «بيوصل من غير صوت» on Xiaomi and Samsung.
     */
    private static boolean isDndActive(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return false;
        try {
            return manager.getCurrentInterruptionFilter()
                != NotificationManager.INTERRUPTION_FILTER_ALL;
        } catch (SecurityException e) {
            // Reading the filter needs notification-policy access on some ROMs; without
            // it the answer is simply "unknown", reported as "not blocking" so the
            // banner never invents a problem the device did not report.
            return false;
        }
    }

    /** The phone is on vibrate or silent: the channel's sound exists but nothing sounds. */
    private static boolean isRingerSilent(Context context) {
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return false;
        try {
            return audio.getRingerMode() != AudioManager.RINGER_MODE_NORMAL;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * Whether the named channel carries a sound the <i>app</i> gave it.
     *
     * A channel with no sound posts a card that can never be heard, and Android offers
     * no way to add one after creation. That state is only ever the app's own doing —
     * a channel minted before the adhan sound existed, or by the receiver's fallback —
     * so it is reported separately from a channel the reader themselves muted, which
     * is a preference and must not be repaired out from under them.
     */
    private static boolean channelHasSound(Context context, String channelId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return true;
        NotificationChannel channel = manager.getNotificationChannel(channelId);
        // A channel the app has not created yet: JS is about to create it with a sound.
        if (channel == null) return true;
        return channel.getSound() != null;
    }

    /**
     * Whether the reader silenced this channel themselves, in the system settings.
     *
     * The app must not undo this: someone who switched the adhan's channel off has
     * said what they want, and deleting the channel to get the sound back would be
     * overriding them. It is reported so the settings page can name it — and so the
     * adhan page knows to speak the call itself, since nothing else will.
     */
    private static boolean channelIsMuted(Context context, String channelId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return false;
        NotificationChannel channel = manager.getNotificationChannel(channelId);
        if (channel == null) return false;
        return channel.getImportance() == NotificationManager.IMPORTANCE_NONE;
    }

    /**
     * Opens the system screen that fixes a problem {@link #protectionStatus}
     * reports — the notification settings, the battery-exemption prompt, the
     * exact-alarm settings, or MIUI's autostart screen. Anything the ROM does
     * not have falls through to the app details page, which every Android
     * ships, so a tap never ends in a dead end.
     */
    @PluginMethod
    public void openProtectionSettings(PluginCall call) {
        String target = call.getString("target");
        Context context = getContext();

        try {
            context.startActivity(protectionIntent(target));
        } catch (ActivityNotFoundException | SecurityException e) {
            try {
                context.startActivity(appDetailsIntent());
            } catch (Exception fallback) {
                call.reject("تعذّر فتح إعدادات الجهاز.", "settings-unavailable");
                return;
            }
        }
        call.resolve();
    }

    private Intent protectionIntent(String target) {
        Context context = getContext();
        if ("notifications".equals(target)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                return new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
            }
            return appDetailsIntent();
        }
        if ("exact".equals(target)) {
            return new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                .setData(Uri.parse("package:" + context.getPackageName()));
        }
        if ("full-screen".equals(target)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                return new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                    .setData(Uri.parse("package:" + context.getPackageName()));
            }
            return new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        }
        if ("battery".equals(target)) {
            // The system's own exemption prompt — the only route that does not
            // send the reader hunting through three settings screens.
            return new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:" + context.getPackageName()));
        }
        if ("autostart".equals(target)) {
            // MIUI's autostart screen: the one switch that decides whether this
            // app may ring at all on Xiaomi phones. Not every ROM has one, and
            // the fallback below is what keeps that harmless.
            return new Intent("miui.intent.action.OP_AUTO_START")
                .setPackage("com.miui.securitycenter");
        }
        if ("dnd".equals(target)) {
            // Do Not Disturb is the invisible silencer: the card arrives, the sound
            // never does. There is no per-app screen for it, so the reader is taken to
            // the master toggle and told in the banner what to look for there.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
            }
            return appDetailsIntent();
        }
        if ("sound".equals(target)) {
            // The ringer itself: a phone on vibrate or «صامت» plays the channel's sound
            // into nothing. One screen, no hunting.
            return new Intent(Settings.ACTION_SOUND_SETTINGS);
        }
        return appDetailsIntent();
    }

    private Intent appDetailsIntent() {
        return new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getContext().getPackageName()));
    }

    /** Called by the receiver: a prayer arrived while the app is in the foreground. */
    static void dispatchReceived(JSObject data) {
        AdhanOverlay plugin = active;
        if (plugin != null) {
            plugin.notifyListeners("adhanReceived", data);
        }
    }

    private void cancelArmed(AlarmManager alarmManager) {
        Context context = getContext();
        JSONArray stored;
        try {
            stored = new JSONArray(prefs(context).getString(KEY_ARMED_IDS, "[]"));
        } catch (JSONException e) {
            stored = new JSONArray();
        }
        if (alarmManager == null) return;

        for (int i = 0; i < stored.length(); i += 1) {
            int id = stored.optInt(i, -1);
            if (id < 0) continue;
            // PendingIntent identity ignores extras, so the bare component intent with
            // the same request code matches the armed one.
            Intent intent = new Intent(context, AdhanOverlayReceiver.class);
            intent.setAction(ACTION_ADHAN);
            PendingIntent pending = PendingIntent.getBroadcast(
                context, id, intent, PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (pending != null) {
                alarmManager.cancel(pending);
                pending.cancel();
            }
        }
        prefs(context).edit().remove(KEY_ARMED_IDS).apply();
    }

    private void consumeLaunchIntent(Intent intent, boolean retained) {
        JSObject data = launchPayload(intent);
        if (data == null) return;
        // A retained launch survives until JS subscribes; a reuse while the app is open
        // is delivered to the listeners already attached.
        notifyListeners("adhanLaunch", data, retained);
        clearLaunchExtras(intent);
    }

    private static JSObject launchPayload(Intent intent) {
        if (intent == null || !ACTION_ADHAN.equals(intent.getAction())) return null;
        String prayerKey = intent.getStringExtra(AdhanOverlayReceiver.EXTRA_PRAYER_KEY);
        if (prayerKey == null) return null;
        JSObject data = new JSObject();
        data.put("prayerKey", prayerKey);
        String prayerName = intent.getStringExtra(AdhanOverlayReceiver.EXTRA_PRAYER_NAME);
        if (prayerName != null) data.put("prayerName", prayerName);
        String time = intent.getStringExtra(AdhanOverlayReceiver.EXTRA_TIME);
        if (time != null) data.put("time", time);
        String type = intent.getStringExtra(AdhanOverlayReceiver.EXTRA_TYPE);
        if (type != null) data.put("type", type);
        // Present only on a direct launch, which can happen even when the card could not be
        // posted (Android 9 and older). Absent means the alarm came with a posted card —
        // the full-screen intent cannot fire without one — so the page stays quiet for it.
        if (intent.hasExtra(AdhanOverlayReceiver.EXTRA_RINGING)) {
            data.put("ringing", intent.getBooleanExtra(AdhanOverlayReceiver.EXTRA_RINGING, true));
        }
        return data;
    }

    /** Wipe the extras once consumed, so a later ordinary relaunch does not reopen the page. */
    private static void clearLaunchExtras(Intent intent) {
        if (intent == null || !ACTION_ADHAN.equals(intent.getAction())) return;
        intent.setAction(null);
        intent.removeExtra(AdhanOverlayReceiver.EXTRA_PRAYER_KEY);
        intent.removeExtra(AdhanOverlayReceiver.EXTRA_PRAYER_NAME);
        intent.removeExtra(AdhanOverlayReceiver.EXTRA_TIME);
        intent.removeExtra(AdhanOverlayReceiver.EXTRA_TYPE);
        intent.removeExtra(AdhanOverlayReceiver.EXTRA_RINGING);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
