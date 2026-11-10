package dev.hui.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The file name a download is saved under (a bot export and the diagnostics both carry theirs in the anchor or in
 * `Content-Disposition`), the size the page may hand the app, and the JavaScript the app hands the page. The colours the
 * page reports are {@code ShellColorTest}'s.
 */
public class ShellDownloadsTest {

    @Test
    public void takesTheNameTheServerSent() {
        assertEquals("hui-diagnostics-2026-11-10.json", ShellDownloads.fileName("attachment; filename=\"hui-diagnostics-2026-11-10.json\"", "https://hui/x", "application/json"));
        assertEquals("report.csv", ShellDownloads.fileName("attachment; filename=report.csv", "https://hui/x", "text/csv"));
        assertEquals("bøt export.zip", ShellDownloads.fileName("attachment; filename*=UTF-8''b%C3%B8t%20export.zip", "https://hui/x", "application/zip"));
    }

    @Test
    public void fallsBackToThePagesOwnNameThenTheUrl() {
        assertEquals("hui-export.json", ShellDownloads.fileName(null, "https://hui/hui-export.json", "application/json"));
        assertEquals("file.txt", ShellDownloads.fileName("attachment", "https://hui/files/file.txt?token=1#top", "text/plain"));
        assertEquals("hui-download.json", ShellDownloads.fileName(null, "https://hui/", "application/json"));
        assertEquals("hui-download", ShellDownloads.fileName(null, "https://hui/", null));
        assertEquals("hui-download", ShellDownloads.fileName("", "", "application/octet-stream"));
    }

    @Test
    public void neverWritesOutsideDownloads() {
        assertEquals("etc-passwd", ShellDownloads.fileName("attachment; filename=\"../../etc/passwd\"", "https://hui/x", null));
        assertEquals("dots", ShellDownloads.sanitize("...dots"));
        assertEquals("hui-download", ShellDownloads.sanitize("   "));
        assertEquals("hui-download", ShellDownloads.sanitize(null));
        assertEquals(120, ShellDownloads.sanitize("a".repeat(200)).length());
    }

    @Test
    public void boundsWhatThePageMayHandTheApp() {
        // 16 MiB, and 4/3 of it in base64 rounded up to a whole group of three bytes, so a payload of exactly the cap
        // still fits and the page's bound and the app's cannot disagree by the last group.
        assertEquals(16, ShellDownloads.MAX_MIB);
        assertEquals(16 * 1024 * 1024, ShellDownloads.MAX_BYTES);
        assertEquals(22_369_624, ShellDownloads.MAX_BASE64);
        long fourThirds = (ShellDownloads.MAX_BYTES * 4L) / 3L;
        assertTrue("no less than 4/3 of the cap", ShellDownloads.MAX_BASE64 >= fourThirds);
        assertTrue("and no more than the rounding above it", ShellDownloads.MAX_BASE64 < fourThirds + 4);
    }

    @Test
    public void quotesWhatItPutsInThePage() {
        assertEquals("\"https://hui/a\"", ShellPage.jsString("https://hui/a"));
        assertEquals("\"a\\\"b\\\\c\"", ShellPage.jsString("a\"b\\c"));
        assertEquals("null", ShellPage.jsString(null));
    }
}
