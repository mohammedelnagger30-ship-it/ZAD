package com.hifzi.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hands the day's snapshot from the WebView to the launcher's widget.
 *
 * Two jobs, and both matter: write the snapshot where
 * {@link WirdWidgetProvider} will find it, and tell the launcher to draw —
 * without the second, the widget would keep whatever it was last given until
 * the system's own half-hourly redraw, which for a person who has just
 * finished a portion means the widget never catches up at all.
 *
 * The snapshot is written before the broadcast goes out, so by the time the
 * provider reads it, it is already there.
 */
@CapacitorPlugin(name = "WirdWidget")
public class WirdWidget extends Plugin {

    @PluginMethod
    public void setSnapshot(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("لقطة الورد مفقودة.", "missing-snapshot");
            return;
        }

        Context context = getContext();
        SharedPreferences prefs =
            context.getSharedPreferences(WirdWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
        // apply() and not commit(): the provider runs in this same process, and
        // SharedPreferences serves the written value from memory the moment
        // apply() returns — so the broadcast below already reads the new one,
        // without blocking the bridge thread on a disk write.
        prefs.edit().putString(WirdWidgetProvider.PREFS_SNAPSHOT, json).apply();

        updateWidgets(context);
        call.resolve();
    }

    /** Asks the launcher to redraw every widget of this kind at once. */
    private static void updateWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(
            new ComponentName(context, WirdWidgetProvider.class));
        if (ids.length == 0) return;

        Intent intent = new Intent(context, WirdWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
