package dev.hui.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

/**
 * What another app's Share sheet hands the app, and the address it becomes: the text a share offers (and everything it
 * refuses), the two bounds on it, and the encoding of `<gateway>/new-session?share=…`. Pure Java and JUnit 4, so it runs
 * on the host JVM beside {@code DeepLinkTest}: the intent reads themselves are {@link MainActivity}'s and a device's.
 */
public class ShareTargetTest {

    private static final String GATEWAY = "https://hui.example.ts.net";

    /** A {@link CharSequence} that is not a {@link String}, the way a {@code SpannedString} from X arrives. */
    private static final class Spanned implements CharSequence {
        private final String value;

        Spanned(String value) {
            this.value = value;
        }

        @Override
        public int length() {
            return value.length();
        }

        @Override
        public char charAt(int index) {
            return value.charAt(index);
        }

        @Override
        public CharSequence subSequence(int start, int end) {
            return value.subSequence(start, end);
        }

        @Override
        public String toString() {
            return value;
        }
    }

    @Test
    public void aSharedLinkIsTheTextNewSessionStartsWith() {
        ShareTarget.Share share = ShareTarget.parse("text/plain", "https://x.com/danifdz/status/1987654321098765432", null, false);
        assertEquals("https://x.com/danifdz/status/1987654321098765432", share.text);
        assertFalse("a link is not an image", share.image);
    }

    @Test
    public void aSharedTextIsKeptAsItWasShared() {
        assertEquals("Look at this\n\ttwo lines", ShareTarget.parse("text/plain", "Look at this\n\ttwo lines", null, false).text);
        // X and others send EXTRA_TEXT as a SpannedString: a CharSequence that is not a String is text all the same.
        assertEquals("Look at this", ShareTarget.parse("text/plain", new Spanned("Look at this"), null, false).text);
        // A `\r\n` is one line break, and a bare `\r` is the same one.
        assertEquals("a\nb\nc", ShareTarget.parse("text/plain", "a\r\nb\rc", null, false).text);
    }

    @Test
    public void textBesideAnImageIsTheText() {
        ShareTarget.Share share = ShareTarget.parse("image/png", "Look at this", "content://media/external/images/1", true);
        assertEquals("the composer takes the words, and the image is left out", "Look at this", share.text);
        assertTrue("the app still knows an image came with it", share.image);
    }

    @Test
    public void anImageOnItsOwnIsNotSomethingNewSessionCanTake() {
        ShareTarget.Share image = ShareTarget.parse("image/png", null, null, true);
        assertNull("the composer has no place for a photo from the sheet", image.text);
        assertTrue("the shell has to say the image was left behind", image.image);
        // A photo that arrives as a content: URI in the data is a photo too, not text.
        ShareTarget.Share fromData = ShareTarget.parse("image/jpeg", null, "content://media/external/images/2", true);
        assertNull(fromData.text);
        assertTrue(fromData.image);
    }

    @Test
    public void aShareWithNoTextHuiCanHoldOffersNothing() {
        assertNull(ShareTarget.parse("text/plain", null, null, false).text);
        assertNull("an empty extra is no text", ShareTarget.parse("text/plain", "", null, false).text);
        assertNull("whitespace is no text", ShareTarget.parse("text/plain", "   \n\t ", null, false).text);
        assertNull("another app can put a number under EXTRA_TEXT", ShareTarget.parse("text/plain", 42, null, false).text);
        assertNull("a type with no value under it", ShareTarget.parse(null, null, null, false).text);
        assertNull("a content: URI is a file, not a link", ShareTarget.parse("text/plain", null, "content://com.example/note.txt", false).text);
        assertNull("a mailto: address is not one the gateway opens", ShareTarget.parse("text/plain", null, "mailto:someone@example.com", false).text);
        assertNull("data is read for a text/* type only", ShareTarget.parse("image/png", null, "https://x.com/a", false).text);
        assertNull("an encoded scheme is not an http(s) address", ShareTarget.parse("text/plain", null, "https%3A%2F%2Fx.com%2Fa", false).text);
        assertNull("an http: with no host names nothing", ShareTarget.parse("text/plain", null, "http://", false).text);
        assertNull("nor does a broken address", ShareTarget.parse("text/plain", null, "https://x.com/a b", false).text);
        assertFalse("none of these carried an image", ShareTarget.parse("text/plain", null, null, false).image);
    }

