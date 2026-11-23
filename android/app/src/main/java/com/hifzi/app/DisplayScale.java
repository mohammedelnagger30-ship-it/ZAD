package com.hifzi.app;

import android.content.res.Configuration;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Holds the WebView's text scale steady against the system's.
 *
 * Android's WebView multiplies every font on the page by the device's font scale — the one
 * «الوضع البسيط» and the system's own font-size slider move. The layout boxes do not move
 * with it, so a larger scale lets text outgrow its container and the app looks turned
 * inside out.
 *
 * `textZoom` is the only lever: it is applied natively, after CSS, so no stylesheet can
 * undo it. This plugin sets it to 100 (the scale Tailwind's `rem` sizes were written
 * against) when the reader opts in from Settings, and hands it back to the system when
 * they opt out.
 */
@CapacitorPlugin(name = "DisplayScale")
public class DisplayScale extends Plugin {

    /** 100 == "no zoom": the value every rem size in the app was written against. */
    private static final int NEUTRAL_TEXT_ZOOM = 100;

    @PluginMethod
    public void setIgnoreSystemFontScale(PluginCall call) {
        // A final copy: the lambda below captures it, and reassigning `ignore` itself
        // would break capture.
        final boolean ignore = Boolean.TRUE.equals(call.getBoolean("ignore", false));

        // The WebView is touched on the UI thread; the bridge call arrives on its own.
        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            if (webView == null) {
                // A call can land before the bridge finishes building its WebView. The
                // setting is re-applied on the next launch, so this is not a lost state.
                call.reject("العرض غير جاهز بعد.", "webview-not-ready");
                return;
            }
            WebSettings settings = webView.getSettings();
            if (ignore) {
                settings.setTextZoom(NEUTRAL_TEXT_ZOOM);
            } else {
                // Hand it back to the system. The scale the WebView applies on its own is
                // the font scale, expressed as a percentage — 0 would be zero-size text.
                float fontScale = getContext().getResources().getConfiguration().fontScale;
                settings.setTextZoom(Math.round(fontScale * NEUTRAL_TEXT_ZOOM));
            }
            call.resolve();
        });
    }

    /**
     * Reports the system's own font scale, so Settings can tell the reader whether this
     * switch is doing anything right now. 1.0 means the system is already at its default.
     */
    @PluginMethod
    public void getSystemFontScale(PluginCall call) {
        Configuration config = getContext().getResources().getConfiguration();
        JSObject result = new JSObject();
        result.put("scale", (double) config.fontScale);
        call.resolve(result);
    }
}
