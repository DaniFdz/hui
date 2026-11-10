/**
 * The shared e2e suite: HUI's web UI in a browser, and in the Android app's WebView (`android`), each against a disposable
 * gateway started by the visual-verification launcher.
 */
import { execFileSync } from "node:child_process";
import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { PHONE_PORT, phoneCdpEndpoint, phoneReconnectEndpoint } from "./e2e/fixtures/phone.ts";

const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim() || "HEAD";

const launcher = (target: string, port: string, production: boolean) => ({
  executable: "node",
  args: ["e2e/visual-verification.mjs", "launch", "--branch", branch, ...(production ? ["--production"] : []), "--port", port, "--receipt-dir", ".e2e/hui", "--fast-fixture"],
  startupTimeout: 300_000,
  log: `.e2e/logs/hui-${target}.log`,
});

/** The gateway the app's WebView loads: the emulator reaches this host's loopback through `adb reverse`. */
const phoneGateway = `http://127.0.0.1:${PHONE_PORT}`;

/**
 * The same suite against the Android app's WebView, attached over CDP instead of launched (docs/mobile-app-plan.md,
 * WP4). The engine owns one page and one context here, so every attempt relaunches the app; `e2e/fixtures/phone.ts`
 * does that, forwards the DevTools socket and answers the two protocol questions a WebView and a browser disagree on.
 *
 * It needs a running emulator with `dev.hui.app.debug` installed and `adb` on PATH (`nix develop .#android`). Which
 * tests run here is the catalogue's phone status (`e2e/catalogue/phone.ts`), which the job passes as `--tag`.
 */
const phone = {
  name: "android",
  engine: web({
    // A WebView has no context to create, so the attempt rides the app's own; that is the engine's persistent mode.
    connect: { cdpEndpoint: phoneCdpEndpoint(phoneGateway), reconnectEndpoint: phoneReconnectEndpoint(phoneGateway) },
    // The Pixel AVD's CSS pixels (1080x2400 at 2.625). The WebView reports this size itself; the engine would otherwise
    // size a recovered page to its 1280x720 default and hide the phone layout the target exists to check.
    viewport: { width: 412, height: 867 },
  }),
  app: { url: phoneGateway, command: launcher("android", PHONE_PORT, true) },
};

export default {
  tests: "e2e/tests/**/*.e2e.ts",
  retries: 0,
  timeout: 180_000,
  workers: 1,
  assertionTimeout: 15_000,
  actionTimeout: 60_000,
  reporters: ["list", "junit", "markdown"],
  targets: [
    {
      name: "web",
      engine: web({ viewport: { width: 1440, height: 900 } }),
      app: { url: "http://127.0.0.1:0", command: launcher("web", "{port}", true) },
    },
    phone,
  ],
} satisfies E2EConfig;
