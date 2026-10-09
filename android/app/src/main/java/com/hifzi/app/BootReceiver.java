package com.hifzi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Boot receiver to reschedule prayer notifications after device reboot.
 *
 * Android drops pending alarms when the device is rebooted, so the only way the adhan
 * survives a reboot is to bring the app up once so its JS scheduler re-arms the queue.
 * The activity is started with {@link MainActivity#ACTION_RESCHEDULE} and closes itself
 * again once the bridge has loaded.
 *
 * Modern Android blocks background activity starts from receivers; when that happens
 * the {@code startActivity} below fails, is logged, and the next manual app open
 * re-arms the queue instead — the failure mode is "adhan late until next open", never
 * a crash.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

        String action = intent.getAction();
        Log.d(TAG, "Boot receiver triggered: " + action);

        if (action.equals(Intent.ACTION_BOOT_COMPLETED) ||
            action.equals("android.intent.action.QUICKBOOT_POWERON") ||
            action.equals("com.htc.intent.action.QUICKBOOT_POWERON")) {

            Log.d(TAG, "Starting application to reschedule notifications");

            try {
                Intent launchIntent = new Intent(context, MainActivity.class);
                // The action must travel with the intent. An intent built from the
                // class alone arrives with action=null, so MainActivity never matched
                // its boot check and never called finish() — the app used to pop up
                // on every reboot and stay open.
                launchIntent.setAction(MainActivity.ACTION_RESCHEDULE);
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(launchIntent);
            } catch (Exception e) {
                Log.e(TAG, "Failed to start app on boot", e);
            }
        }
    }
}
