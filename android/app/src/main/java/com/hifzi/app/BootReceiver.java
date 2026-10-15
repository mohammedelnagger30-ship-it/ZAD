package com.hifzi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Re-arms the adhan after the events that wipe a package's alarms.
 *
 * Android drops pending alarms on reboot, and several OEM skins drop them on
 * update as well. This receiver used to start the whole app so the JS scheduler
 * could rebuild the queue — but Android 10+ refuses background activity starts,
 * so on precisely the phones that need it most that path silently did nothing,
 * and the adhan stayed off until the next manual open.
 *
 * Now the last armed batch is restored straight from storage: no WebView to
 * load, no visible launch, no permission to hope for. The periodic
 * {@link AdhanHealJob} is registered here too, so even a cleaner that strikes
 * later is still answered within hours.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action) ||
            "com.htc.intent.action.QUICKBOOT_POWERON".equals(action) ||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {

            boolean healed = AdhanOverlay.healIfMissing(context);
            AdhanHealJob.register(context);
            Log.d(TAG, "Re-armed after " + action + " (re-armed: " + healed + ")");
        }
    }
}
