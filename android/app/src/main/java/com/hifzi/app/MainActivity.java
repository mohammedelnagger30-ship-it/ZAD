package com.hifzi.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";

    /**
     * Carried by the intent this app starts itself with after a reboot (see
     * BootReceiver): the JS side re-arms the notification queue while the bridge
     * loads, and the activity then closes itself instead of being left standing
     * in front of the user.
     */
    public static final String ACTION_RESCHEDULE = "com.hifzi.app.action.RESCHEDULE";

    /** False once the user launches the app themselves before the auto-close fires. */
    private boolean bootReschedulePending = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (in-app) update installer: must be registered before the bridge is built.
        registerPlugin(AppUpdater.class);
        // Prayer-time takeover (full-screen intent): opens the adhan page while the app
        // is closed. Registered with the rest before the bridge is built.
        registerPlugin(AdhanOverlay.class);
        super.onCreate(savedInstanceState);

        Intent intent = getIntent();
        applyAdhanWindowFlags(intent);
        if (intent != null && ACTION_RESCHEDULE.equals(intent.getAction())) {
            Log.d(TAG, "Started to reschedule notifications after boot - closing when done");
            bootReschedulePending = true;
            // The relaunch is machinery, not a user action: no transition either side.
            overridePendingTransition(0, 0);
            getBridge().getWebView().postDelayed(() -> {
                if (!bootReschedulePending) {
                    return; // the user opened the app in the meantime
                }
                Log.d(TAG, "Closing activity after boot notification reschedule");
                finish();
                overridePendingTransition(0, 0);
            }, 5000); // enough for the bridge to load and App.tsx to reschedule
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        applyAdhanWindowFlags(intent);
        // singleTask: a manual launch while the boot close is pending reuses this
        // instance with a fresh (action-less) intent. Cancel the pending close so the
        // app is not shut down under the person using it.
        if (intent == null || !ACTION_RESCHEDULE.equals(intent.getAction())) {
            bootReschedulePending = false;
        }
    }

    /**
     * The adhan takeover arrives over the lock screen (full-screen intent), so that one
     * launch may draw above the keyguard and wake the screen. Every other launch goes
     * back to normal — the flags are cleared again here because singleTask reuses this
     * instance and the window would otherwise stay unlocked-over-keyguard forever.
     */
    private void applyAdhanWindowFlags(Intent intent) {
        boolean adhanLaunch = intent != null && AdhanOverlay.ACTION_ADHAN.equals(intent.getAction());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(adhanLaunch);
        } else if (adhanLaunch) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            setTurnScreenOn(adhanLaunch);
        } else if (adhanLaunch) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }
}
