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
 * Fires at a prayer time and posts the adhan notification the system takes over the
 * screen with (full-screen intent — the mechanism alarm clocks use).
 *
 * Android forbids starting an activity from a background process, so this is the only
 * sanctioned way for a closed app to put its own page on the screen at the prayer
 * minute:
 *
 * <ul>
 *   <li>device locked / idle — the intent launches {@link MainActivity} straight into the
 *       adhan page, over the keyguard;</li>
 *   <li>device in use — a heads-up banner appears, and tapping it opens the same page.</li>
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

        // Tapping the card and the full-screen takeover open the very same page; both
        // carry the prayer so the overlay can show the right one.
        PendingIntent open = PendingIntent.getActivity(
            context,
            id,
            buildLaunchIntent(context, prayerKey, prayerName, time),
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
            // MIUI has been known to throw here (channel/app-op quirks); the adhan page
            // can still be opened from the banner-less notification or the next open.
            Log.e(TAG, "Could not post the adhan notification", e);
            return;
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
        Context context, String prayerKey, String prayerName, String time
    ) {
        Intent launch = new Intent(context, MainActivity.class);
        launch.setAction(AdhanOverlay.ACTION_ADHAN);
        launch.putExtra(EXTRA_PRAYER_KEY, prayerKey);
        if (prayerName != null) launch.putExtra(EXTRA_PRAYER_NAME, prayerName);
        if (time != null) launch.putExtra(EXTRA_TIME, time);
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
