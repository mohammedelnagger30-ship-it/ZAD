package com.hifzi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginManager;

/**
 * Boot receiver to reschedule prayer notifications after device reboot.
 *
 * Android drops pending alarms when the device is rebooted, so we need to
 * reschedule them when the boot completes.
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

        // Handle boot completed events
        if (action.equals(Intent.ACTION_BOOT_COMPLETED) ||
            action.equals("android.intent.action.QUICKBOOT_POWERON") ||
            action.equals("com.htc.intent.action.QUICKBOOT_POWERON")) {

            Log.d(TAG, "Starting application to reschedule notifications");

            try {
                // Start the main activity which will trigger notification rescheduling
                Intent launchIntent = new Intent(context, MainActivity.class);
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(launchIntent);
            } catch (Exception e) {
                Log.e(TAG, "Failed to start app on boot", e);
            }
        }
    }
}
