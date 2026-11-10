package dev.hui.app;

import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.widget.Toast;

import com.getcapacitor.Bridge;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Downloads inside the app, and one toast saying what happened to each.
 *
 * <p>Two paths, because the web UI downloads two kinds of thing. A file the gateway serves over `http(s)` goes to the
 * system download manager: it keeps the name from `Content-Disposition` (or the anchor's, when the page's own script
 * handed it over through {@link HuiShellPlugin}), shows its progress in the notification shade and needs no permission.
 * A `blob:` or `data:` URL the page made itself is saved by the app: the bytes come from the page (they exist nowhere
 * else) and {@link #saveBytes} writes them to Downloads.
 */
final class ShellDownloads {

    /** The name a download gets when neither the server nor the page named it. */
    static final String DEFAULT_NAME = "hui-download";

    private ShellDownloads() {}

    /** The WebView's own downloads: anything the page started without an anchor click of its own. */
    static void attach(MainActivity activity, Bridge bridge) {
        bridge.getWebView().setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                start(activity, bridge, url, userAgent, contentDisposition, mimeType);
            }
        });
    }

    private static void start(MainActivity activity, Bridge bridge, String url, String userAgent, String disposition, String mime) {
        String name = fileName(disposition, url, mime);
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            // The bytes live in the page; it fetches them and answers through HuiShellPlugin.
            ShellPage.save(bridge, url, name);
            return;
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            say(activity, activity.getString(R.string.download_unsupported));
            return;
        }
        download(activity, url, userAgent, name, mime, bridge.getAppUrl());
    }

    /**
     * Hand one `http(s)` download to the system download manager, keeping `name` when the platform lets the app choose
     * the destination. Before Android 10 that destination needs a storage permission the app does not ask for, so the
     * manager picks the name itself there (from `Content-Disposition`, then the URL).
     *
     * <p>A download of the gateway's own route carries the `x-hui` header the page's own fetches carry
     * (`server/http/route.ts`): the manager's request is not a browser fetch, so it has no `sec-fetch-site` for the
     * gateway to trust, and without the header an attachment would answer 403. `gateway` is the address the app runs on.
     */
    static void download(Context context, String url, String userAgent, String name, String mime, String gateway) {
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) request.addRequestHeader("Cookie", cookie);
        if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
        if (gateway != null && ShellLinks.target(gateway, url) == ShellLinks.Target.IN_APP) request.addRequestHeader("x-hui", "1");
        if (mime != null && !mime.isEmpty()) request.setMimeType(mime);
        request.setTitle(name);
        request.setDescription(context.getString(R.string.download_description));
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            say(context, context.getString(R.string.download_failed));
            return;
        }
        try {
            manager.enqueue(request);
        } catch (RuntimeException ex) {
            say(context, context.getString(R.string.download_failed));
            return;
        }
        say(context, context.getString(R.string.downloading, name));
    }

    /**
     * Write the bytes the page sent into Downloads and answer the folder they went to, so the app can say where. Android
     * 10 and later writes through MediaStore, which needs no permission; older releases fall back to the app's own
     * external files directory, which every file manager can reach under `Android/data`. The answer is the folder as a
     * person reads it, for the toast and for the page.
     */
    static String saveBytes(Context context, String requested, String mime, byte[] bytes) throws IOException {
        String name = sanitize(requested);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri entry = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (entry == null) throw new IOException("the system did not open a Downloads entry");
            try (OutputStream stream = context.getContentResolver().openOutputStream(entry)) {
                if (stream == null) throw new IOException("the Downloads entry has no stream");
                stream.write(bytes);
            } catch (IOException ex) {
                context.getContentResolver().delete(entry, null, null);
                throw ex;
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            context.getContentResolver().update(entry, values, null, null);
            return "Downloads";
        }
        File directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (directory == null) directory = context.getFilesDir();
        File file = free(directory, name);
        try (FileOutputStream stream = new FileOutputStream(file)) {
            stream.write(bytes);
        }
        return directory.getAbsolutePath();
    }

    /** A file in `directory` that does not exist yet: `name`, then `name (1)`, as the system's own downloads do. */
    private static File free(File directory, String name) {
        File file = new File(directory, name);
        int dot = name.lastIndexOf('.');
        String stem = dot <= 0 ? name : name.substring(0, dot);
        String extension = dot <= 0 ? "" : name.substring(dot);
        for (int attempt = 1; file.exists() && attempt < 1000; attempt++) file = new File(directory, stem + " (" + attempt + ")" + extension);
        return file;
    }

    /** Say what happened to one download, from the app's own thread. */
    static void say(Context context, String message) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }

    /**
     * The name a download should be saved under: what `Content-Disposition` says, else the page's own name, else the
     * URL's last segment, else {@link #DEFAULT_NAME} with an extension for the type.
     */
    static String fileName(String disposition, String url, String mime) {
        String named = fromDisposition(disposition);
        if (named == null) named = fromUrl(url);
        if (named == null || named.isEmpty()) named = DEFAULT_NAME + extension(mime);
        return sanitize(named);
    }

    /** `filename*=UTF-8''…` (RFC 5987) or `filename="…"` out of a `Content-Disposition` header. */
    private static String fromDisposition(String disposition) {
        if (disposition == null) return null;
        for (String part : disposition.split(";")) {
            String value = part.trim();
            String lower = value.toLowerCase(Locale.ROOT);
            if (lower.startsWith("filename*=")) {
                String encoded = value.substring("filename*=".length()).trim();
                int quotes = encoded.indexOf("''");
                if (quotes >= 0) encoded = encoded.substring(quotes + 2);
                return decode(encoded.replace("\"", ""));
            }
            if (lower.startsWith("filename=")) return decode(value.substring("filename=".length()).trim().replace("\"", ""));
        }
        return null;
    }

    private static String fromUrl(String url) {
        if (url == null) return null;
        int cut = url.length();
        for (char stop : new char[] { '?', '#' }) {
            int at = url.indexOf(stop);
            if (at >= 0 && at < cut) cut = at;
        }
        String path = url.substring(0, cut);
        int slash = path.lastIndexOf('/');
        String segment = slash >= 0 ? path.substring(slash + 1) : path;
        int colon = segment.lastIndexOf(':');
        if (colon >= 0) segment = segment.substring(colon + 1);
        return decode(segment);
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ex) {
            return value;
        }
    }

    /** A name safe to write: no directories, no control characters, and short enough for a file system. */
    static String sanitize(String name) {
        if (name == null) return DEFAULT_NAME;
        StringBuilder out = new StringBuilder(name.length());
        for (int at = 0; at < name.length(); at++) {
            char character = name.charAt(at);
            out.append(character < 0x20 || character == '/' || character == '\\' || character == ':' ? '-' : character);
        }
        String cleaned = out.toString().trim();
        // Nothing hidden, nothing that climbs: a leading dot or dash would make a hidden file or an option.
        while (!cleaned.isEmpty() && (cleaned.charAt(0) == '.' || cleaned.charAt(0) == '-')) cleaned = cleaned.substring(1);
        if (cleaned.isEmpty()) return DEFAULT_NAME;
        return cleaned.length() > 120 ? cleaned.substring(0, 120) : cleaned;
    }

    /** The extension a file of this type needs when nothing named it, so a saved export opens in the right app. */
    static String extension(String mime) {
        if (mime == null) return "";
        switch (mime.toLowerCase(Locale.ROOT).split(";")[0].trim()) {
            case "application/json":
                return ".json";
            case "text/csv":
                return ".csv";
            case "text/plain":
                return ".txt";
            case "text/html":
                return ".html";
            case "text/markdown":
                return ".md";
            case "application/zip":
                return ".zip";
            case "image/png":
                return ".png";
            case "image/jpeg":
                return ".jpg";
            case "image/svg+xml":
                return ".svg";
            case "application/pdf":
                return ".pdf";
            default:
                return "";
        }
    }
}
