package dev.hui.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * The `hui://open?path=…` deep link: the path a link may name, and everything the app refuses so a link can never point
 * the WebView at an address the user did not connect to. Pure {@link java.net.URI} logic, so it runs on the host JVM.
 */
public class DeepLinkTest {

    @Test
    public void takesThePathTheLinkNames() {
        assertEquals("/sessions/abc", DeepLink.path("hui://open?path=/sessions/abc"));
        assertEquals("/settings", DeepLink.path("HUI://OPEN?path=/settings"));
        assertEquals("/", DeepLink.path("hui://open?path=/"));
        // The path keeps its own query and encoding: only the link's `path` parameter is read, and the WebView is what
        // decides which characters need encoding.
        assertEquals("/settings", DeepLink.path("hui://open?path=/settings&other=1"));
        assertEquals("/settings", DeepLink.path("hui://open?other=1&path=/settings"));
        assertEquals("/a%20b", DeepLink.path("hui://open?path=/a%20b"));
    }

    @Test
    public void refusesAnythingItCannotPrefixToTheGatewaysAddress() {
        assertNull(DeepLink.path(null));
        assertNull("no parameter", DeepLink.path("hui://open"));
        assertNull("an empty value names nothing", DeepLink.path("hui://open?path="));
        assertNull("a path, not a relative address", DeepLink.path("hui://open?path=sessions"));
        assertNull("a scheme would replace the gateway", DeepLink.path("hui://open?path=http://evil.example/"));
        assertNull("an encoded scheme is still a scheme", DeepLink.path("hui://open?path=/a%3A%2F%2Fb"));
        assertNull("an encoded slash breaks the prefix", DeepLink.path("hui://open?path=%2Fsessions"));
        assertNull("another app's scheme", DeepLink.path("https://open?path=/sessions"));
        assertNull("another host on our scheme", DeepLink.path("hui://elsewhere?path=/sessions"));
        assertNull("no scheme at all", DeepLink.path("open?path=/sessions"));
    }

    @Test
    public void namesTheScreenOnTheGatewaysOwnAddress() {
        assertEquals("https://hui.example.ts.net/sessions", DeepLink.url("https://hui.example.ts.net", "/sessions"));
        assertEquals("http://127.0.0.1:47406/settings", DeepLink.url("http://127.0.0.1:47406", "/settings"));
        assertNull(DeepLink.url(null, "/sessions"));
        assertNull(DeepLink.url("https://hui.example.ts.net", null));
    }
}
