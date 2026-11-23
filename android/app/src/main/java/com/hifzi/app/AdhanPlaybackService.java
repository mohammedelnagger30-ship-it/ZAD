package com.hifzi.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import java.io.File;

/**
 * The adhan's own speaker.
 *
 * The prayer card normally rings through its notification channel. On a phone whose
 * channel was muted before the sound existed, on a ROM that refuses {@code notify()}, or
 * on a device where the WebView will not auto-play, that leaves the takeover page standing
 * over a silent prayer — the reported «الصفحة بتظهر من غير صوت». This service plays the
 * very same voice with {@code MediaPlayer} on {@link AudioAttributes#USAGE_ALARM}, so it
 * is audible while the phone is on Vibrate and is not at the mercy of WebView autoplay.
 *
 * It is only started <em>when the channel cannot ring</em>; a ringing channel always owns
 * the sound, so two recordings never overlap. A partial wake lock keeps the CPU awake
 * until the recording finishes, and a foreground card keeps the process alive long enough
 * to finish a three-minute adhan on a dozing phone.
 */
public class AdhanPlaybackService extends Service {

    private static final String TAG = "AdhanPlaybackService";

    static final String ACTION_PLAY = "com.hifzi.app.action.ADHAN_PLAY";
    static final String ACTION_STOP = "com.hifzi.app.action.ADHAN_STOP";
    static final String EXTRA_SOUND = "sound";
    static final String EXTRA_SOUND_PATH = "soundPath";
    static final String EXTRA_TITLE = "title";

    /** Above the recitation's card, below nothing else that posts a notification here. */
    private static final int NOTIFICATION_ID = 99_000_002;
    private static final String CHANNEL_ID = "adhan-playback";

    /** Two alarms at the same instant must not restart the same recording mid-call. */
    private static final long DEDUPE_MS = 60_000L;

    private static volatile AdhanPlaybackService instance;

    private MediaPlayer player;
    private PowerManager.WakeLock wakeLock;
    private AudioFocusRequest focusRequest;
    private String lastSource = "";
    private long lastStartAt = 0L;
    /** idle | preparing | playing | failed — queried by the page before it speaks. */
    private volatile String playbackState = "idle";

    /**
     * The page asks whether the native speaker really got as far as sound. Start of a
     * foreground service is not proof: a voice can still fail to open. The page stays
     * quiet only while this reports `playing`, and speaks for itself otherwise.
     */
    static String state() {
        AdhanPlaybackService service = instance;
        return service == null ? "idle" : service.playbackState;
    }

    /** Start (or refresh) the native adhan speaker. False when it cannot even begin. */
    static boolean play(Context context, String sound, String soundPath, String title) {
        // Reject a missing voice here, before telling the receiver that a speaker was
        // armed. Otherwise the immutable launch intent would carry a "ringing" verdict
        // for a file that does not exist and the page would suppress its own audio.
        if (!sourceAvailable(context, sound, soundPath)) {
            Log.e(TAG, "Adhan voice is not available to the native speaker");
            return false;
        }
        Intent intent = new Intent(context, AdhanPlaybackService.class);
        intent.setAction(ACTION_PLAY);
        intent.putExtra(EXTRA_SOUND, sound);
        intent.putExtra(EXTRA_SOUND_PATH, soundPath);
        intent.putExtra(EXTRA_TITLE, title);

        AdhanPlaybackService service = instance;
        if (service != null) {
            service.startPlayback(sound, soundPath);
            return true;
        }
        try {
            ContextCompat.startForegroundService(context, intent);
            return true;
        } catch (RuntimeException e) {
            // Android 12+ can refuse a background service start. The page still opens
            // and its own WebView audio then becomes the last line of defence.
            Log.e(TAG, "Could not start the adhan speaker service", e);
            return false;
        }
    }

    /** Called by the adhan page as it closes, so a manual stop really ends the sound. */
    static void stop() {
        AdhanPlaybackService service = instance;
        if (service == null) return;
        // Clear the dedupe window too: a replay a second after «stop» is a fresh,
        // deliberate request and must not be skipped as a duplicate of the old call.
        service.lastSource = "";
        service.lastStartAt = 0L;
        service.playbackState = "idle";
        service.stopSelf();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!ACTION_PLAY.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // Honour the foreground-service deadline before preparing audio — a large
        // downloaded voice can take a moment to open.
        postForeground(intent.getStringExtra(EXTRA_TITLE));
        startPlayback(
            intent.getStringExtra(EXTRA_SOUND),
            intent.getStringExtra(EXTRA_SOUND_PATH)
        );
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        playbackState = "idle";
        lastSource = "";
        lastStartAt = 0L;
        releasePlayer();
        releaseWakeLock();
        abandonFocus();
        super.onDestroy();
    }

