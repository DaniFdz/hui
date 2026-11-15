package dev.hui.app;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * What another app's Share sheet hands this one, and the address that opens it: `<gateway>/new-session?share=…`. The web
 * page owns the intake — it turns the value into the composer's seed and takes the query out of the address again
 * (`src/lib/composer/share-seed.ts`, SPEC.md "Share to HUI opens New Session prefilled") — so the shell only has to
 * decide what a share carries and build one address for it.
 *
 * <p>A share carries text, an image or both. Text wins: it is `EXTRA_TEXT`, read as a {@link CharSequence} because X and
 * others send a {@code SpannedString}. An image that arrives beside text is left out of the address rather than
 * refused, and an image on its own is a share New Session cannot take yet: the composer takes words, and a photo would
 * need an upload the shell cannot make. An app that names its link in the intent's own data instead (`ACTION_SEND` with
 * `setData`) is read too, but only for a `text/*` type and only for an `http(s)` address, so the `content:` URI another
 * app offers is never mistaken for text.
 *
 * <p>The value is percent-encoded exactly once, and {@link URLEncoder} is the encoder: its `+` for a space is what the
 * page's `URLSearchParams` reads back as a space, a literal `+` becomes `%2B`, and `&` and `#` are escaped so a share
 * cannot break the query it travels in. It is bounded twice — {@link #MAX_CHARACTERS} of text, cut on a character
 * boundary, and {@link #MAX_URL_BYTES} for the finished address — so no share builds an address a WebView, a proxy or
 * the gateway would refuse, and the two bounds are the ones the iOS half applies (`DeepLink.swift`).
 *
 * <p>Pure Java, with no `android.*` import: `ShareTargetTest` pins it on the host JVM, where `android.net.Uri` is a stub
 * that throws. {@link MainActivity} is what reads the intent, opens the address and drops the share again.
 */
final class ShareTarget {

    /** The page's own route for a session that starts with what was shared; its intake fills the composer from it. */
    static final String PATH = "/new-session?share=";

    /** The most text one share may seed: the cap the page applies to the same value (`SHARE_SEED_LIMIT`). */
    static final int MAX_CHARACTERS = 8_000;

    /** The longest address a share may build: past this a WebView, a proxy or the gateway may refuse it outright. */
    static final int MAX_URL_BYTES = 32 * 1024;

    /** What one share offers the composer. */
    static final class Share {
        /** The text New Session starts with, or `null` when the share carried none HUI can take. */
        final String text;
        /** Whether the share carried an image or a file (`EXTRA_STREAM`), text or not. */
        final boolean image;

        private Share(String text, boolean image) {
            this.text = text;
            this.image = image;
        }
    }

    private ShareTarget() {}

    /**
     * What one share offers New Session. `type` is `Intent#getType()`, `text` the value of `Intent.EXTRA_TEXT` — an
     * {@link Object} because another app can put anything under that key, and the read on the intent side throws for the
     * wrong one — `data` the intent's own URI, and `stream` whether it carries `EXTRA_STREAM`.
     */
    static Share parse(String type, Object text, String data, boolean stream) {
        String shared = text instanceof CharSequence ? text.toString() : null;
        if (shared == null || shared.isBlank()) shared = link(type, data) ? data : null;
        return new Share(shared == null ? null : normalise(shared), stream);
    }

    /**
     * `<gateway>/new-session?share=<encoded text>`: the address the page fills its composer from. `null` when there is no
     * gateway or no text, when the value cannot be encoded, or when the finished address would be longer than
     * {@link #MAX_URL_BYTES}.
     */
    static String url(String gateway, String text) {
        if (gateway == null || text == null || text.isEmpty()) return null;
        String address;
        try {
            address = gateway + PATH + URLEncoder.encode(text, StandardCharsets.UTF_8.name());
        } catch (UnsupportedEncodingException | IllegalArgumentException refused) {
            return null;
        }
        return address.getBytes(StandardCharsets.UTF_8).length <= MAX_URL_BYTES ? address : null;
    }

    /**
     * The value as New Session can take it: a `\r\n` (or a bare `\r`) is one line break, a `\n` and a `\t` are text, and a
     * value past {@link #MAX_CHARACTERS} is cut there on a character boundary, so no surrogate pair is split.
     *
     * <p>`null` when what is kept cannot be carried at all: a control character would reach the composer as something
     * nobody typed, and an unpaired surrogate cannot be encoded — {@link URLEncoder} writes a `?` in its place, which
     * would silently change what was shared. The whole share is refused rather than repaired.
     */
    private static String normalise(String value) {
        String shared = value.replace("\r\n", "\n").replace('\r', '\n');
        StringBuilder kept = new StringBuilder(Math.min(shared.length(), MAX_CHARACTERS));
        int characters = 0;
        for (int at = 0; at < shared.length() && characters < MAX_CHARACTERS; characters++) {
            int point = shared.codePointAt(at);
            at += Character.charCount(point);
            // A pair reads as one code point; half of one reads as the surrogate itself.
            if (point >= Character.MIN_SURROGATE && point <= Character.MAX_SURROGATE) return null;
            if (Character.getType(point) == Character.CONTROL && point != '\n' && point != '\t') return null;
            kept.appendCodePoint(point);
        }
        return kept.toString();
    }

    /**
     * Whether the intent's own data is the text a `text/*` share names there. Only an `http(s)` address with an
     * authority counts: a `content:` or `file:` URI is a document the share is offering, not something the composer can
     * hold, and it must not reach the address as if it were words.
     */
    private static boolean link(String type, String data) {
        if (type == null || data == null || !type.toLowerCase(Locale.ROOT).startsWith("text/")) return false;
        try {
            URI uri = new URI(data);
            String authority = uri.getRawAuthority();
            String scheme = uri.getScheme();
            return authority != null && !authority.isEmpty()
                && ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme));
        } catch (URISyntaxException notAnAddress) {
            return false;
        }
    }
}
