package com.hifzi.app;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private static final String ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (in-app) update installer: must be registered before the bridge is built.
        registerPlugin(AppUpdater.class);
        super.onCreate(savedInstanceState);

        // Check if started from boot receiver
        Intent intent = getIntent();
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            if (action.equals(ACTION_BOOT_COMPLETED) ||
                action.equals("android.intent.action.QUICKBOOT_POWERON") ||
                action.equals("com.htc.intent.action.QUICKBOOT_POWERON")) {
                Log.d(TAG, "App started from boot - will reschedule notifications and close");
                // The Capacitor bridge will load and App.tsx will reschedule notifications
                // We'll close the activity after a delay to avoid disturbing the user
                getBridge().getWebView().postDelayed(() -> {
                    Log.d(TAG, "Closing activity after boot notification reschedule");
                    finish();
                }, 5000); // 5 seconds to allow Capacitor to initialize and reschedule
            }
        }
    }
}
