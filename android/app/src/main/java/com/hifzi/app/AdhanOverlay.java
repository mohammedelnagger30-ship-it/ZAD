package com.hifzi.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

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

        cancelArmed(alarmManager);

        JSONArray armedIds = new JSONArray();
        boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || alarmManager.canScheduleExactAlarms();

        try {
            for (int i = 0; i < alarms.length(); i += 1) {
                JSObject alarm = new JSObject(alarms.getJSONObject(i).toString());
                int id = alarm.getInt("id");
                long at = alarm.getLong("at");
                String channelId = alarm.getString("channelId");
                String prayerKey = alarm.getString("prayerKey");
                if (channelId == null || prayerKey == null || at <= 0L) continue;

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

                // The JS side hands over a device-clock instant (drift-compensated, the
                // same convention the notification plugin uses): Android alarms always
                // fire against the device clock, so no further correction belongs here.
                if (canExact) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                } else {
                    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                }
                armedIds.put(id);
            }
        } catch (JSONException e) {
            Logger.error(TAG, "Could not read the adhan alarm batch", e);
            call.reject("بيانات تنبيهات الأذان غير صالحة.", "invalid-alarms");
            return;
        }

        prefs().edit().putString(KEY_ARMED_IDS, armedIds.toString()).apply();
        call.resolve();
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        cancelArmed((AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE));
        call.resolve();
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

    /** Called by the receiver: a prayer arrived while the app is in the foreground. */
    static void dispatchReceived(JSObject data) {
        AdhanOverlay plugin = active;
        if (plugin != null) {
            plugin.notifyListeners("adhanReceived", data);
        }
    }

    private void cancelArmed(AlarmManager alarmManager) {
        JSONArray stored;
        try {
            stored = new JSONArray(prefs().getString(KEY_ARMED_IDS, "[]"));
        } catch (JSONException e) {
            stored = new JSONArray();
        }
        if (alarmManager == null) return;

        Context context = getContext();
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
        prefs().edit().remove(KEY_ARMED_IDS).apply();
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

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
