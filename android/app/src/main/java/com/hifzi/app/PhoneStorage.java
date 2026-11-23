package com.hifzi.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * Puts a lecture where the phone can see it.
 *
 * The app's own files live in its private directory: the file manager hides them, no music
 * player opens them, and they die with the install. A lecture «saved» only there is saved
 * for the app, not for the listener — what the listener asks for is a file on the phone,
 * something to hand to a car stereo, copy to an SD card, or play with another app. That
 * file has to land in shared storage, in `Download/قُرّة`, where it sits next to every
 * other download and is found by every file manager.
 *
 * On Android 10 and newer the copy goes through {@link MediaStore.Downloads}, which needs
 * no permission at all: the row is created with `IS_PENDING` while the bytes are copied and
 * published afterwards, so a half-written lecture never shows up in the file manager as a
 * finished one. Below Android 10 there is no download collection to insert into, so the
 * file is written straight into the folder — which is what the legacy storage permission
 * is for, and why the manifest declares it with `maxSdkVersion="28"` and nothing above.
 *
 * The bytes are always copied out of the app's own store, never fetched again: the lecture
 * the listener keeps for offline playback and the lecture handed to the phone are the same
 * file, and the copy is a local one.
 */
@CapacitorPlugin(
    name = "PhoneStorage",
    permissions = @Permission(
        strings = { Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE },
        alias = PhoneStorage.PERMISSION_ALIAS
    )
)
public class PhoneStorage extends Plugin {

    static final String PERMISSION_ALIAS = "phoneStorage";

    /** The folder the listener meets in the file manager: `Download/قُرّة`. */
    private static final String FOLDER = "قُرّة";

    private static final String SUFFIX = ".mp3";
    private static final String MIME_TYPE = "audio/mpeg";

    /** MediaStore keeps `RELATIVE_PATH` with a trailing slash, so it is written with one. */
    private static final String RELATIVE_PATH = Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER + "/";

    private static JSObject entry(String name, long size) {
        JSObject entry = new JSObject();
        entry.put("name", name);
        entry.put("size", size);
        return entry;
    }

