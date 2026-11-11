/**
 * The shared e2e suite: HUI's web UI in a browser (`web`), in the Android app's WebView (`android`), and in the iPhone's
 * engine at a phone's size (`webkit-phone`), each against a disposable gateway started by the visual-verification
 * launcher.
 */
import { execFileSync } from "node:child_process";
import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { PHONE_PORT, phoneCdpEndpoint, phoneReconnectEndpoint } from "./e2e/fixtures/phone.ts";
import { WEBKIT_PHONE_PORT, webkitPhoneOptions } from "./e2e/fixtures/phone-webkit.ts";
import { webEngine } from "./e2e/fixtures/web-browser.ts";

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

/**
 * The same suite in the engine the iPhone runs, on Linux and with no device: Playwright's WebKit at an iPhone's
 * viewport, which `e2e/fixtures/phone-webkit.ts` completes into a phone (touch and the mobile viewport) and whose
 * gateway's fixed port tells the fixture which target it drives.
 *
 * Its page is HUI's own web UI, so its steps are the web's except where a phone has no gesture at all (a wide screen, a
 * hover), which the fixture's phone branch refuses instead of proving the desktop's behaviour. It runs the whole suite:
 * which of its failures are real phone bugs is the catalogue's phone backlog, which the target's failure list feeds
 * (docs/mobile-app-plan.md, WP6).
 */
const webkitPhone = {
  name: "webkit-phone",
  engine: web(webkitPhoneOptions()),
  app: { url: `http://127.0.0.1:${WEBKIT_PHONE_PORT}`, command: launcher("webkit-phone", WEBKIT_PHONE_PORT, true) },
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
      // This machine's Chromium, launched with a fake camera and microphone so a call can open one, and leased to the
      // engine over CDP (`fixtures/web-browser.ts`). The permission itself stays the page's: `hui.allowMedia()` grants
      // it for a test that wants a microphone, and a test that proves a refused one is still refused.
      engine: webEngine,
      app: { url: "http://127.0.0.1:0", command: launcher("web", "{port}", true) },
    },
    phone,
    webkitPhone,
  ],
} satisfies E2EConfig;