    @Test
    public void aTextTypeThatNamesItsLinkInTheDataIsRead() {
        assertEquals("https://x.com/a", ShareTarget.parse("text/plain", null, "https://x.com/a", false).text);
        assertEquals("http://127.0.0.1:47400/settings", ShareTarget.parse("text/plain", null, "http://127.0.0.1:47400/settings", false).text);
        // The extra wins over the data when an app sets both.
        assertEquals("the extra", ShareTarget.parse("text/plain", "the extra", "https://x.com/a", false).text);
        // And data that is no link leaves a blank extra with nothing at all.
        assertNull(ShareTarget.parse("text/plain", " ", "content://com.example/a", false).text);
    }

    @Test
    public void aShareIsCappedAtEightThousandCharactersOnACharacterBoundary() {
        assertEquals(8_000, ShareTarget.MAX_CHARACTERS);
        String tooLong = "a".repeat(ShareTarget.MAX_CHARACTERS + 1);
        assertEquals(ShareTarget.MAX_CHARACTERS, ShareTarget.parse("text/plain", tooLong, null, false).text.length());

        // 7 999 characters then five emoji: the cut keeps whole emoji, never half of one.
        String emoji = "\uD83D\uDE00";
        String text = "a".repeat(ShareTarget.MAX_CHARACTERS - 1) + emoji.repeat(5);
        String capped = ShareTarget.parse("text/plain", text, null, false).text;
        assertEquals("a".repeat(ShareTarget.MAX_CHARACTERS - 1) + emoji, capped);
        assertEquals(ShareTarget.MAX_CHARACTERS, capped.codePointCount(0, capped.length()));
        assertFalse("no pair is split", Character.isHighSurrogate(capped.charAt(capped.length() - 1)));
    }

    @Test
    public void anAddressPastThirtyTwoKilobytesIsRefused() {
        // Nine bytes per character once encoded: 8 000 of them are past the address's own bound, even though the text is
        // inside its cap. The whole share is refused rather than half-opened.
        String wide = "\u5B57".repeat(ShareTarget.MAX_CHARACTERS);
        String text = ShareTarget.parse("text/plain", wide, null, false).text;
        assertEquals(ShareTarget.MAX_CHARACTERS, text.codePointCount(0, text.length()));
        assertNull(ShareTarget.url(GATEWAY, text));

        // 8 000 ASCII characters fit, so the bound is the address's and not a second text cap.
        String ascii = ShareTarget.url(GATEWAY, "a".repeat(ShareTarget.MAX_CHARACTERS));
        assertTrue(ascii.startsWith(GATEWAY + "/new-session?share="));
        assertTrue(ascii.getBytes(StandardCharsets.UTF_8).length <= ShareTarget.MAX_URL_BYTES);
    }

    @Test
    public void theTextIsEncodedOnceIntoTheQuery() {
        String text = "a&b=c #tag 100% +1\nline\tbreak";
        String address = ShareTarget.url(GATEWAY, text);
        assertEquals(GATEWAY + "/new-session?share=a%26b%3Dc+%23tag+100%25+%2B1%0Aline%09break", address);
        // What the page's URLSearchParams reads back is exactly what was shared: one decode, no double encoding.
        String query = address.substring(address.indexOf("?share=") + "?share=".length());
        assertEquals(text, URLDecoder.decode(query, StandardCharsets.UTF_8));
    }

    @Test
    public void aShareWithAControlCharacterOrAnUnpairedSurrogateIsRefused() {
        assertNull("a NUL cannot travel in an address", ShareTarget.parse("text/plain", "a\u0000b", null, false).text);
        assertNull("nor can another control character", ShareTarget.parse("text/plain", "a\u0007b", null, false).text);
        assertNull("a control character at the end refuses the share too", ShareTarget.parse("text/plain", "a\rb\u001B", null, false).text);
        assertNull("an unpaired high surrogate", ShareTarget.parse("text/plain", "a\uD83Db", null, false).text);
        assertNull("an unpaired low surrogate", ShareTarget.parse("text/plain", "a\uDE00b", null, false).text);
        assertNull("a value that only points at nothing", ShareTarget.url(GATEWAY, null));
    }

    @Test
    public void theAddressIsTheGatewaysOwnNewSession() {
        assertEquals("https://hui.example.ts.net/new-session?share=hi", ShareTarget.url(GATEWAY, "hi"));
        assertEquals("http://127.0.0.1:47400/new-session?share=hi", ShareTarget.url("http://127.0.0.1:47400", "hi"));
        assertNull("no gateway, nowhere to open it", ShareTarget.url(null, "hi"));
        assertNull(ShareTarget.url(GATEWAY, null));
        assertNull("an empty value names nothing", ShareTarget.url(GATEWAY, ""));
    }
}