    private static boolean sourceAvailable(Context context, String sound, String soundPath) {
        if (hasText(sound)) {
            String name = sound.contains(".") ? sound.substring(0, sound.lastIndexOf('.')) : sound;
            return context.getResources().getIdentifier(name, "raw", context.getPackageName()) != 0;
        }
        if (!hasText(soundPath)) return false;
        File file = new File(soundPath);
        return file.isFile() && file.length() > 0L;
    }

    // --- Playback -------------------------------------------------------------

    private void startPlayback(String sound, String soundPath) {
        if (!sourceAvailable(this, sound, soundPath)) {
            Log.w(TAG, "Adhan speaker started with no usable voice");
            playbackState = "failed";
            stopSelf();
            return;
        }
        String source = hasText(sound) ? sound : soundPath;
        long now = SystemClock.elapsedRealtime();
        if (player != null && source.equals(lastSource) && now - lastStartAt < DEDUPE_MS) {
            // A missed alarm, an OEM double broadcast, or the takeovers two paths
            // arriving together: one call is enough.
            return;
        }
        lastSource = source;
        lastStartAt = now;
        playbackState = "preparing";
        releasePlayer();
        acquireWakeLock();
        requestFocus();

        MediaPlayer mediaPlayer = new MediaPlayer();
        player = mediaPlayer;
        mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        try {
            if (hasText(sound)) {
                String name = sound.contains(".") ? sound.substring(0, sound.lastIndexOf('.')) : sound;
                int res = getResources().getIdentifier(name, "raw", getPackageName());
                if (res == 0) {
                    Log.e(TAG, "Adhan sound resource not found: " + sound);
                    playbackState = "failed";
                    stopSelf();
                    return;
                }
                mediaPlayer.setDataSource(getApplicationContext(),
                    Uri.parse("android.resource://" + getPackageName() + "/" + res));
            } else {
                mediaPlayer.setDataSource(new File(soundPath).getAbsolutePath());
            }
        } catch (Exception e) {
            Log.e(TAG, "Could not open the adhan voice", e);
            playbackState = "failed";
            stopSelf();
            return;
        }

        mediaPlayer.setOnPreparedListener(mp -> {
            if (player != mp) return;
            try {
                mp.setVolume(1f, 1f);
                mp.start();
                playbackState = "playing";
            } catch (RuntimeException e) {
                Log.e(TAG, "Could not play the adhan voice", e);
                playbackState = "failed";
                stopSelf();
            }
        });
        mediaPlayer.setOnCompletionListener(mp -> stopSelf());
        mediaPlayer.setOnErrorListener((mp, what, extra) -> {
            Log.e(TAG, "Adhan playback failed: " + what + "/" + extra);
            playbackState = "failed";
            stopSelf();
            return true;
        });
        try {
            mediaPlayer.prepareAsync();
        } catch (IllegalStateException e) {
            Log.e(TAG, "Could not prepare the adhan voice", e);
            playbackState = "failed";
            stopSelf();
        }
    }

    private void releasePlayer() {
        MediaPlayer mediaPlayer = player;
        player = null;
        if (mediaPlayer == null) return;
        try {
            if (mediaPlayer.isPlaying()) mediaPlayer.stop();
        } catch (RuntimeException ignored) {
            // Already released by the platform — nothing to stop.
        }
        mediaPlayer.reset();
        mediaPlayer.release();
    }

    private void acquireWakeLock() {
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager == null) return;
        if (wakeLock == null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Zad::AdhanPlayback");
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld()) wakeLock.acquire(5 * 60_000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private void requestFocus() {
        AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(focusChange -> { })
                .build();
            audio.requestAudioFocus(focusRequest);
        } else {
            audio.requestAudioFocus(
                focusChange -> { },
                AudioManager.STREAM_ALARM,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        }
    }

    private void abandonFocus() {
        AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
        } else {
            audio.abandonAudioFocus(null);
        }
    }

    // --- Foreground card ------------------------------------------------------

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "تشغيل الأذان", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("يبقي صوت الأذان مسموعاً حتى مع إغلاق الشاشة");
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }

    private void postForeground(String title) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        Notification notification = builder
            .setSmallIcon(R.drawable.ic_qaf_notification)
            .setLargeIcon(BitmapFactory.decodeResource(
                getResources(), R.drawable.ic_notification_large))
            .setContentTitle(title != null ? title : "الأذان")
            .setContentText("جارٍ تشغيل الأذان")
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, 0);
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.isEmpty();
    }
}
