package com.hifzi.app;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

/**
 * Silent self-heal for the adhan alarms.
 *
 * Reboots and app updates are covered by {@link BootReceiver}, but several OEM
 * skins (MIUI, EMUI, ColorOS and their relatives) also drop another app's
 * alarms whenever they decide it has been running too much — and nothing
 * broadcasts when that happens. This job re-checks a few times a day that the
 * soonest prayer alarm is still armed and re-arms the stored batch when it is
 * not. It needs no WebView and no user action: protection must not depend on
 * the person remembering to open the app.
 *
 * A user's own force-stop is different, and unreachable by design: Android puts
 * the app to sleep until the person launches it again, cancelling jobs and
 * broadcasts alike. No background job can outlive that, and the next open
 * re-arms everything anyway.
 */
public class AdhanHealJob extends JobService {
    private static final String TAG = "AdhanHealJob";

    /** Stable id: scheduling with it again replaces, so registering is idempotent. */
    private static final int JOB_ID = 0x5152_4e01;

    /** How often the alarms are re-checked, and how much the runs may drift. */
    private static final long PERIOD_MS = 3L * 60 * 60 * 1000; // 3 hours
    private static final long FLEX_MS = PERIOD_MS / 3;

    /**
     * Schedules the periodic check. Calling repeatedly is free: the same job id
     * replaces the previous schedule instead of stacking a second one.
     */
    static void register(Context context) {
        JobScheduler scheduler =
            (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;

        JobInfo job = new JobInfo.Builder(
                JOB_ID, new ComponentName(context, AdhanHealJob.class))
            // Persisted: the schedule itself survives reboots, so the net is in
            // place even before the first BOOT_COMPLETED re-arm runs.
            .setPersisted(true)
            .setPeriodic(PERIOD_MS, FLEX_MS)
            .build();

        if (scheduler.schedule(job) != JobScheduler.RESULT_SUCCESS) {
            Log.w(TAG, "Could not schedule the adhan heal job");
        }
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        // Short work, but not on the main thread: the check opens storage and
        // may talk to AlarmManager.
        new Thread(() -> {
            try {
                AdhanOverlay.healIfMissing(getApplicationContext());
            } finally {
                jobFinished(params, false);
            }
        }, "adhan-heal").start();
        return true; // the work is running on the thread above
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true; // cut short by the system — run again when it allows
    }
}
