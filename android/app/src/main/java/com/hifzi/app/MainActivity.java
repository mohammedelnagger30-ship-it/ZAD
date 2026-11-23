package com.hifzi.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (in-app) update installer: must be registered before the bridge is built.
        registerPlugin(AppUpdater.class);
        // Prayer-time takeover (full-screen intent): opens the adhan page while the app
        // is closed. Registered with the rest before the bridge is built.
        registerPlugin(AdhanOverlay.class);
        // Home-screen widget: takes the day's snapshot out of the WebView and hands it
        // to the launcher. Registered with the rest before the bridge is built.
        registerPlugin(WirdWidget.class);
        // Recitation player card: mirrors the in-app <audio> playback onto an Android
        // notification + MediaSession, because a WebView has no navigator.mediaSession.
        registerPlugin(RecitationMedia.class);
        // Text-scale hold: keeps «الوضع البسيط» and the system font-size slider from
        // reflowing the app's layout, when the reader asks for that in Settings.
        registerPlugin(DisplayScale.class);
        // «حفظ على الهاتف»: copies a lecture out of the app's private store and into the
        // public Download/قُرّة folder, where the file manager and the music apps find it.
        registerPlugin(PhoneStorage.class);
        super.onCreate(savedInstanceState);

        applyAdhanWindowFlags(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        applyAdhanWindowFlags(intent);
    }

    /**
     * The adhan takeover reaches the activity either from the full-screen intent or
     * straight from the receiver's own startActivity() (both described there), so it may
     * arrive over the lock screen with the screen off: draw above the keyguard and wake
     * the screen. Every other launch goes back to normal — the flags are cleared again
     * here because singleTask reuses this instance and the window would otherwise stay
     * unlocked-over-keyguard forever.
     *
     * setShowWhenLocked() and setTurnScreenOn() both arrived in API 27 (O_MR1); guarding
     * either one at O (26) would hit NoSuchMethodError on an Android 8.0 device, so the
     * pair shares one guard and the older versions use the window-flag equivalents.
     */
    private void applyAdhanWindowFlags(Intent intent) {
        boolean adhanLaunch = intent != null && AdhanOverlay.ACTION_ADHAN.equals(intent.getAction());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(adhanLaunch);
            setTurnScreenOn(adhanLaunch);
        } else if (adhanLaunch) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }
}
