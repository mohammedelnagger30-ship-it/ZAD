package com.hifzi.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The recitation's own player card: a foreground service that keeps the reader's
 * audio alive while the app is in the background and puts the recitation on the
 * lock screen, in the notification shade, on Bluetooth headphones and on a car
 * dashboard.
 *
 * <p>The audio itself never lives here — it is an {@code <audio>} element inside the
 * WebView, and the JS engine ({@code @/utils/recitationEngine}) owns every decision:
 * which surah, which ayah, when to walk on to the next surah. Android's WebView cannot
 * use {@code navigator.mediaSession}, so without this class the OS would know nothing
 * about the sound and the phone would treat the recitation as a stray noise: no card,
 * no controls, and a paused stream the moment the screen went off.
 *
 * <p>This service is therefore a <em>mirror</em>, not a second player. JS pushes a
 * snapshot ({@link #publish}) whenever something the system cares about changes —
 * the title, the play/pause intent, a seek, the playback speed — and the service
 * republishes it as a {@link MediaSession} plus one {@link Notification.MediaStyle}
 * card. The system extrapolates the position from the state it was last given, so
 * nothing has to be sent every second. Everything the user presses comes back as an
 * "action" event; the JS engine runs the exact same code path as an on-screen tap.
 *
 * <p>The card is deliberately never posted from a background context: on Android 12+
 * a background app may not start a service, so the first publish goes through
 * {@link ContextCompat#startForegroundService} from JS (a foreground moment), and every
 * later update reaches the running instance directly through the static reference —
 * no intents, no background starts.
 */
public class RecitationMediaService extends Service {

    private static final String TAG = "RecitationMediaService";

    /** JS → native: here is the current state of the recitation. */
    static final String ACTION_SYNC = "com.hifzi.app.action.RECITATION_SYNC";
    /** JS → native: the recitation ended (stopped, or the surah ١١٤ finished). */
    static final String ACTION_CLEAR = "com.hifzi.app.action.RECITATION_CLEAR";
    /** A notification button was pressed (see {@link RecitationMediaReceiver}). */
    static final String ACTION_BUTTON = "com.hifzi.app.action.RECITATION_BUTTON";
    /** The card was tapped: bring the app forward and open the expanded player. */
    static final String ACTION_OPEN_PLAYER = "com.hifzi.app.action.RECITATION_OPEN";

    static final String EXTRA_PAYLOAD = "recitationPayload";

    /**
     * The card's own id, far above every id the notification scheduler hands out
     * ({@code NOTIFICATION_ID_BASE} tops out around ten million): an ongoing media
     * card must never collide with a prayer, a task or the hadith of the day.
     */
    private static final int NOTIFICATION_ID = 99_000_001;
    private static final String CHANNEL_ID = "recitation";

    /**
     * How long the same action is ignored for. A media key can reach both the
     * session callback and Capacitor's own key handling, and a notification button
     * press can be delivered twice on some ROMs; without this a single «التالي»
     * would skip two surahs.
     */
    private static final long DEDUPE_WINDOW_MS = 400L;

    private static volatile RecitationMediaService instance;

    private MediaSession mediaSession;
    private boolean foreground = false;

    /**
     * Held only while a surah is actually sounding.
     *
     * The audio element lives in the WebView, which does not take a wake lock of its
     * own — so on a device that sleeps with the screen off, a recitation left playing
     * would simply stop mid-surah and the listener would find a paused card an hour
     * later. A partial lock is the standard media-player answer: the CPU stays up,
     * the screen does not.
     */
    private PowerManager.WakeLock wakeLock;

    // --- The mirrored snapshot -------------------------------------------------
    private boolean playing = false;
    private boolean hasNext = false;
    private boolean hasPrev = false;
    private long positionMs = 0L;
    private long durationMs = 0L;
    private float speed = 1f;
    private String title = "";
    private String artist = "";
    private String album = "";

    // --- Action de-duplication -------------------------------------------------
    private long lastEmitAt = 0L;
    private String lastEmitAction = null;

    // ---------------------------------------------------------------------------
    // Entry points used by the JS bridge and the notification receiver
    // ---------------------------------------------------------------------------

    /**
     * Hand the current recitation state to the system.
     *
     * A running instance is updated in place: the listener is usually backgrounding
     * the app or dragging the lock-screen scrubber, and neither is a moment at which
     * a background app is allowed to start a service. Only the very first publish —
     * which always happens while JS is in the foreground, on the play that opens the
     * session — has to go through {@code startForegroundService}.
     */
    static void publish(Context context, JSObject payload) {
        RecitationMediaService service = instance;
        if (service != null) {
            service.apply(payload.toString());
            return;
        }
        Intent intent = new Intent(context, RecitationMediaService.class);
        intent.setAction(ACTION_SYNC);
        intent.putExtra(EXTRA_PAYLOAD, payload.toString());
        try {
            ContextCompat.startForegroundService(context, intent);
        } catch (RuntimeException e) {
            // Android 12+ refuses this from the background; the recitation keeps
            // playing, it simply has no card. Never fatal to playback.
            Log.w(TAG, "Could not start the recitation player service", e);
        }
    }

    /**
     * Tear the card down — the listener stopped, or the last surah finished.
     *
     * Nothing to do when no instance exists: a service that is not running has no
     * notification to remove, and starting one just to stop it would be a background
     * service start, which Android forbids precisely where this is called from.
     */
    static void clear() {
        RecitationMediaService service = instance;
        if (service == null) return;
        service.teardown();
    }

    /**
     * A transport control from the notification card or from the hardware media keys.
     * {@code positionMs} is only meaningful for «seek»; every other button passes -1.
     */
    static void dispatch(String action, long positionMs) {
        RecitationMediaService service = instance;
        if (service == null) return;
        service.emit(action, positionMs);
    }

    // ---------------------------------------------------------------------------
    // Service lifecycle
    // ---------------------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();

        mediaSession = new MediaSession(this, "ZadRecitation");
        mediaSession.setFlags(
            MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                emit("play", -1L);
            }

            @Override
            public void onPause() {
                emit("pause", -1L);
            }

            @Override
            public void onStop() {
                emit("stop", -1L);
            }

            @Override
            public void onSkipToNext() {
                emit("next", -1L);
            }

            @Override
            public void onSkipToPrevious() {
                emit("prev", -1L);
            }

            @Override
            public void onSeekTo(long position) {
                emit("seek", position);
            }
        });
        // Declares the stream the recitation plays on, so a ducking phone call or a
        // navigation prompt treats it as speech and lowers it instead of killing it.
        mediaSession.setPlaybackToLocal(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build());
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Restarted by the platform with nothing to show. There is no recitation
            // to mirror, so ending here is the only honest outcome — NOT_STICKY below
            // makes this a corner case rather than the norm.
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_CLEAR.equals(intent.getAction())) {
            teardown();
            return START_NOT_STICKY;
        }
        String payload = intent.getStringExtra(EXTRA_PAYLOAD);
        if (payload != null) {
            apply(payload);
        } else {
            // startForegroundService() owes the system a startForeground() within a
            // few seconds; honour it even when the payload was unreadable.
            postNotification();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The card is only ever true while the WebView lives: the task going away
        // takes the activity, the bridge and the <audio> element with it, so an
        // ongoing card left behind would advertise a recitation that has already
        // stopped — and, being ongoing, the user could not even swipe it away.
        teardown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        releaseWakeLock();
        releaseSession();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        // Started, never bound: there is no client API here, only the static mirror.
        return null;
    }

    // ---------------------------------------------------------------------------
    // The mirrored state
    // ---------------------------------------------------------------------------

    private void apply(String payload) {
        try {
            JSONObject data = new JSONObject(payload);
            title = data.optString("title", "");
            artist = data.optString("artist", "");
            album = data.optString("album", "");
            playing = data.optBoolean("isPlaying", false);
            hasNext = data.optBoolean("hasNext", false);
            hasPrev = data.optBoolean("hasPrev", false);
            positionMs = (long) data.optDouble("positionMs", 0d);
            durationMs = (long) data.optDouble("durationMs", 0d);
            speed = (float) data.optDouble("speed", 1d);
        } catch (JSONException e) {
            // Keeping what the system already has beats blanking the card: a broken
            // payload is a JS bug, not a reason to drop the listener's controls.
            Log.w(TAG, "Unreadable recitation payload - keeping the previous state", e);
        }
        updateSession();
        updateWakeLock();
        postNotification();
    }

    private void updateSession() {
        if (mediaSession == null) return;
        mediaSession.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, Math.max(durationMs, 0L))
            .build());

        // Only advertise what actually exists: at surah ١١٤ the system must not draw
        // a «التالي» that would do nothing.
        long actions = PlaybackState.ACTION_PLAY
            | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_STOP
            | PlaybackState.ACTION_SEEK_TO;
        if (hasNext) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;
        if (hasPrev) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;

        long position = positionMs < 0L ? 0L : positionMs;
        if (durationMs > 0L && position > durationMs) position = durationMs;

        mediaSession.setPlaybackState(new PlaybackState.Builder()
            .setActions(actions)
            // The last position the app *knew*; the system advances it by the speed
            // from here, which is why JS only reports position on a seek, a pause or
            // a track change rather than every second.
            .setState(
                playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                position,
                playing ? speed : 0f)
            .build());
    }

    // ---------------------------------------------------------------------------
    // Wake lock
    // ---------------------------------------------------------------------------

    private void updateWakeLock() {
        if (!playing) {
            releaseWakeLock();
            return;
        }
        if (wakeLock == null) {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager == null) return;
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK, "Zad::RecitationPlayback");
            // Acquired and released around a boolean, never nested: reference counting
            // would turn a missed release into a lock held for the life of the process.
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld()) wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private void emit(String action, long seekPositionMs) {
        long now = SystemClock.elapsedRealtime();
        if (action.equals(lastEmitAction) && now - lastEmitAt < DEDUPE_WINDOW_MS) return;
        lastEmitAt = now;
        lastEmitAction = action;
        RecitationMedia.dispatchAction(action, seekPositionMs);
    }

    // ---------------------------------------------------------------------------
    // The notification card
    // ---------------------------------------------------------------------------

    private void postNotification() {
        Notification notification = buildNotification();
        if (foreground) {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, notification);
            return;
        }
        foreground = true;
        ServiceCompat.startForeground(
            this, NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setPriority(Notification.PRIORITY_LOW);
        }

        // The transport controls, in the order Android shows them: the collapsed
        // MediaStyle row takes the first three, so «السابق / تشغيل / التالي» land in it
        // and «إغلاق المشغل» — which only exists to end an ongoing card — is left for
        // the expanded view.
        List<Notification.Action> actions = new ArrayList<>();
        if (hasPrev) {
            actions.add(
                transportAction("prev", R.drawable.ic_action_previous, "السورة السابقة"));
        }
        actions.add(playing
            ? transportAction("pause", R.drawable.ic_action_pause, "إيقاف مؤقت")
            : transportAction("play", R.drawable.ic_action_play, "متابعة التلاوة"));
        if (hasNext) {
            actions.add(
                transportAction("next", R.drawable.ic_action_next, "السورة التالية"));
        }
        actions.add(transportAction("stop", R.drawable.ic_action_close, "إغلاق المشغل"));

        Notification.MediaStyle style = new Notification.MediaStyle();
        // The collapsed row shows the first three buttons that actually exist — at
        // الفاتحة there is no «السابق» and at الناس no «التالي», and naming an index
        // that is not there would leave the row short instead of right-aligned.
        int compactCount = Math.min(actions.size(), 3);
        int[] compact = new int[compactCount];
        for (int index = 0; index < compactCount; index += 1) compact[index] = index;
        style.setShowActionsInCompactView(compact);
        if (mediaSession != null) style.setMediaSession(mediaSession.getSessionToken());

        for (Notification.Action action : actions) builder.addAction(action);

        return builder
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(BitmapFactory.decodeResource(
                getResources(), R.drawable.ic_notification_large))
            .setColor(0xFF1F734E)
            .setContentTitle(title.isEmpty() ? getString(R.string.app_name) : title)
            .setContentText(artist)
            .setContentIntent(contentIntent())
            .setStyle(style)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            // Ongoing: the listener is mid-recitation, and the card's own «إغلاق» is
            // the way out — a swipe that silently silenced the surah mid-ayah would
            // look like a crash.
            .setOngoing(true)
            .setShowWhen(false)
            // A short surah re-posts several times a minute; each one would buzz or
            // blink without this.
            .setOnlyAlertOnce(true)
            .build();
    }

    private PendingIntent contentIntent() {
        Intent open = new Intent(this, MainActivity.class).setAction(ACTION_OPEN_PLAYER);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * One transport button.
     *
     * Every button goes through {@link RecitationMediaReceiver} rather than being
     * answered here: the receiver can be handed the press even when the service
     * instance is being recreated, and a broadcast is the one delivery path a
     * notification action is guaranteed on every API level this app supports.
     */
    private Notification.Action transportAction(String action, int iconRes, String label) {
        Intent intent = new Intent(this, RecitationMediaReceiver.class).setAction(ACTION_BUTTON);
        intent.putExtra(RecitationMediaReceiver.EXTRA_ACTION, action);
        PendingIntent pending = PendingIntent.getBroadcast(
            this,
            // One request code per button, so the three intents stay distinct rather
            // than overwriting each other's extras.
            action.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(
            Icon.createWithResource(this, iconRes), label, pending).build();
    }

    /**
     * The card's channel: low importance and silent on purpose. A recitation already
     * has a sound — the one coming out of the speaker — and a channel that buzzed at
     * every surah change would make the player unusable. Low importance also keeps it
     * out of the heads-up area, where a permanent card does not belong.
     *
     * <p>On Android 8+ a channel is created once and then owned by the user; the
     * settings here only ever apply to a device that has not seen the channel before.
     */
    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "التلاوة الجارية", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("مشغل التلاوة الصوتية — التحكم من الإشعار وشاشة القفل");
        channel.setShowBadge(false);
        channel.enableVibration(false);
        channel.setSound(null, null);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    // ---------------------------------------------------------------------------
    // Teardown
    // ---------------------------------------------------------------------------

    private void teardown() {
        if (foreground) {
            foreground = false;
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        }
        releaseWakeLock();
        releaseSession();
        stopSelf();
    }

    private void releaseSession() {
        if (mediaSession == null) return;
        mediaSession.setActive(false);
        mediaSession.release();
        mediaSession = null;
    }
}
