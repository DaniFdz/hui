/**
 * The `webkit-phone` target's phone half (mobile/AGENTS.md, WP6): Playwright's WebKit inside an iPhone's skin,
 * on Linux, so every pull request proves the page's rendering and layout at a phone's size without a device. The page
 * is HUI's own web UI, so the fixture's web steps drive it unchanged; this module owns what makes the target a phone
 * and the one reading that lets the fixture tell it apart from `web`.
 *
 * - **The engine.** `@e2e-dev/web` takes the browser (`webkit`) and the viewport, but not the two context options that
 *   make its page a phone: `hasTouch` and `isMobile`. Without `hasTouch`, Playwright refuses every `locator.tap()`, which
 *   the fixture's steps and the tests use everywhere, so nothing about the phone could be proven; without `isMobile`,
 *   WebKit lays a 390 px page out as a desktop window (no viewport meta, no touch-reading `pointer`/`hover` media).
 *   `phoneContexts` adds both to every context the browser opens, on the copy of playwright-core that the engine itself
 *   loads: the technique `phone.ts` already uses for a WebView's two protocol gaps. It is what the engine cannot express
 *   today and nothing more, so it goes away with an engine option of its own.
 * - **The marker.** The engine's platform is `web` on this target too, so a test that declares `platforms: ["web"]` runs
 *   here and the runner cannot tell the two browser targets apart. The target's gateway is therefore the one on
 *   `E2E_WEBKIT_PHONE_PORT` (47500 by default, like the emulator's gateway on `E2E_PHONE_PORT`), and `onWebKitPhone`
 *   reads that port back from the address the engine resolved, which is how the fixture refuses the steps a phone has no
 *   gesture for. A second run on one machine passes its own `E2E_WEBKIT_PHONE_PORT`.
 * - **What it is not.** There is no app shell here: no WebView, no Capacitor bridge, no plugin, no status bar, no back
 *   button of its own, no soft keyboard, no notification. The `android` target owns the shell; this one proves what the
 *   iPhone's engine renders and lays out.
 */
import { createRequire } from "node:module";
import type { WebOptions } from "@e2e-dev/web";

/** The gateway port this target answers on, so the fixture can tell it from `web` (plan §2, ports). */
export const WEBKIT_PHONE_PORT = process.env["E2E_WEBKIT_PHONE_PORT"] ?? "47500";

/** An iPhone 15's CSS pixels: 390 by 844 at a pixel ratio of 3. */
export const IPHONE_SCREEN = { width: 390, height: 844 } as const;

/** The browser that viewport stands for, as Safari on iOS 18 reports itself. */
export const IPHONE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** Whether this worker drives the `webkit-phone` target, given the app address the engine resolved. */
export function onWebKitPhone(baseUrl: string | undefined): boolean {
  return baseUrl !== undefined && new URL(baseUrl).port === new URL(`http://127.0.0.1:${WEBKIT_PHONE_PORT}`).port;
}

/**
 * The target's engine options: WebKit, an iPhone's size and device string. Building them installs the touch emulation,
 * which has to land in this process before the engine launches its browser.
 */
export function webkitPhoneOptions(): WebOptions {
  phoneContexts();
  return { browser: "webkit", viewport: { ...IPHONE_SCREEN }, userAgent: IPHONE_USER_AGENT };
}

/** A browser context's options, of which this target owns the two a phone needs. */
type ContextOptions = Record<string, unknown>;
type Browser = { newContext(options?: ContextOptions): Promise<unknown> };
type BrowserType = { launch(options?: Record<string, unknown>): Promise<Browser> };

/** Whether this process already patched the engine's WebKit. The patch is process-wide, like the module it touches. */
let patched = false;

/**
 * Makes every context the engine's WebKit browser opens a phone's: touch events exist, and the viewport is the phone's
 * own rather than a desktop window at a phone's width. Both are Playwright context options for WebKit (its iPhone device
 * descriptors set them); the engine passes neither, so they are merged onto the options it does pass, which stay in
 * charge of the size, the user agent and the media features.
 *
 * playwright-core is required from the engine's own entry, not from HUI: the patch has to land on the object the engine
 * calls `launch` on.
 */
function phoneContexts(): void {
  if (patched) return;
  patched = true;
  const here = createRequire(import.meta.url);
  const fromEngine = createRequire(here.resolve("@e2e-dev/web"));
  // CommonJS, so the same module instance the engine's `import` reads its `webkit` from.
  const { webkit } = fromEngine("playwright-core") as { webkit: BrowserType };
  const launch = webkit.launch.bind(webkit);
  webkit.launch = async (options?: Record<string, unknown>) => {
    const browser = await launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (contextOptions: ContextOptions = {}) => newContext({ hasTouch: true, isMobile: true, ...contextOptions });
    return browser;
  };
}
