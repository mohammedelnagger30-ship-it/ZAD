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
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.text.format.DateFormat;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

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
 *
 * The alarm carries the prayer's <b>true</b> instant, so this receiver can also judge
 * whether it is still that instant. A phone that deferred the alarm (Doze, an OEM
 * cleaner, exact alarms revoked so the batch went out inexact) used to ring the adhan
 * whenever it finally woke up — which is the «أذان العصر رنّ وقت المغرب» report. Past
 * {@link #MISFIRED_AFTER_MS} the moment is history: the caller gets a plain «تأخّر
 * التنبيه» card instead of a call to prayer nobody is being called to, and the adhan page
 * stays down rather than claiming «الآن» for a prayer long finished.
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
    /**
     * The channel's sound, when the alarm knows it: a bundled res/raw name for a stock
     * voice ({@code adhan_makkah_masjid.mp3}), or an absolute path for one the reader
     * downloaded. {@link #ensureChannel} needs it because a channel minted without a
     * sound stays silent forever — Android fixes a channel's sound at creation and
     * refuses every later attempt to add one, so the fallback channel this method
     * creates used to ring nothing at all on a phone whose app data was cleared.
     */
    static final String EXTRA_SOUND = "sound";
    /** Absolute path of a downloaded voice — the FileProvider route, see {@link #ensureChannel}. */
    static final String EXTRA_SOUND_PATH = "soundPath";
    /** Whether the card above rang: {@code false} makes the page speak the call itself. */
    static final String EXTRA_RINGING = "ringing";

    /**
     * How far outside its own instant an alarm may still be treated as <i>the</i> call.
     *
     * Mirrors {@code NATIVE_OPEN_MAX_LATE_MS} on the JS side. A full-screen takeover
     * lands at the instant itself and a cold start adds seconds, so an alarm that only
     * surfaced minutes later is history, not a moment: a phone that only woke up at
     * Maghrib must not call Asr as though it were happening now.
     * Inside the window the ring is kept — Doze and an OEM deferring an alarm by a
     * minute or two is ordinary, and a slightly late adhan is still the adhan.
     */
    static final long MISFIRED_AFTER_MS = 15 * 60_000L;

    /**
     * Channel of the «تأخّر التنبيه» card. It is deliberately not the adhan's channel:
     * this card reports that an alarm was late, it is not itself a call to prayer, so it
     * must not sing the adhan and must not take the screen over.
     */
    static final String LATE_CHANNEL_ID = "prayer-late";

    private static final String LATE_CHANNEL_NAME = "تنبيه متأخّر";
    private static final String LATE_CHANNEL_SOUND = "notification";

    /** The alarm and its instant agree — the ordinary case. */
    private static final long ON_TIME = 0L;

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

        // The instant the alarm names and the instant the device is in must still agree.
        // When they do not, this is not the call: it is a report about an alarm that came
        // too late (an OEM deferral, inexact alarms, a clock that moved), and it is
        // reported as such below instead of being sung and taken over the screen with.
        final long misfiredBy = misfireByMs(time);
        if (misfiredBy != ON_TIME) {
            Log.w(TAG, "Adhan alarm arrived " + misfiredBy + " ms off its instant - reported, not called.");
            postMisfiredNotice(context, id, prayerName, time, misfiredBy);
            return;
        }

        ensureChannel(context, channelId, intent.getStringExtra(EXTRA_SOUND),
            intent.getStringExtra(EXTRA_SOUND_PATH));

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

        boolean posted = true;
        try {
            NotificationManagerCompat.from(context).notify(id, notification);
        } catch (RuntimeException e) {
            // MIUI and relatives have been known to throw here (channel/app-op quirks).
            // The alarm still stands, so the page is opened below regardless — and it is
            // told below that nothing is ringing, which makes it speak the call itself.
            // Bailing out here used to leave a foreground app with neither card nor page:
            // the reader saw nothing at all and the prayer passed in silence.
            posted = false;
            Log.e(TAG, "Could not post the adhan notification", e);
        }
        if (posted && !notificationsCanRing(context, channelId)) {
            // `notify()` reports success even when the app's permission is revoked or the
            // channel is muted — the system silently drops the card. A page told "it is
            // ringing" would then stand silent over a prayer nobody heard, which is the
            // reported «فيه صفحة ومفيش أذان» exactly.
            posted = false;
        }

        // Direct launch (works up to Android 9, where a background app may start its own
        // activity): the page comes to the front in every state — locked, screen off, app
        // closed — and the activity's window flags wake the screen over the keyguard.
        // Android 10+ refuses this; the attempt is harmless there and the full-screen
        // intent above is what opens the page instead. The ringing flag rides along, so
        // this path cannot open a page that waits for a sound which never came.
        launch.putExtra(EXTRA_RINGING, posted);
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
        data.put("type", type != null ? type : "prayer");
        // Tells the page who owns the sound: false means the card above never made it,
        // so the page must not stay quiet waiting for a channel sound that is not coming.
        data.put("ringing", posted);
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
     * Whether a notification on this channel can actually be heard.
     *
     * `notify()` above reports success even when the app's notifications are switched off
     * or the channel itself is muted — the system drops the card without a word. Only the
     * device can answer that, and the answer decides whether the page speaks.
     *
     * A channel with no sound is the other half of that answer, and it used to be missed
     * entirely: the app may have created the channel before its sound existed (or the
     * reader may have muted it in the system settings). Such a card is posted and never
     * heard — and a page told "it is ringing" would stand silent over a prayer nobody
     * heard, which is the reported «فيه صفحة ومفيش أذان» exactly.
     */
    private static boolean notificationsCanRing(Context context, String channelId) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        // Channels do not exist before Android 8; notifications on those versions always
        // ring unless the app-level switch above is off.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return true;
        NotificationChannel channel = manager.getNotificationChannel(channelId);
        if (channel == null) return true;
        if (channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        // `prayer-muted` carries no sound by design — the reader silenced the adhan — and
        // so reports that nothing is ringing, which is exactly what it means.
        return channel.getSound() != null;
    }

    /**
     * How far the alarm's instant sits from the device's own clock, in milliseconds:
     * positive when the alarm came late, negative when it came early, and
     * {@link #ON_TIME} while the two still agree (or the payload carries no readable
     * instant — an older build, which must keep working rather than go silent).
     */
    private static long misfireByMs(String time) {
        long instant = parseInstant(time);
        if (instant == 0L) return ON_TIME;
        long by = System.currentTimeMillis() - instant;
        return Math.abs(by) > MISFIRED_AFTER_MS ? by : ON_TIME;
    }

    /** The ISO-8601 instant the JS side sends (`Date#toISOString`), or 0 when unreadable. */
    private static long parseInstant(String time) {
        if (time == null || time.isEmpty()) return 0L;
        try {
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            format.setTimeZone(TimeZone.getTimeZone("UTC"));
            format.setLenient(false);
            Date parsed = format.parse(time);
            return parsed != null ? parsed.getTime() : 0L;
        } catch (ParseException e) {
            return 0L;
        }
    }

    /** «قبل دقيقة واحدة» / «بعد ٣ دقائق» / «بعد ٢٠ دقيقة» — the way the delay is read aloud. */
    private static String delayWording(long minutes) {
        if (minutes <= 1L) return "بدقيقة واحدة";
        if (minutes <= 10L) return "بـ" + minutes + " دقائق";
        return "بـ" + minutes + " دقيقة";
    }

    /**
     * Report an alarm that arrived outside its own window.
     *
     * A plain card, no adhan and no takeover: the prayer has already been called and
     * answered by the time the phone woke up, so what the reader needs now is to know
     * that the alert was late — not a call to a prayer that has passed, and not a page
     * standing over the lock screen claiming «حَانَ الآنْ» for it.
     */
    private static void postMisfiredNotice(
        Context context, int id, String prayerName, String time, long misfiredBy
    ) {
        ensureLateChannel(context);

        boolean late = misfiredBy > 0L;
        long minutes = Math.max(1L, Math.abs(misfiredBy) / 60_000L);
        String name = prayerName != null ? prayerName : "الصلاة";
        String when = formatInstant(context, time);

        String title = late
            ? "تأخّر تنبيه صلاة " + name
            : "خرج تنبيه صلاة " + name + " عن ميعاده";
        String text = "وصل التنبيه " + delayWording(minutes) + (late ? " من موعده" : " قبل موعده")
            + (when != null ? " — كان موعدها " + when : "");

        Notification notification = new NotificationCompat.Builder(context, LATE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(BitmapFactory.decodeResource(
                context.getResources(), R.drawable.ic_notification_large))
            .setColor(COLOR_BRAND)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(openAppIntent(context, id))
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
        try {
            NotificationManagerCompat.from(context).notify(lateRequestId(id), notification);
        } catch (RuntimeException e) {
            Log.e(TAG, "Could not post the late-adhan notice", e);
        }
    }

    /**
     * A request code of its own, so this report can never replace (or be replaced by)
     * the prayer card still standing under the same notification id.
     *
     * The reserved million is laid out in three parts, and it used to be laid out in
     * one — with a collision in the middle of it:
     *
     * <ul>
     *   <li>{@code 8_000_001 … 8_499_998} — the late notices of the prayers;</li>
     *   <li>{@code 8_500_000 … 8_999_998} — the late notices of the communities;</li>
     *   <li>{@code 8_999_999} — the self-test's own card.</li>
     * </ul>
     *
     * The two notices used to share a single slot number — a late iqamah notice and a
     * late prayer notice for the same slot computed the <em>same</em> id, so whichever
     * arrived last erased the other, and one of the two prayers was reported as late
     * while the other was not reported at all.
     */
    private static int lateRequestId(int id) {
        int category = id / 1_000_000;
        int slot = id % 1_000_000;
        // 1 (prayer) → the lower half, 6 (iqamah) → the upper one.
        long half = (category == 1 ? 0L : 1L) * 500_000L;
        return (int) (8_000_001L + half + (slot % 499_998));
    }

    /** Opening the app from this card — no takeover, the reader gets there in their own time. */
    private static PendingIntent openAppIntent(Context context, int id) {
        Intent launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            context, lateRequestId(id), launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** The «تأخّر التنبيه» channel: an ordinary, audible card — nothing like the adhan's. */
    private static void ensureLateChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(LATE_CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            LATE_CHANNEL_ID, LATE_CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("يُعرض عند تأخّر تنبيه الصلاة عن ميعاده");
        channel.enableVibration(true);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        int sound = context.getResources()
            .getIdentifier(LATE_CHANNEL_SOUND, "raw", context.getPackageName());
        if (sound != 0) {
            channel.setSound(
                Uri.parse("android.resource://" + context.getPackageName() + "/" + sound),
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
        }
        manager.createNotificationChannel(channel);
    }

    /** The instant the alarm names, as the reader's clock shows it, or null when unknown. */
    private static String formatInstant(Context context, String time) {
        long instant = parseInstant(time);
        if (instant == 0L) return null;
        return DateFormat.getTimeFormat(context).format(new Date(instant));
    }

    /**
     * The channels are created by the JS scheduler; this only guards the cold corner
     * where one is missing (a cleared app data set before the next open), so the
     * notification is never dropped for an unknown channel.
     *
     * It used to mint that fallback channel <b>without a sound</b>, which Android then
     * makes permanent: a channel's sound is fixed at creation and every later attempt to
     * add one is ignored. So the very fallback meant to keep the adhan audible on a
     * freshly-cleared phone produced a card that arrived in silence — the reported
     * «التنبيه بيوصل من غير صوت» — and no amount of later re-arming could undo it. The
     * alarm now carries the sound, so this channel is born ringing.
     *
     * The same test repairs the other half of that bug: a channel an earlier build minted
     * silently and that is still on the books. It is deleted and rebuilt with the sound —
     * the only route Android allows. The reader's own per-channel preferences are lost
     * with it, which is the price of a channel that could not ring at all. A channel the
     * alarm names no sound for («مواقيت الصلاة — دون صوت») is deliberately silent and is
     * left exactly as it is.
     */
    private static void ensureChannel(
        Context context, String channelId, String sound, String soundPath
    ) {
        // Channels arrived with Android 8; older versions ring from the notification's
        // own sound, so there is nothing to create (and calling the API there is fatal).
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        Uri soundUri = channelSoundUri(context, sound, soundPath);

        NotificationChannel existing = manager.getNotificationChannel(channelId);
        if (existing != null) {
            if (existing.getSound() != null || soundUri == null) return;
            // The reader silenced this channel themselves in the system settings. That
            // is a choice, not a bug, and rebuilding the channel would quietly overrule
            // it — so it is left exactly as it is, and the adhan page speaks the call
            // instead (see `notificationsCanRing`).
            if (existing.getImportance() == NotificationManager.IMPORTANCE_NONE) return;
            // Silent while the alarm says it should ring: rebuild it, or this prayer
            // (and every prayer after it) reaches the reader as a mute card.
            Log.w(TAG, "Prayer channel " + channelId + " exists without a sound - recreating it.");
            manager.deleteNotificationChannel(channelId);
        }

        NotificationChannel channel = new NotificationChannel(
            channelId, "تنبيهات الصلاة", NotificationManager.IMPORTANCE_HIGH);
        channel.enableVibration(true);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        if (soundUri != null) {
            channel.setSound(soundUri, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        }
        manager.createNotificationChannel(channel);
    }

    /**
     * The sound an alarm names, as a channel can hold it: a bundled voice resolves from
     * {@code res/raw}, a downloaded one through the app's {@code FileProvider} — and the
     * grant the system needs to read that file, since it is the system that plays it.
     */
    private static Uri channelSoundUri(Context context, String sound, String soundPath) {
        if (sound != null && !sound.isEmpty()) {
            String name = sound.contains(".") ? sound.substring(0, sound.lastIndexOf('.')) : sound;
            int res = context.getResources()
                .getIdentifier(name, "raw", context.getPackageName());
            if (res == 0) {
                Log.w(TAG, "Adhan sound resource not found: " + sound);
                return null;
            }
            return Uri.parse("android.resource://" + context.getPackageName() + "/" + res);
        }
        if (soundPath != null && !soundPath.isEmpty()) {
            File file = new File(soundPath);
            if (!file.isFile() || file.length() == 0L) {
                Log.w(TAG, "Downloaded adhan sound missing: " + soundPath);
                return null;
            }
            try {
                Uri uri = FileProvider.getUriForFile(
                    context, context.getPackageName() + ".fileprovider", file);
                grantUriReadToSoundPlayers(context, uri);
                return uri;
            } catch (IllegalArgumentException e) {
                Log.e(TAG, "Downloaded adhan sound is outside the FileProvider paths", e);
                return null;
            }
        }
        return null;
    }

    /**
     * Let the system's own audio service open a stored voice. A FileProvider URI is
     * readable only by whoever holds a grant, and the file is opened by the <i>system</i>
     * when the channel rings, not by this app — so without this the card is posted and
     * stays silent.
     */
    private static void grantUriReadToSoundPlayers(Context context, Uri uri) {
        try {
            context.grantUriPermission("android", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (RuntimeException e) {
            Log.w(TAG, "Could not grant a read grant for the adhan sound", e);
        }
    }
}
