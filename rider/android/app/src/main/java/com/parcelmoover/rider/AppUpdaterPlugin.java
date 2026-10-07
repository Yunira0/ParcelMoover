package com.parcelmoover.rider;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * In-app updater for sideloaded builds (we don't ship through Play).
 *
 * The web layer (src/lib/appUpdater.ts) owns the flow and the UI; this plugin
 * only does what the WebView can't: read the installed version, fetch the
 * release manifest without CORS, download + verify the APK, manage the
 * "Install unknown apps" permission, and hand the file to the system installer.
 *
 * Android itself guarantees the update lands over the existing install (keeping
 * localStorage, so the rider stays logged in) only when the package id and
 * signing key match and versionCode is higher. We check all three before
 * offering to install, so a bad release fails here with a clear message
 * instead of the system installer's generic "App not installed".
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String UPDATES_DIR = "updates";
    private static final int MANIFEST_MAX_BYTES = 256 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);

    @Override
    public void load() {
        // Drop APKs for versions that are already installed (the update went
        // through) so old downloads don't pile up in the cache.
        executor.execute(() -> {
            File[] files = updatesDir().listFiles();
            if (files == null) return;
            long installed = installedVersionCode();
            for (File f : files) {
                long code = versionCodeFromFileName(f.getName());
                if (code <= installed) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
        });
    }

    // The WebView doesn't reliably get visibilitychange when the activity
    // resumes, so tell JS directly - the updater re-checks install permission
    // and pending installs when the rider comes back from Settings/installer.
    @Override
    protected void handleOnResume() {
        notifyListeners("appResumed", new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageInfo info = packageInfo(getContext().getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("versionName", info.versionName);
            ret.put("versionCode", versionCodeOf(info));
            ret.put("packageName", info.packageName);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read app version", e);
        }
    }

    /** GET a small JSON document natively (no WebView CORS rules apply). */
    @PluginMethod
    public void fetchManifest(PluginCall call) {
        String url = call.getString("url");
        if (!isAllowedUrl(url)) {
            call.reject("Manifest URL must be https");
            return;
        }
        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = open(url);
                conn.setRequestProperty("Accept", "application/json");
                // Bypass any intermediate cache - a stale manifest means a
                // rider never hears about the new version.
                conn.setUseCaches(false);
                conn.setRequestProperty("Cache-Control", "no-cache");
                int status = conn.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) {
                    call.reject("Update check failed (HTTP " + status + ")");
                    return;
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = conn.getInputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                        if (out.size() > MANIFEST_MAX_BYTES) {
                            call.reject("Update manifest is too large");
                            return;
                        }
                    }
                }
                JSObject ret = new JSObject();
                ret.put("body", out.toString(StandardCharsets.UTF_8.name()));
                call.resolve(ret);
            } catch (IOException e) {
                call.reject("Update check failed: " + e.getMessage(), e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    /**
     * Download the APK, verify its SHA-256 against the manifest, then verify it
     * is a newer build of this same app signed with the same key.
     * Emits "downloadProgress" events: { downloadedBytes, totalBytes }.
     */
    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String url = call.getString("url");
        String expectedSha = call.getString("sha256", "");
        // JS numbers arrive as Integer or Long depending on size; getLong()
        // returns null for the Integer case, so read it as a plain Number.
        Object rawVersionCode = call.getData().opt("versionCode");
        long versionCode = rawVersionCode instanceof Number ? ((Number) rawVersionCode).longValue() : -1;
        if (!isAllowedUrl(url)) {
            call.reject("APK URL must be https");
            return;
        }
        if (expectedSha == null || !expectedSha.matches("(?i)[0-9a-f]{64}")) {
            call.reject("Update manifest has no valid sha256");
            return;
        }
        if (versionCode <= installedVersionCode()) {
            call.reject("This version is already installed");
            return;
        }
        if (!downloading.compareAndSet(false, true)) {
            call.reject("An update is already downloading");
            return;
        }

        executor.execute(() -> {
            File dir = updatesDir();
            File apk = new File(dir, "pm-rider-" + versionCode + ".apk");
            File part = new File(dir, "pm-rider-" + versionCode + ".apk.part");
            HttpURLConnection conn = null;
            try {
                // Already downloaded (e.g. the rider came back from the
                // permission screen) - reuse it if it still verifies.
                if (!(apk.exists() && expectedSha.equalsIgnoreCase(sha256Of(apk)))) {
                    conn = open(url);
                    int status = conn.getResponseCode();
                    if (status != HttpURLConnection.HTTP_OK) {
                        throw new IOException("Download failed (HTTP " + status + ")");
                    }
                    long total = conn.getContentLengthLong();
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");
                    long done = 0;
                    long lastEmit = 0;
                    try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            out.write(buf, 0, n);
                            digest.update(buf, 0, n);
                            done += n;
                            long now = System.currentTimeMillis();
                            if (now - lastEmit > 200) {
                                lastEmit = now;
                                emitProgress(done, total);
                            }
                        }
                    }
                    emitProgress(done, total);
                    if (!expectedSha.equalsIgnoreCase(toHex(digest.digest()))) {
                        throw new IOException("Downloaded file is corrupted (checksum mismatch). Please try again.");
                    }
                    if (apk.exists() && !apk.delete()) {
                        throw new IOException("Could not replace an older download");
                    }
                    if (!part.renameTo(apk)) {
                        throw new IOException("Could not save the download");
                    }
                }

                verifyArchive(apk, versionCode);

                JSObject ret = new JSObject();
                ret.put("path", apk.getAbsolutePath());
                call.resolve(ret);
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                call.reject(e.getMessage() != null ? e.getMessage() : "Download failed", e);
            } finally {
                if (conn != null) conn.disconnect();
                downloading.set(false);
            }
        });
    }

    /** Whether this app may currently ask the system to install APKs. */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", canRequestInstalls());
        call.resolve(ret);
    }

    /**
     * Open this app's "Install unknown apps" toggle. Resolves when the rider
     * comes back, with { allowed } reflecting what they chose.
     */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            JSObject ret = new JSObject();
            ret.put("allowed", true);
            call.resolve(ret);
            return;
        }
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        startActivityForResult(call, intent, "installSettingsResult");
    }

    @ActivityCallback
    private void installSettingsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        ret.put("allowed", canRequestInstalls());
        call.resolve(ret);
    }

    /**
     * Hand a verified APK to the system installer. Android shows its own
     * confirmation; the app process is replaced once the rider accepts.
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("Missing path");
            return;
        }
        File apk = new File(path);
        try {
            // Only ever install files this plugin downloaded and verified.
            if (!apk.getCanonicalFile().getParentFile().equals(updatesDir().getCanonicalFile()) || !apk.exists()) {
                call.reject("Update file not found - please download it again");
                return;
            }
        } catch (IOException e) {
            call.reject("Update file not found - please download it again", e);
            return;
        }
        if (!canRequestInstalls()) {
            call.reject("Install permission not granted", "PERMISSION_REQUIRED");
            return;
        }
        Context ctx = getContext();
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the installer", e);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void verifyArchive(File apk, long expectedVersionCode) throws IOException {
        PackageManager pm = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (archive == null) {
            //noinspection ResultOfMethodCallIgnored
            apk.delete();
            throw new IOException("Downloaded file is not a valid app");
        }
        String pkg = getContext().getPackageName();
        if (!pkg.equals(archive.packageName)) {
            //noinspection ResultOfMethodCallIgnored
            apk.delete();
            throw new IOException("Downloaded app is not PM Rider (" + archive.packageName + ")");
        }
        long archiveCode = versionCodeOf(archive);
        if (archiveCode != expectedVersionCode || archiveCode <= installedVersionCode()) {
            //noinspection ResultOfMethodCallIgnored
            apk.delete();
            throw new IOException("Downloaded app has the wrong version (" + archiveCode + ")");
        }
        try {
            Set<String> installedCerts = certsOf(packageInfo(pkg, flags));
            Set<String> archiveCerts = certsOf(archive);
            // Some OEM builds don't report signatures for archives; the system
            // installer still enforces the match, so only a positive mismatch
            // is treated as fatal here.
            if (!installedCerts.isEmpty() && !archiveCerts.isEmpty() && !installedCerts.equals(archiveCerts)) {
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
                throw new IOException("This update is signed with a different key and cannot be installed over the current app. Contact support.");
            }
        } catch (PackageManager.NameNotFoundException ignored) {
            // Can't happen for our own package.
        }
    }

    /** SHA-256 fingerprints of the certificates the APK is currently signed with. */
    @SuppressWarnings("deprecation")
    private static Set<String> certsOf(PackageInfo info) {
        Signature[] sigs = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (info.signingInfo != null) sigs = info.signingInfo.getApkContentsSigners();
        } else {
            sigs = info.signatures;
        }
        Set<String> out = new HashSet<>();
        if (sigs == null) return out;
        for (Signature s : sigs) {
            try {
                out.add(toHex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())));
            } catch (Exception ignored) {
                // SHA-256 is always available
            }
        }
        return out;
    }

    private void emitProgress(long done, long total) {
        JSObject data = new JSObject();
        data.put("downloadedBytes", done);
        data.put("totalBytes", total);
        notifyListeners("downloadProgress", data);
    }

    private boolean canRequestInstalls() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private boolean isAllowedUrl(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase(Locale.ROOT);
        if (lower.startsWith("https://")) return true;
        // Debug builds may test against a manifest served from the dev machine.
        boolean debuggable = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        return debuggable && lower.startsWith("http://");
    }

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
        conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
        conn.setReadTimeout(READ_TIMEOUT_MS);
        conn.setInstanceFollowRedirects(true); // GitHub release assets redirect to their CDN
        conn.setRequestProperty("User-Agent", "PM-Rider-Updater");
        return conn;
    }

    private File updatesDir() {
        File dir = new File(getContext().getCacheDir(), UPDATES_DIR);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    private long installedVersionCode() {
        try {
            return versionCodeOf(packageInfo(getContext().getPackageName(), 0));
        } catch (PackageManager.NameNotFoundException e) {
            return Long.MAX_VALUE;
        }
    }

    @SuppressWarnings("deprecation")
    private PackageInfo packageInfo(String pkg, int flags) throws PackageManager.NameNotFoundException {
        PackageManager pm = getContext().getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(flags));
        }
        return pm.getPackageInfo(pkg, flags);
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private static long versionCodeFromFileName(String name) {
        // pm-rider-10400.apk / pm-rider-10400.apk.part
        String digits = name.replaceAll("^pm-rider-(\\d+)\\.apk(\\.part)?$", "$1");
        try {
            return Long.parseLong(digits);
        } catch (NumberFormatException e) {
            return Long.MIN_VALUE; // unknown file - clean it up
        }
    }

    private static String sha256Of(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) digest.update(buf, 0, n);
        }
        return toHex(digest.digest());
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }
}
