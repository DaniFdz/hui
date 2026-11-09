package dev.hui.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

/**
 * The native gateway-address check the Connect page's `connect` call passes through: http(s) only, normalized, and
 * anything else refused. Every case comes from `mobile/gateway-addresses.txt`, which `mobile/connect/src/gateway.test.ts`
 * reads too, so the page and the app cannot start accepting different addresses. It runs on the JVM
 * (`./gradlew testDebugUnitTest`), which is what the build CI job proves.
 */
public class GatewayAddressTest {

    /** The shared cases, from the path Gradle passes in; skipped when it is absent (an IDE run outside Gradle). */
    private static List<String[]> cases() throws IOException {
        String fixture = System.getProperty("hui.gatewayFixture");
        if (fixture == null) return new ArrayList<>();
        List<String[]> cases = new ArrayList<>();
        for (String line : Files.readAllLines(Paths.get(fixture), StandardCharsets.UTF_8)) {
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] parts = line.split(" -> ", -1);
            String raw = parts[0].trim();
            String expected = parts.length > 1 ? parts[1].trim() : "";
            cases.add(new String[] { raw, expected.isEmpty() ? null : expected });
        }
        return cases;
    }

    @Test
    public void matchesTheSharedCases() throws IOException {
        List<String[]> cases = cases();
        assertTrue("hui.gatewayFixture must name mobile/gateway-addresses.txt", cases.size() > 5);
        for (String[] item : cases) {
            if (item[1] == null) assertNull("refused: " + item[0], GatewayAddress.normalize(item[0]));
            else assertEquals("accepted: " + item[0], item[1], GatewayAddress.normalize(item[0]));
        }
    }

    @Test
    public void refusesWhatTheSharedCasesDoNotName() {
        assertNull(GatewayAddress.normalize(null));
        assertNull(GatewayAddress.normalize(""));
        assertNull(GatewayAddress.normalize("file:///etc/hosts"));
        assertNull(GatewayAddress.normalize("https://host:notaport"));
    }
}
