package dev.hui.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Where a link the WebView navigates to belongs. Capacitor's own check compares host and scheme, so a gateway reached
 * over the other scheme would leave the app for the browser; this pins the correction, and that everything on another
 * origin still goes to the system.
 */
public class ShellLinksTest {

    private static final String HTTPS = "https://hui.example.ts.net";
    private static final String DEV = "http://127.0.0.1:47406";

    @Test
    public void keepsTheGatewaysOwnPagesInTheApp() {
        assertEquals(ShellLinks.Target.IN_APP, ShellLinks.target(HTTPS, HTTPS + "/"));
        assertEquals(ShellLinks.Target.IN_APP, ShellLinks.target(HTTPS, HTTPS + "/sessions/abc?x=1#y"));
        assertEquals(ShellLinks.Target.IN_APP, ShellLinks.target(HTTPS, "https://HUI.example.ts.net/settings"));
        assertEquals(ShellLinks.Target.IN_APP, ShellLinks.target(HTTPS, "https://hui.example.ts.net:443/"));
        assertEquals(ShellLinks.Target.IN_APP, ShellLinks.target(DEV, DEV + "/sessions"));
        assertEquals(ShellLinks.Target.IN_APP, ShellLinks.target(DEV, "http://127.0.0.1:47406/"));
    }

    @Test
    public void upgradesASchemeOnlyRedirectInsteadOfLeavingTheApp() {
        assertEquals(ShellLinks.Target.UPGRADE, ShellLinks.target(HTTPS, "http://hui.example.ts.net/"));
        assertEquals(ShellLinks.Target.UPGRADE, ShellLinks.target(HTTPS, "http://hui.example.ts.net/sessions/abc?x=1#y"));
        assertEquals(HTTPS + "/sessions/abc?x=1#y", ShellLinks.upgraded(HTTPS, "http://hui.example.ts.net/sessions/abc?x=1#y"));
        assertEquals("https://hui.example.ts.net/", ShellLinks.upgraded(HTTPS, "http://hui.example.ts.net/"));
    }

    @Test
    public void sendsEveryOtherOriginToTheSystem() {
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(HTTPS, "https://example.com/"));
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(HTTPS, "https://hui.example.ts.net.evil.test/"));
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(HTTPS, "https://other.example.ts.net:8443/"));
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(HTTPS, "http://example.com/"));
        // A gateway on another port is another origin, except where the app's own address has no port either.
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(DEV, "http://127.0.0.1:8080/"));
    }

    @Test
    public void handsNonWebSchemesToTheSystem() {
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(HTTPS, "mailto:someone@example.com"));
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(HTTPS, "tel:+15550100"));
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(HTTPS, "intent://scan/#Intent;scheme=zxing;end"));
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(HTTPS, "javascript:alert(1)"));
    }

    @Test
    public void keepsThePagesOwnResourcesInThePage() {
        assertEquals(ShellLinks.Target.IN_APP, ShellLinks.target(HTTPS, "blob:" + HTTPS + "/4b1c0e5f-0000-0000-0000-000000000000"));
        assertEquals(ShellLinks.Target.IN_APP, ShellLinks.target(HTTPS, "data:text/plain,hi"));
        assertEquals(ShellLinks.Target.IN_APP, ShellLinks.target(HTTPS, "about:blank"));
    }

    @Test
    public void leavesAnAddressItCannotReadToTheSystem() {
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(HTTPS, null));
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(HTTPS, ""));
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(null, HTTPS + "/"));
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target("", HTTPS + "/"));
        assertEquals(ShellLinks.Target.EXTERNAL, ShellLinks.target(HTTPS, "not a url"));
    }
}
