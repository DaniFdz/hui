package dev.hui.app;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A colour the page reported, read back as an Android colour. The page answers with what CSS computed — `rgb(14, 16,
 * 21)`, `rgba(14, 16, 21, 1)` or `#0e1015` — because HUI's theme tokens are expressions (`light-dark(…)`,
 * `color-mix(…)`) that only the browser can resolve (`src/lib/boot-screen.ts` reads them the same way).
 *
 * <p>Pure Java, so {@code ShellColorTest} pins it on the host JVM.
 */
final class ShellColor {

    private static final Pattern FUNCTIONAL = Pattern.compile(
        "rgba?\\(\\s*([0-9.]+)[,\\s]+([0-9.]+)[,\\s]+([0-9.]+)(?:[,\\s/]+([0-9.]+%?))?\\s*\\)",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern HEX = Pattern.compile("#([0-9a-f]{3,8})", Pattern.CASE_INSENSITIVE);

    private ShellColor() {}

    /** The colour, opaque and 0xAARRGGBB, or `null` when the page's answer is not one. */
    static Integer parse(String css) {
        if (css == null) return null;
        String value = css.trim();
        if (value.isEmpty() || value.equalsIgnoreCase("transparent")) return null;
        Matcher functional = FUNCTIONAL.matcher(value);
        if (functional.matches()) {
            String alpha = functional.group(4);
            if (alpha != null) {
                boolean percent = alpha.endsWith("%");
                double parsed = Double.parseDouble(percent ? alpha.substring(0, alpha.length() - 1) : alpha);
                if (percent ? parsed < 99 : parsed < 0.99) return null;
            }
            return 0xFF000000 | (channel(functional.group(1)) << 16) | (channel(functional.group(2)) << 8) | channel(functional.group(3));
        }
        Matcher hex = HEX.matcher(value);
        if (!hex.matches()) return null;
        String digits = hex.group(1);
        if (digits.length() == 3 || digits.length() == 4) {
            StringBuilder wide = new StringBuilder(digits.length() * 2);
            for (int at = 0; at < digits.length(); at++) wide.append(digits.charAt(at)).append(digits.charAt(at));
            digits = wide.toString();
        }
        try {
            if (digits.length() == 6) return 0xFF000000 | Integer.parseInt(digits, 16);
            if (digits.length() == 8) {
                long colour = Long.parseLong(digits, 16);
                if (((colour >>> 24) & 0xFF) < 0xFC) return null;
                return (int) (0xFF000000L | (colour & 0xFFFFFFL));
            }
        } catch (NumberFormatException ex) {
            return null;
        }
        return null;
    }

    private static int channel(String value) {
        return Math.max(0, Math.min(255, (int) Math.round(Double.parseDouble(value))));
    }
}
