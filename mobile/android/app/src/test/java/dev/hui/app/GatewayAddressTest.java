package dev.hui.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * The native gateway-address check the Connect page's `connect` call passes through: http(s) only, normalized, and
 * anything else refused. It runs on the JVM (`./gradlew testDebugUnitTest`), which is what the build CI job proves.
 */
public class GatewayAddressTest {

    @Test
    public void keepsAnOriginAndPath() {
        assertEquals("https://my-machine.example.ts.net", GatewayAddress.normalize("https://my-machine.example.ts.net"));
        assertEquals("https://my-machine.example.ts.net", GatewayAddress.normalize("https://my-machine.example.ts.net/"));
        assertEquals("http://127.0.0.1:47402", GatewayAddress.normalize("  http://127.0.0.1:47402/  "));
        assertEquals("https://host.example/hui", GatewayAddress.normalize("https://host.example/hui/"));
        assertEquals("https://host.example/hui", GatewayAddress.normalize("https://host.example/hui//"));
    }

    @Test
    public void refusesAnythingElse() {
        assertNull(GatewayAddress.normalize(null));
        assertNull(GatewayAddress.normalize(""));
        assertNull(GatewayAddress.normalize("my-machine"));
        assertNull(GatewayAddress.normalize("ftp://host"));
        assertNull(GatewayAddress.normalize("file:///etc/hosts"));
        assertNull(GatewayAddress.normalize("javascript:alert(1)"));
        assertNull(GatewayAddress.normalize("https://user:secret@host"));
        assertNull(GatewayAddress.normalize("https://host.example/?a=1"));
        assertNull(GatewayAddress.normalize("https://"));
    }
}
