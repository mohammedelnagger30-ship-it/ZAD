package com.hifzi.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Draws the home-screen widget from whatever the app last wrote down.
 *
 * The WebView is never running when a widget is drawn — the launcher calls
 * here directly, on its own schedule, sometimes hours after the app was last
 * opened. So this class owns every decision the widget makes, and the app's
 * only part is leaving a snapshot behind (see {@link WirdWidget}).
 *
 * What the provider must not do is show that snapshot as though it were the
 * present. Three things follow from that:
 *
 * <ul>
 *   <li>the prayer shown is the first one in the list <em>still ahead of this
 *       device's clock</em>, not the one the app thought was next when it wrote
 *       the list. That is why the list carries the day's remaining times
 *       rather than a single answer: at العصر the widget reaches العصر on its
 *       own, and stays right all evening on a snapshot taken at breakfast;</li>
 *
 *   <li>the task block belongs to the day it names. A snapshot from yesterday
 *       asks to be refreshed instead of reporting yesterday's work as today's;</li>
 *
 *   <li>nothing is ever invented. With no snapshot at all, the widget says
 *       which app to open — it has no schedule, no city and no clock of its
 *       own, and a blank widget that looks broken is worse than one that
 *       explains itself.</li>
 * </ul>
 */
public class WirdWidgetProvider extends AppWidgetProvider {

    /** Where the app's snapshot lives. SharedPreferences, because the launcher
     *  can read them from a cold process in one call. */
    static final String PREFS_NAME = "wird_widget";
    static final String PREFS_SNAPSHOT = "snapshot";

    private static final String KEY_DATE = "date";
    private static final String KEY_PRAYERS = "prayers";
    private static final String KEY_NAME = "name";
    private static final String KEY_TIME_MILLIS = "timeMillis";
    private static final String KEY_TIME_LABEL = "timeLabel";
    private static final String KEY_TASKS_TEXT = "tasksText";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        // One draw for every widget of this kind: they read the same snapshot,
        // so there is nothing to differ between them.
        RemoteViews views = buildViews(context);
        for (int id : widgetIds) {
            manager.updateAppWidget(id, views);
        }
    }

    /** Builds what the launcher draws. Package-private so the shape stays testable
     *  in isolation from a live AppWidgetManager. */
    static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.wird_widget);
        JSONObject snapshot = readSnapshot(context);
        long now = System.currentTimeMillis();

        String prayer = null;
        JSONObject ahead = firstPrayerAhead(snapshot, now);
        if (ahead != null) prayer = prayerText(ahead);
        views.setTextViewText(
            R.id.wird_prayer,
            prayer != null ? prayer : context.getString(R.string.wird_widget_no_prayer)
        );
        views.setTextViewText(R.id.wird_tasks, taskText(context, snapshot));

        views.setOnClickPendingIntent(R.id.wird_widget_root, openAppIntent(context));
        return views;
    }

    /** The first prayer whose instant has not arrived. Null when the list is
     *  empty or spent — a snapshot taken after العشاء carries tomorrow's fajr
     *  for exactly this reason, so this is the corner that snapshot got wrong
     *  rather than an ordinary state. */
    private static JSONObject firstPrayerAhead(JSONObject snapshot, long now) {
        if (snapshot == null) return null;
        JSONArray prayers = snapshot.optJSONArray(KEY_PRAYERS);
        if (prayers == null) return null;

        for (int index = 0; index < prayers.length(); index++) {
            JSONObject prayer = prayers.optJSONObject(index);
            if (prayer == null) continue;
            if (prayer.optLong(KEY_TIME_MILLIS, Long.MIN_VALUE) > now) return prayer;
        }
        return null;
    }

    /** The name and the time the app already formatted for the city's own zone.
     *  Formatting here would need the zone, which the widget does not have. */
    private static String prayerText(JSONObject prayer) {
        String name = prayer.optString(KEY_NAME, "");
        if (name.isEmpty()) return null;
        String time = prayer.optString(KEY_TIME_LABEL, "");
        return time.isEmpty() ? name : name + " — " + time;
    }

    /**
     * The task block, but only for the day it was written for.
     *
     * Yesterday's portions are not a lesser truth, they are a different day's
     * truth — and a home-screen widget is exactly the place where nobody goes
     * to check. So a snapshot from another day asks to be refreshed rather
     * than being read out.
     */
    private static String taskText(Context context, JSONObject snapshot) {
        if (snapshot == null) return context.getString(R.string.wird_widget_stale_tasks);

        // Locale.US so the digits stay Latin whatever the device language: the
        // app writes this date with padStart(), and «٢٠٢٦-١٠-١٥» would never
        // compare equal to it.
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        if (!today.equals(snapshot.optString(KEY_DATE, ""))) {
            return context.getString(R.string.wird_widget_stale_tasks);
        }

        String text = snapshot.optString(KEY_TASKS_TEXT, "");
        return text.isEmpty() ? context.getString(R.string.wird_widget_stale_tasks) : text;
    }

    private static JSONObject readSnapshot(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(PREFS_SNAPSHOT, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            // A snapshot the app wrote and Android cannot read is the same as
            // none at all: the widget explains itself and waits for the next
            // push rather than crashing the launcher's drawing pass.
            return null;
        }
    }

    private static PendingIntent openAppIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
