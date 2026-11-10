package dev.hui.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * The name and colour the shell reads back out of what the page or the server said: the file name a download is saved
 * under (a bot export and the diagnostics both carry theirs in the anchor) and the status bar's colour.
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
    public void readsTheColourThePageComputed() {
        assertEquals(Integer.valueOf(0xFF0E1015), ShellColor.parse("rgb(14, 16, 21)"));
        assertEquals(Integer.valueOf(0xFF0E1015), ShellColor.parse("rgba(14, 16, 21, 1)"));
        assertEquals(Integer.valueOf(0xFFFAF9F7), ShellColor.parse("#faf9f7"));
        assertEquals(Integer.valueOf(0xFFFFFFFF), ShellColor.parse("#fff"));
        assertNull("a transparent strip is not a colour", ShellColor.parse("rgba(0, 0, 0, 0)"));
        assertNull(ShellColor.parse("transparent"));
        assertNull(ShellColor.parse("light-dark(#fff, #000)"));
        assertNull(ShellColor.parse(""));
        assertNull(ShellColor.parse(null));
    }

    @Test
    public void quotesWhatItPutsInThePage() {
        assertEquals("\"https://hui/a\"", ShellPage.jsString("https://hui/a"));
        assertEquals("\"a\\\"b\\\\c\"", ShellPage.jsString("a\"b\\c"));
        assertEquals("null", ShellPage.jsString(null));
    }
}
