package com.hifzi.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Pattern;

/**
 * Downloads the release APK into the app cache and hands it to the Android
 * package installer.
 *
 * The previous flow opened the GitHub asset URL in the external browser, which
 * left the download (and the install permission prompt) outside the app's
 * control and often stalled after the progress bar filled. Keeping the transfer
 * native gives real progress, an explicit cancel, and a direct path to the
 * installer.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdater extends Plugin {

    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private static final String UPDATE_DIRECTORY = "updates";
    private static final Pattern SAFE_APK_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]*\\.apk");
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final long PROGRESS_INTERVAL_MS = 400L;

    private final Object downloadLock = new Object();
    private Thread downloadThread;
    private volatile HttpURLConnection activeConnection;
    private volatile boolean cancelled = false;

    private static class DownloadCancelledException extends Exception {
        DownloadCancelledException() {
            super("Download cancelled");
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");

        if (url == null || !url.startsWith("https://")) {
            call.reject("رابط التحديث غير صالح.", "invalid-url");
            return;
        }
        if (fileName == null || !SAFE_APK_NAME.matcher(fileName).matches()) {
            call.reject("اسم ملف التحديث غير صالح.", "invalid-file-name");
            return;
        }

        synchronized (downloadLock) {
            if (downloadThread != null && downloadThread.isAlive()) {
                call.reject("يوجد تنزيل تحديث جارٍ بالفعل.", "already-downloading");
                return;
            }
            cancelled = false;
            File target = new File(getUpdateDirectory(), fileName);
            downloadThread = new Thread(() -> runDownload(call, url, target), "zad-update-download");
            downloadThread.start();
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        HttpURLConnection connection = activeConnection;
        if (connection != null) {
            connection.disconnect();
        }
        call.resolve();
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasInstallPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("مسار ملف التحديث مطلوب.", "invalid-path");
            return;
        }

        File apk = new File(path);
        try {
            if (!isManagedUpdateFile(apk)) {
                call.reject("ملف التحديث خارج مجلد التحديث المسموح.", "invalid-path");
                return;
            }
        } catch (IOException e) {
            call.reject("تعذّر قراءة مسار ملف التحديث.", "invalid-path");
            return;
        }

        if (!apk.isFile() || apk.length() == 0) {
            deleteQuietly(apk);
            call.reject("لم يعد ملف التحديث متاحًا على الجهاز.", "missing-file");
            return;
        }

        if (!hasInstallPermission()) {
            try {
                openInstallPermissionScreen();
            } catch (Exception e) {
                Logger.error(getLogTag(), "Could not open the unknown-sources screen", e);
                call.reject("تعذّر فتح إعدادات تثبيت التطبيقات غير المعروفة.", "install-failed");
                return;
            }
            JSObject result = new JSObject();
            result.put("status", "permission-required");
            call.resolve(result);
            return;
        }

        try {
            launchInstaller(apk);
        } catch (Exception e) {
            Logger.error(getLogTag(), "Could not launch the package installer", e);
            call.reject("تعذّر فتح شاشة التثبيت: " + e.getMessage(), "install-failed");
            return;
        }

        JSObject result = new JSObject();
        result.put("status", "launched");
        call.resolve(result);
    }

    private void runDownload(PluginCall call, String url, File target) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(60_000);
            connection.setRequestProperty("User-Agent", "Nour-ZAD-Updater");
            activeConnection = connection;

            int statusCode = connection.getResponseCode();
            if (statusCode != HttpURLConnection.HTTP_OK) {
                call.reject("فشل التنزيل (HTTP " + statusCode + ").", "http-" + statusCode);
                return;
            }

            long expectedBytes = connection.getContentLengthLong();
            File parent = target.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                call.reject("تعذّر إنشاء مجلد التحديث على الجهاز.", "storage-error");
                return;
            }

            long loadedBytes = 0L;
            int lastPercent = Integer.MIN_VALUE;
            long lastNotifyAt = 0L;

            try (InputStream in = new BufferedInputStream(connection.getInputStream());
                 OutputStream out = new BufferedOutputStream(new FileOutputStream(target))) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (cancelled) {
                        throw new DownloadCancelledException();
                    }
                    out.write(buffer, 0, read);
                    loadedBytes += read;

                    int percent = expectedBytes > 0
                        ? (int) Math.min(99L, (loadedBytes * 100L) / expectedBytes)
                        : -1;
                    long now = System.currentTimeMillis();
                    if (percent != lastPercent || now - lastNotifyAt >= PROGRESS_INTERVAL_MS) {
                        lastPercent = percent;
                        lastNotifyAt = now;
                        notifyProgress(loadedBytes, expectedBytes, percent);
                    }
                }
                out.flush();
            }

            if (cancelled) {
                throw new DownloadCancelledException();
            }
            // A short read means the transfer died early; a non-ZIP body means the
            // server sent an error page instead of the APK.
            if (expectedBytes > 0 && loadedBytes < expectedBytes) {
                deleteQuietly(target);
                call.reject("توقّف التنزيل قبل اكتماله — أعد المحاولة.", "incomplete-download");
                return;
            }
            if (!looksLikeZip(target)) {
                deleteQuietly(target);
                call.reject("الملف المنزّل ليس ملف تثبيت صالحًا — أعد المحاولة.", "invalid-apk");
                return;
            }

            notifyProgress(loadedBytes, expectedBytes > 0 ? expectedBytes : loadedBytes, 100);

            JSObject result = new JSObject();
            result.put("path", target.getAbsolutePath());
            result.put("size", target.length());
            call.resolve(result);
        } catch (DownloadCancelledException e) {
            deleteQuietly(target);
            call.reject("تم إلغاء التنزيل.", "cancelled");
        } catch (Exception e) {
            deleteQuietly(target);
            if (cancelled) {
                // cancel() closes the socket, so the reader usually lands here.
                call.reject("تم إلغاء التنزيل.", "cancelled");
                return;
            }
            Logger.error(getLogTag(), "Update download failed", e);
            call.reject("تعذّر تنزيل التحديث: " + e.getMessage(), "download-failed");
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
            activeConnection = null;
            synchronized (downloadLock) {
                downloadThread = null;
            }
        }
    }

    private void notifyProgress(long loadedBytes, long totalBytes, int percent) {
        JSObject data = new JSObject();
        data.put("loaded", loadedBytes);
        data.put("total", totalBytes);
        data.put("percent", percent);
        notifyListeners("progress", data);
    }

    /** APKs are ZIP archives, so the body must start with the ZIP local header. */
    private boolean looksLikeZip(File file) {
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            return in.read() == 'P' && in.read() == 'K';
        } catch (IOException e) {
            return false;
        }
    }

    private boolean hasInstallPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return true;
        }
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void openInstallPermissionScreen() {
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        startActivitySafely(intent);
    }

    private void launchInstaller(File apk) throws IOException {
        Uri apkUri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, APK_MIME_TYPE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivitySafely(intent);
    }

    private void startActivitySafely(Intent intent) {
        AppCompatActivity activity = getActivity();
        if (activity != null) {
            activity.startActivity(intent);
            return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private File getUpdateDirectory() {
        return new File(getContext().getCacheDir(), UPDATE_DIRECTORY);
    }

    /** Installs are only allowed from our own update folder, never from an arbitrary path. */
    private boolean isManagedUpdateFile(File file) throws IOException {
        String directory = getUpdateDirectory().getCanonicalPath() + File.separator;
        return file.getCanonicalPath().startsWith(directory);
    }

    private void deleteQuietly(File file) {
        if (file != null && file.exists() && !file.delete()) {
            Logger.debug(getLogTag(), "Could not delete " + file.getAbsolutePath());
        }
    }
}
