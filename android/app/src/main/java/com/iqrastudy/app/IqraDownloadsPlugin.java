package com.iqrastudy.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.media.MediaScannerConnection;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;

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
import java.io.InputStream;
import java.io.OutputStream;

/**
 * IQRA Scanner S9: copies a PDF from Iqra's private folder into the phone's public
 * Downloads/Iqra folder, and lets Iqra check or delete that copy later.
 *  - Android 10+ : MediaStore (no storage permission needed, the copy belongs to Iqra)
 *  - Android 8-9 : plain file copy (needs WRITE_EXTERNAL_STORAGE, asked once)
 */
@CapacitorPlugin(
    name = "IqraDownloads",
    permissions = { @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage") }
)
public class IqraDownloadsPlugin extends Plugin {

    private static final String FOLDER = "Iqra";

    @PluginMethod
    public void savePdf(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermsCallback");
            return;
        }
        doSave(call);
    }

    @PermissionCallback
    private void storagePermsCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) doSave(call);
        else call.reject("PERMISSION_DENIED");
    }

    private void doSave(final PluginCall call) {
        final String source = call.getString("sourcePath");
        final String name = call.getString("fileName");
        if (source == null || name == null) { call.reject("MISSING_ARGS"); return; }

        new Thread(() -> {
            try {
                File src = new File(source.startsWith("file://") ? Uri.parse(source).getPath() : source);
                if (!src.exists()) { call.reject("SOURCE_MISSING"); return; }
                String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                JSObject res = new JSObject();

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContext().getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) { call.reject("INSERT_FAILED"); return; }
                    OutputStream out = resolver.openOutputStream(uri);
                    if (out == null) { call.reject("OPEN_FAILED"); return; }
                    try (InputStream in = new FileInputStream(src); OutputStream o = out) { copy(in, o); }
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    resolver.update(uri, done, null, null);
                    res.put("uri", uri.toString());
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), FOLDER);
                    if (!dir.exists() && !dir.mkdirs()) { call.reject("MKDIR_FAILED"); return; }
                    File dest = uniqueFile(dir, safe);
                    try (InputStream in = new FileInputStream(src); OutputStream o = new FileOutputStream(dest)) { copy(in, o); }
                    MediaScannerConnection.scanFile(getContext(), new String[] { dest.getAbsolutePath() }, new String[] { "application/pdf" }, null);
                    res.put("uri", Uri.fromFile(dest).toString());
                }
                res.put("folder", "Download/" + FOLDER);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("SAVE_FAILED: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void exists(PluginCall call) {
        String uriStr = call.getString("uri");
        JSObject res = new JSObject();
        res.put("exists", uriStr != null && copyExists(Uri.parse(uriStr)));
        call.resolve(res);
    }

    @PluginMethod
    public void deleteCopy(PluginCall call) {
        String uriStr = call.getString("uri");
        JSObject res = new JSObject();
        boolean deleted = false;
        if (uriStr != null) {
            try {
                Uri uri = Uri.parse(uriStr);
                if ("file".equals(uri.getScheme())) {
                    File f = new File(uri.getPath());
                    deleted = !f.exists() || f.delete();
                } else {
                    deleted = getContext().getContentResolver().delete(uri, null, null) > 0;
                }
            } catch (Exception ignored) { /* treat as not deleted */ }
        }
        res.put("deleted", deleted);
        call.resolve(res);
    }

    /** Free bytes in Iqra's private storage (used for the "storage nearly full" warning). */
    @PluginMethod
    public void freeSpace(PluginCall call) {
        JSObject res = new JSObject();
        try {
            StatFs st = new StatFs(getContext().getFilesDir().getPath());
            res.put("bytes", st.getAvailableBytes());
        } catch (Exception e) {
            res.put("bytes", -1);
        }
        call.resolve(res);
    }

    /** Opens Iqra's page in Android settings (for a denied camera permission). */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** Is Google Play Services installed? The Google scanner can't run without it. */
    @PluginMethod
    public void hasPlayServices(PluginCall call) {
        boolean ok = false;
        try {
            getContext().getPackageManager().getPackageInfo("com.google.android.gms", 0);
            ok = true;
        } catch (Exception ignored) { /* not installed */ }
        JSObject res = new JSObject();
        res.put("available", ok);
        call.resolve(res);
    }

    private boolean copyExists(Uri uri) {
        try {
            if ("file".equals(uri.getScheme())) return new File(uri.getPath()).exists();
            Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (c == null) return false;
            try { return c.moveToFirst(); } finally { c.close(); }
        } catch (Exception e) {
            return false;
        }
    }

    private static File uniqueFile(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        String base = name.endsWith(".pdf") ? name.substring(0, name.length() - 4) : name;
        for (int i = 1; i < 1000; i++) {
            f = new File(dir, base + " (" + i + ").pdf");
            if (!f.exists()) return f;
        }
        return f;
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        out.flush();
    }
}
