package com.hifzi.app;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

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
        super.onCreate(savedInstanceState);

        Intent intent = getIntent();
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
        // singleTask: a manual launch while the boot close is pending reuses this
        // instance with a fresh (action-less) intent. Cancel the pending close so the
        // app is not shut down under the person using it.
        if (intent == null || !ACTION_RESCHEDULE.equals(intent.getAction())) {
            bootReschedulePending = false;
        }
    }
}