    /** The same folder, as a plain path — the only way to reach it below Android 10. */
    private static File publicFolder() {
        return new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), FOLDER);
    }

    /**
     * The lectures the app kept for itself, under the app's own files dir
     * (`Directory.DATA` on the JS side, `files/lecture_store` here).
     */
    private File privateFile(String dir, String name) throws IOException {
        File root = getContext().getFilesDir();
        File file = new File(new File(root, dir), name);
        // Canonical, so a `..` in either part cannot walk out of the app's own directory.
        String rootPath = root.getCanonicalPath() + File.separator;
        if (!file.getCanonicalPath().startsWith(rootPath)) {
            throw new IOException("خارج مجلد التطبيق");
        }
        return file;
    }

    private File publicFile(String name) {
        return new File(publicFolder(), name);
    }

    /** True when a file of that name is already in the folder — on either Android shape. */
    private boolean nameExists(String name) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            String[] projection = { MediaStore.Downloads._ID };
            try (Cursor cursor = getContext().getContentResolver().query(
                    MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                    projection,
                    MediaStore.Downloads.DISPLAY_NAME + " = ? AND " + MediaStore.Downloads.RELATIVE_PATH + " = ?",
                    new String[] { name, RELATIVE_PATH },
                    null)) {
                return cursor != null && cursor.moveToFirst();
            }
        }
        return publicFile(name).exists();
    }

    /**
     * A name that belongs to this lecture alone. MediaStore renames a colliding insert to
     * «name (1).mp3» behind the app's back, which would leave the app pointing at a file
     * that is not there; choosing the name up front keeps both sides telling the truth.
     */
    private String uniqueName(String name) throws IOException {
        if (!nameExists(name)) return name;
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String extension = dot > 0 ? name.substring(dot) : "";
        for (int index = 1; index < 1000; index += 1) {
            String candidate = stem + " (" + index + ")" + extension;
            if (!nameExists(candidate)) return candidate;
        }
        throw new IOException("تعذّر تفريغ الاسم");
    }

    private static void copy(File source, OutputStream out) throws IOException {
        try (InputStream in = new FileInputStream(source); OutputStream output = out) {
            byte[] buffer = new byte[256 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        }
    }

    /** Writes the file through MediaStore, published only once every byte is in. */
    private Uri saveThroughMediaStore(File source, String name) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);

        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, MIME_TYPE);
        values.put(MediaStore.Downloads.RELATIVE_PATH, RELATIVE_PATH);
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri uri = resolver.insert(collection, values);
        if (uri == null) throw new IOException("تعذّر إنشاء الملف في مجلد التنزيلات");

        boolean written = false;
        try {
            OutputStream out = resolver.openOutputStream(uri);
            if (out == null) throw new IOException("تعذّر فتح الملف للكتابة");
            copy(source, out);
            written = true;
        } finally {
            if (!written) {
                // A pending row with nothing behind it would show up in the file manager
                // as a zero-byte lecture; drop it rather than leave that for the listener.
                resolver.delete(uri, null, null);
            }
        }

        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        return uri;
    }

    /** Writes the file the pre-Android-10 way: straight into the public folder. */
    private File saveThroughPath(File source, String name) throws IOException {
        File target = publicFile(name);
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IOException("تعذّر إنشاء مجلد التنزيلات");
        }
        copy(source, new FileOutputStream(target));
        // So the file manager and the music apps show it without waiting for a rescan.
        MediaScannerConnection.scanFile(
            getContext(),
            new String[] { target.getAbsolutePath() },
            new String[] { MIME_TYPE },
            null);
        return target;
    }

    private void runSave(PluginCall call, String dir, String file, String name) {
        Thread worker = new Thread(() -> {
            try {
                File source = privateFile(dir, file);
                if (!source.isFile()) {
                    call.reject("المحاضرة غير محفوظة داخل التطبيق بعد");
                    return;
                }
                String target = uniqueName(name);
                String storedPath;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    saveThroughMediaStore(source, target);
                    storedPath = publicFolder().getAbsolutePath() + File.separator + target;
                } else {
                    storedPath = saveThroughPath(source, target).getAbsolutePath();
                }

                JSObject result = new JSObject();
                result.put("name", target);
                result.put("path", storedPath);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("تعذّر حفظ المحاضرة على الهاتف", error);
            }
        }, "zad-phone-save");
        worker.start();
    }

    /** The files sitting in `Download/قُرّة`, by name — one call, not one per lecture. */
    @PluginMethod
    public void list(PluginCall call) {
        Thread worker = new Thread(() -> {
            try {
                JSArray files = new JSArray();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    String[] projection = { MediaStore.Downloads.DISPLAY_NAME, MediaStore.Downloads.SIZE };
                    try (Cursor cursor = getContext().getContentResolver().query(
                            MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                            projection,
                            MediaStore.Downloads.RELATIVE_PATH + " = ?",
                            new String[] { RELATIVE_PATH },
                            null)) {
                        while (cursor != null && cursor.moveToNext()) {
                            files.put(entry(cursor.getString(0), cursor.getLong(1)));
                        }
                    }
                } else {
                    File[] listed = publicFolder().listFiles();
                    if (listed != null) {
                        for (File file : listed) {
                            if (file.isFile() && file.getName().toLowerCase(Locale.ROOT).endsWith(SUFFIX)) {
                                files.put(entry(file.getName(), file.length()));
                            }
                        }
                    }
                }

                JSObject result = new JSObject();
                result.put("folder", FOLDER);
                result.put("files", files);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("تعذّر قراءة مجلد التنزيلات", error);
            }
        }, "zad-phone-list");
        worker.start();
    }

    /**
     * Copies the lecture the app kept (`dir`/`file` under the app's files) into
     * `Download/قُرّة` under a name the listener can read, and answers with the name it
     * actually got — the folder may already hold another lecture by that name.
     */
    @PluginMethod
    public void save(PluginCall call) {
        String dir = call.getString("dir");
        String file = call.getString("file");
        String name = call.getString("name");
        if (dir == null || dir.isEmpty() || file == null || !file.endsWith(SUFFIX)
                || name == null || !name.endsWith(SUFFIX)) {
            call.reject("بيانات الحفظ غير صحيحة");
            return;
        }

        // Below Android 10 the folder can only be written with the legacy storage
        // permission, which the user has to grant once; the call resumes in the callback
        // instead of dying at the filesystem.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && getPermissionState(PERMISSION_ALIAS) != PermissionState.GRANTED) {
            requestAllPermissions(call, "permissionCallback");
            return;
        }
        runSave(call, dir, file, name);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (getPermissionState(PERMISSION_ALIAS) != PermissionState.GRANTED) {
            call.reject("لم يُسمح بالكتابة في مجلد التنزيلات، فلا يمكن حفظ المحاضرة على الهاتف");
            return;
        }
        String dir = call.getString("dir");
        String file = call.getString("file");
        String name = call.getString("name");
        if (dir == null || file == null || name == null) {
            call.reject("بيانات الحفظ غير صحيحة");
            return;
        }
        runSave(call, dir, file, name);
    }

    /** Takes one lecture out of `Download/قُرّة`. The listener's own file manager stays the */
    /* other way to do it; this is the one the app can offer. */
    @PluginMethod
    public void remove(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty()) {
            call.reject("اسم الملف غير صحيح");
            return;
        }

        Thread worker = new Thread(() -> {
            try {
                boolean removed = false;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContext().getContentResolver();
                    Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                    String[] projection = { MediaStore.Downloads._ID };
                    try (Cursor cursor = resolver.query(
                            collection,
                            projection,
                            MediaStore.Downloads.DISPLAY_NAME + " = ? AND " + MediaStore.Downloads.RELATIVE_PATH + " = ?",
                            new String[] { name, RELATIVE_PATH },
                            null)) {
                        while (cursor != null && cursor.moveToNext()) {
                            Uri uri = ContentUris.withAppendedId(collection, cursor.getLong(0));
                            removed |= resolver.delete(uri, null, null) > 0;
                        }
                    }
                } else {
                    File file = publicFile(name);
                    removed = file.isFile() && file.delete();
                }

                JSObject result = new JSObject();
                result.put("removed", removed);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("تعذّر حذف الملف من الهاتف", error);
            }
        }, "zad-phone-remove");
        worker.start();
    }
}
