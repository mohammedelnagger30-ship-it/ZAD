package com.hifzi.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Fires at a prayer time: posts the adhan notification and opens the adhan page itself —
 * no tap expected, in either of the two ways Android allows:
 *
 * <ul>
 *   <li><b>direct launch</b> — up to Android 9 a background app may start its own
 *       activity, so {@code startActivity()} brings {@link MainActivity} forward in every
 *       state (locked, screen off, app closed); the activity's window flags wake the
 *       screen and draw over the keyguard. Android 10+ refuses a background start — the
 *       attempt is logged and dropped, never fatal;</li>
 *   <li><b>full-screen intent</b> — the notification carries one, so on every version the
 *       system itself launches the page while the device is locked or idle, and shows a
 *       heads-up banner when it is in use (Android 10+'s fallback for the states where
 *       the direct launch is refused).</li>
 * </ul>
 *
 * The notification is posted to the prayer channel, whose sound is the selected adhan —
 * so it replaces the old scheduled sound notification entirely: one card, one adhan, and
 * the page itself. If the app process happens to be alive, the plugin is also told the
 * prayer arrived so the page opens without waiting for a tap.
 */
public class AdhanOverlayReceiver extends BroadcastReceiver {
    private static final String TAG = "AdhanOverlayReceiver";

    static final String EXTRA_ID = "id";
    static final String EXTRA_CHANNEL_ID = "channelId";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_PRAYER_KEY = "prayerKey";
    static final String EXTRA_PRAYER_NAME = "prayerName";
    static final String EXTRA_TIME = "time";
    static final String EXTRA_TYPE = "type";

    private static final int COLOR_BRAND = 0xFF1F734E;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        final int id = intent.getIntExtra(EXTRA_ID, 0);
        final String channelId = intent.getStringExtra(EXTRA_CHANNEL_ID);
        final String title = intent.getStringExtra(EXTRA_TITLE);
        final String body = intent.getStringExtra(EXTRA_BODY);
        final String prayerKey = intent.getStringExtra(EXTRA_PRAYER_KEY);
        final String prayerName = intent.getStringExtra(EXTRA_PRAYER_NAME);
        final String time = intent.getStringExtra(EXTRA_TIME);

        if (channelId == null || prayerKey == null) {
            Log.w(TAG, "Adhan alarm arrived without a channel or prayer key - dropped.");
            return;
        }

        ensureChannel(context, channelId);

        // Read the type from the alarm intent (defaults to "prayer")
        final String type = intent.getStringExtra(EXTRA_TYPE);
        Intent launch = buildLaunchIntent(context, prayerKey, prayerName, time, type);

        // Tapping the card and the full-screen takeover open the very same page; both
        // carry the prayer so the overlay can show the right one.
        PendingIntent open = PendingIntent.getActivity(
            context,
            id,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(BitmapFactory.decodeResource(
                context.getResources(), R.drawable.ic_notification_large))
            .setColor(COLOR_BRAND)
            .setContentTitle(title != null ? title : context.getString(R.string.app_name))
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setContentIntent(open)
            // The takeover itself: while the device is locked or idle the system launches
            // the activity directly instead of just showing a card.
            .setFullScreenIntent(open, true)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();

        try {
            NotificationManagerCompat.from(context).notify(id, notification);
        } catch (RuntimeException e) {
            // MIUI has been known to throw here (channel/app-op quirks); without the
            // card there is no adhan sound either, so opening a page that believes the
            // notification is ringing would leave the prayer in silence — the page
            // then waits for the next open instead, as it always has.
            Log.e(TAG, "Could not post the adhan notification", e);
            return;
        }

        // Direct launch (works up to Android 9, where a background app may start its own
        // activity): the page comes to the front in every state — locked, screen off, app
        // closed — and the activity's window flags wake the screen over the keyguard.
        // Android 10+ refuses this; the attempt is harmless there and the full-screen
        // intent above is what opens the page instead.
        try {
            context.startActivity(launch);
        } catch (RuntimeException e) {
            Log.w(TAG, "Direct launch refused by the system - full-screen intent takes over", e);
        }

        // App in the foreground: open the page right away instead of waiting for a tap.
        // (No listener when the process was started just for this broadcast — then the
        // full-screen intent is what opens the activity.)
        com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
        data.put("prayerKey", prayerKey);
        if (prayerName != null) data.put("prayerName", prayerName);
        if (time != null) data.put("time", time);
        AdhanOverlay.dispatchReceived(data);
    }

    private static Intent buildLaunchIntent(
        Context context, String prayerKey, String prayerName, String time, String type
    ) {
        Intent launch = new Intent(context, MainActivity.class);
        launch.setAction(AdhanOverlay.ACTION_ADHAN);
        launch.putExtra(EXTRA_PRAYER_KEY, prayerKey);
        if (prayerName != null) launch.putExtra(EXTRA_PRAYER_NAME, prayerName);
        if (time != null) launch.putExtra(EXTRA_TIME, time);
        if (type != null) launch.putExtra(EXTRA_TYPE, type);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return launch;
    }

    /**
     * The channels are created by the JS scheduler; this only guards the cold corner
     * where one is missing (a cleared app data set before the next open), so the
     * notification is never dropped for an unknown channel.
     */
    private static void ensureChannel(Context context, String channelId) {
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(channelId) != null) return;
        NotificationChannel channel = new NotificationChannel(
            channelId, "تنبيهات الصلاة", NotificationManager.IMPORTANCE_HIGH);
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }
}
