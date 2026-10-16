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

/**
 * Arms the prayer-time takeover alarms behind the auto-opening adhan page.
 *
 * Each alarm is an exact {@link AlarmManager} wake-up targeting
 * {@link AdhanOverlayReceiver}, which posts a full-screen-intent notification — the
 * sanctioned way for a closed app to put its own activity on the screen. The receiver
 * owns the notification (sound included, via the prayer channel); this plugin owns the
 * arming, and hands the launch/tap payload to JS so the overlay opens on the right
 * prayer.
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

        cancelArmed(alarmManager);
        try {
            armBatch(context, alarmManager, batch);
        } catch (JSONException e) {
            Logger.error(TAG, "Could not arm the adhan alarm batch", e);
            call.reject("بيانات تنبيهات الأذان غير صالحة.", "invalid-alarms");
            return;
        }

        // Kept so the device can restore this exact batch itself after a reboot,
        // an update or an OEM cleanup — see healIfMissing().
        prefs(context).edit().putString(KEY_ARMED_BATCH, batch.toString()).apply();
        AdhanHealJob.register(context);
        call.resolve();
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        cancelArmed((AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE));
        call.resolve();
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
     * @return true when a re-arm actually happened.
     */
    static boolean healIfMissing(Context context) {
        JSONArray batch = storedBatch(context);
        if (batch == null) return false;

        AlarmManager alarmManager =
            (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return false;

        long now = System.currentTimeMillis();
        boolean hasFutureAlarm = false;
        boolean hasMissingAlarm = false;
        try {
            for (int i = 0; i < batch.length(); i += 1) {
                JSONObject alarm = batch.getJSONObject(i);
                if (alarm.optLong("at", 0L) <= now) continue;
                hasFutureAlarm = true;

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
            if (!hasFutureAlarm || !hasMissingAlarm) return false;

            armBatch(context, alarmManager, batch);
            Logger.info(TAG, "One or more future adhan alarms were missing - re-armed the stored batch");
            return true;
        } catch (JSONException e) {
            Logger.error(TAG, "Stored adhan batch is unreadable", e);
            return false;
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
    private static void armBatch(
        Context context, AlarmManager alarmManager, JSONArray batch
    ) throws JSONException {
        boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || alarmManager.canScheduleExactAlarms();
        long now = System.currentTimeMillis();

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

            PendingIntent pending = PendingIntent.getBroadcast(
                context, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            if (canExact) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            }
            armedIds.put(id);
        }
        prefs(context).edit().putString(KEY_ARMED_IDS, armedIds.toString()).apply();
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

        NotificationChannel channel = new NotificationChannel(
            id, name, NotificationManager.IMPORTANCE_HIGH);
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

        call.resolve(out);
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
        return data;
    }

    /** Wipe the extras once consumed, so a later ordinary relaunch does not reopen the page. */
    private static void clearLaunchExtras(Intent intent) {
        if (intent == null || !ACTION_ADHAN.equals(intent.getAction())) return;
        intent.setAction(null);
        intent.removeExtra(AdhanOverlayReceiver.EXTRA_PRAYER_KEY);
        intent.removeExtra(AdhanOverlayReceiver.EXTRA_PRAYER_NAME);
        intent.removeExtra(AdhanOverlayReceiver.EXTRA_TIME);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
