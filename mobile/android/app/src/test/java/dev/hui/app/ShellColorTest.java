package dev.hui.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * The status bar's colour, read back out of what the page computed: HUI's theme tokens are expressions (`light-dark(…)`,
 * `color-mix(…)`) that only the browser can resolve, so the page answers with `rgb()`/`rgba()` or a hex value. Pure
 * Java, so it runs on the host JVM.
 */
public class ShellColorTest {

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
}
