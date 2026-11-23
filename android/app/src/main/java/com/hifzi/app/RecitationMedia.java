package com.hifzi.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The JS bridge to the recitation's system player card.
 *
 * <p>Why this exists at all: the recitation is an {@code <audio>} element inside the
 * Android WebView, and a WebView does not implement {@code navigator.mediaSession}.
 * Without help the OS therefore has no idea that anything is playing — no lock-screen
 * card, no controls on a headset, and no notification while the app is in the
 * background. This plugin takes the state the JS engine publishes and mirrors it onto
 * a real {@link android.media.session.MediaSession} through
 * {@link RecitationMediaService}, then hands every button press back to JS as an
 * {@code action} event so the engine runs exactly the code path an on-screen tap runs.
 *
 * <p>Two events travel the other way:
 *
 * <ul>
 *   <li>{@code action} — {@code play}, {@code pause}, {@code stop}, {@code next},
 *       {@code prev}, or {@code seek} with a {@code positionMs}. Raised by the
 *       notification's buttons (through {@link RecitationMediaReceiver}) and by the
 *       hardware media keys and the lock-screen scrubber (through the session
 *       callback).</li>
 *   <li>{@code openPlayer} — the card itself was tapped, so the app should come
 *       forward with the expanded player open. Delivered retained on a cold start,
 *       the same way {@link AdhanOverlay} delivers its launch payload.</li>
 * </ul>
 *
 * <p>A repeated action inside {@link #DEDUPE_WINDOW_MS} is dropped here as well as in
 * the service: the same physical button can reach both paths on some ROMs, and two
 * surahs skipped by one press is the kind of bug nobody thinks to report.
 */
@CapacitorPlugin(name = "RecitationMedia")
public class RecitationMedia extends Plugin {

    private static final long DEDUPE_WINDOW_MS = 400L;

    /** The live plugin instance, so the service can raise events into JS. */
    private static volatile RecitationMedia active;

    private static long lastActionAt = 0L;
    private static String lastActionName = null;

    @Override
    public void load() {
        active = this;
        // A cold start straight from the card's tap: Capacitor replays a retained
        // event to whoever subscribes later, so JS gets it once its listeners attach.
        consumeLaunchIntent(getActivity() != null ? getActivity().getIntent() : null, true);
    }

    @Override
    public void handleOnNewIntent(Intent intent) {
        // singleTask reuse: a tap on the card while the app is alive arrives here.
        consumeLaunchIntent(intent, false);
    }

    @Override
    protected void handleOnResume() {
        // A retained event nobody consumed (the page was closed by then) must not
        // reopen the player on the next resume.
        clearLaunchExtras(getActivity() != null ? getActivity().getIntent() : null);
    }

    @Override
    protected void handleOnDestroy() {
        active = null;
        super.handleOnDestroy();
    }

    /** Mirror the current recitation state onto the system card. */
    @PluginMethod
    public void sync(PluginCall call) {
        JSObject data = call.getData();
        if (data == null) {
            call.reject("حالة مشغل التلاوة مطلوبة.", "invalid-state");
            return;
        }
        RecitationMediaService.publish(getContext(), data);
        call.resolve();
    }

    /** Take the card down — the recitation was stopped, or surah ١١٤ finished. */
    @PluginMethod
    public void clear(PluginCall call) {
        RecitationMediaService.clear();
        call.resolve();
    }

    /**
     * Called from the service: deliver a transport press to the JS engine.
     *
     * <p>Silently does nothing when the plugin is not alive (the activity was
     * destroyed): there is then no engine and no audio to control, and the service
     * itself is on its way out through {@code onTaskRemoved}.
     */
    static void dispatchAction(String action, long positionMs) {
        long now = System.currentTimeMillis();
        if (action.equals(lastActionName) && now - lastActionAt < DEDUPE_WINDOW_MS) return;
        lastActionAt = now;
        lastActionName = action;

        RecitationMedia plugin = active;
        if (plugin == null) return;

        JSObject data = new JSObject();
        data.put("action", action);
        // Only «seek» carries a position; the engine reads its presence to tell the
        // two apart rather than trusting a magic -1.
        if (positionMs >= 0L) data.put("positionMs", positionMs);
        plugin.notifyListeners("action", data);
    }

    private void consumeLaunchIntent(Intent intent, boolean retained) {
        if (intent == null || !RecitationMediaService.ACTION_OPEN_PLAYER.equals(intent.getAction())) {
            return;
        }
        notifyListeners("openPlayer", new JSObject(), retained);
        intent.setAction(null);
    }

    /** Wipe the marker once consumed, so an ordinary relaunch does not reopen the player. */
    private static void clearLaunchExtras(Intent intent) {
        if (intent == null || !RecitationMediaService.ACTION_OPEN_PLAYER.equals(intent.getAction())) {
            return;
        }
        intent.setAction(null);
    }
}
