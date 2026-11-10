/**
 * The `android` target's device half (docs/mobile-app-plan.md, WP4): the debug app's WebView, driven by the web engine
 * over CDP instead of a browser the engine launches. The page is HUI's own web UI, so the fixture's web steps drive it
 * unchanged; what this module owns is everything a WebView needs that a Chromium browser does not.
 *
 * - **The attach.** `adb reverse` puts the launcher's gateway on the emulator's own loopback, the app is launched with
 *   the `huiGatewayUrl` extra, the WebView's DevTools socket is forwarded onto `E2E_CDP_PORT`, and the endpoint is handed
 *   to the engine's `connect` once `/json/list` shows the gateway's own page. Spike S2 measured two protocol gaps
 *   between a WebView and a browser; `webViewProtocol` answers both, and its header says which and why.
 * - **One page, one context.** A WebView cannot open another page or context, so the engine cannot reset it between
 *   attempts: every attempt gets a relaunched app (a new process, and so a new default context), and a test's
 *   `hui.clearState()` clears the app's storage in the page instead (`clearAppStorage`).
 * - **The selection.** The target's platform is the engine's (`web`), so a test declaring `platforms: ["web"]` still
 *   runs here: `e2e/catalogue/phone.ts` owns which use cases the `android` target runs, and the job passes them as
 *   `--tag`. This module holds what the device needs, not which tests run.
 *
 * Two workers on one machine need their own emulator, DevTools port and gateway port (plan §2, ports):
 * `ANDROID_SERIAL`, `E2E_CDP_PORT` and `E2E_PHONE_PORT`. `adb` comes from `nix develop .#android`; the CI job's shell
 * provides its own.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** The debug app the plan's launch line names (`mobile/AGENTS.md`, "Launch, ports and target names"). */
export const PACKAGE = "dev.hui.app.debug";
const ACTIVITY = "dev.hui.app.MainActivity";
/** The gateway port the emulator reaches through `adb reverse`. */
export const PHONE_PORT = process.env["E2E_PHONE_PORT"] ?? "47400";
/** The forwarded WebView DevTools socket. */
export const CDP_PORT = process.env["E2E_CDP_PORT"] ?? "9333";
const ADB = process.env["ADB"] ?? "adb";
const SERIAL = process.env["ANDROID_SERIAL"];
/** The APK this run tests, when the job hands one over; otherwise the app the emulator already has. */
const APK = process.env["E2E_ANDROID_APK"];

const adb = (...args: string[]) => execFileSync(ADB, [...(SERIAL ? ["-s", SERIAL] : []), ...args], {
  encoding: "utf8",
  // A device that went offline makes adb wait for it forever, so every call has a deadline.
  timeout: 120_000,
  stdio: ["ignore", "pipe", "pipe"],
}).trim();

/** The app's process, which owns its WebView and its DevTools socket. */
function appPid(): number {
  const pid = Number(adb("shell", "pidof", PACKAGE).split(/\s+/u)[0]);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`${PACKAGE} is not running on ${SERIAL ?? "the attached device"}: build and install it with \`npm run mobile -- build\`, and check \`npm run mobile -- doctor\``);
  }
  return pid;
}

const launch = (gateway: string) => adb("shell", "am", "start", "-S", "-W", "-n", `${PACKAGE}/${ACTIVITY}`, "--es", "huiGatewayUrl", gateway);

/** Points the forwarded DevTools port at the running app's own socket; the process changes with every relaunch. */
function forwardDevTools(): void {
  // A forward left by an earlier attempt names a dead socket; removing one that is not there is not an error worth failing on.
  try { adb("forward", "--remove", `tcp:${CDP_PORT}`); } catch { /* no forward on this port yet */ }
  adb("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${appPid()}`);
}

type Target = { url: string; type: string; id: string; webSocketDebuggerUrl?: string };

/** Waits until the gateway's own page is a DevTools target, so an attempt never drives the Connect page. */
async function waitForGatewayPage(gateway: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let listed: string[] = [];
  for (;;) {
    const pages = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(5_000) })
      .then((response) => (response.ok ? response.json() as Promise<Target[]> : []))
      .catch(() => [] as Target[]);
    listed = pages.map((page) => page.url);
    if (pages.some((page) => page.type === "page" && page.url.startsWith(gateway))) return;
    if (Date.now() > deadline) {
      throw new Error(`the WebView never showed ${gateway} within ${Math.round(timeoutMs / 1000)} s: its DevTools target lists ${JSON.stringify(listed)}`);
    }
    await new Promise((done) => setTimeout(done, 250));
  }
}

/**
 * Which target this worker drives, read by the `hui` fixture to fill the steps a WebView needs instead of the web's.
 * The target's platform is the engine's (`web`) on both targets, so neither `fixtures.platform` nor the app's address
 * alone tells them apart: the port this module prepared does.
 */
let prepared: { port: string } | undefined;

/** Whether this worker drives the Android app, given the app address the engine resolved. */
export function onPhone(baseUrl: string | undefined): boolean {
  return prepared !== undefined && baseUrl !== undefined && new URL(baseUrl).port === prepared.port;
}

/** Whether an app was cleared and launched in this worker yet; `pm clear` is only safe before an attempt has a page. */
let first = true;

/**
 * Prepares the app for one CDP attach and resolves the endpoint to attach to. `relaunch` is what a fresh attempt needs
 * (a new process, and so a new WebView and default context); a transport drop reattaches to the same app instead.
 */
async function prepare({ relaunch, gateway }: { relaunch: boolean; gateway: string }): Promise<string> {
  adb("reverse", `tcp:${PHONE_PORT}`, `tcp:${PHONE_PORT}`);
  if (first) {
    // Nothing is attached yet, so the app may be cleared: it is the only moment a WebView's storage can be reset from
    // outside. After this, a test's clearState() clears it in the page.
    if (APK !== undefined) adb("install", "-r", APK);
    adb("shell", "pm", "clear", PACKAGE);
    first = false;
    relaunch = true;
  }
  if (relaunch) launch(gateway);
  forwardDevTools();
  await waitForGatewayPage(gateway);
  await webViewProtocol();
  prepared = { port: new URL(gateway).port };
  return `http://127.0.0.1:${CDP_PORT}`;
}

/** The endpoint a fresh attempt gets: it owns a relaunched app, and so a new WebView and a new default context. */
export const phoneCdpEndpoint = (gateway: string) => () => prepare({ relaunch: true, gateway });

/** The endpoint a dropped transport reattaches through: the same app process, so the same page target. */
export const phoneReconnectEndpoint = (gateway: string) => () => prepare({ relaunch: false, gateway });

/**
 * Teaches Playwright the two things an Android WebView does that a Chromium browser does not. Both are gaps on the
 * engine's side (`@e2e-dev/web`'s `connectCdp` passes neither option), measured by spike S2:
 *
 * - Playwright's `connectOverCDP` applies its default overrides to the default context, which sends
 *   `Browser.setDownloadBehavior`; a WebView answers that with "Browser context management is not supported" and the
 *   attach fails. `noDefaults: true` is Playwright's own switch for attaching to a browser it does not own (its own
 *   Android WebView support uses it), and the engine never passes it.
 * - The engine's only workable mode on one page is a persistent context (`connect.reconnectEndpoint`), and it proves
 *   the context's identity with `Target.getBrowserContexts`, whose `defaultBrowserContextId` a WebView never reports.
 *   The app process is what actually distinguishes one WebView from the next, and a relaunch per attempt makes a fresh
 *   one, so it stands in for the id.
 *
 * `isWebView` is Playwright's third switch: a WebView can be attached before its page has a main-world execution
 * context, and that option re-enables the runtime until one appears.
 *
 * Playwright is imported from the copy the engine itself loads (`@e2e-dev/web`'s dependency), because the patch has to
 * land on the object the engine calls. It is not a direct dependency of HUI yet: see the note in the WP4 report.
 */
let patched: Promise<void> | undefined;
function webViewProtocol(): Promise<void> {
  patched ??= (async () => {
    const here = createRequire(import.meta.url);
    // Resolved from the engine's own entry, not from HUI: the patch has to land on the copy the engine loads.
    const fromEngine = createRequire(here.resolve("@e2e-dev/web"));
    const module = await import(pathToFileURL(fromEngine.resolve("playwright-core")).href) as {
      chromium?: Chromium;
      // playwright-core is CommonJS: its named exports are the properties Node finds statically, and `chromium` is not one.
      default: { chromium: Chromium };
    };
    const chromium = module.chromium ?? module.default.chromium;
    const connectOverCDP = chromium.connectOverCDP.bind(chromium);
    chromium.connectOverCDP = async (endpoint: string, options: Record<string, unknown> = {}) => {
      const browser = await connectOverCDP(endpoint, { ...options, noDefaults: true, isWebView: true });
      const openBrowserSession = browser.newBrowserCDPSession.bind(browser);
      browser.newBrowserCDPSession = async () => {
        const session = await openBrowserSession();
        const send = session.send.bind(session);
        session.send = ((method: string, params?: Record<string, unknown>) => method === "Target.getBrowserContexts"
          ? Promise.resolve({ browserContextIds: [], defaultBrowserContextId: `webview-${appPid()}` })
          : send(method, params)) as typeof session.send;
        return session;
      };
      return browser;
    };
  })();
  return patched;
}

type Browser = { newBrowserCDPSession(): Promise<CdpSession> };
type CdpSession = { send(method: string, params?: Record<string, unknown>): Promise<unknown> };
type Chromium = { connectOverCDP(endpoint: string, options?: Record<string, unknown>): Promise<Browser> };

/**
 * The storage a fresh browser profile would not have: the app's own, cleared in place because a WebView has one context
 * the engine cannot replace. `hui.clearState()` runs this in the page and then reloads.
 */
export const clearAppStorage = async () => {
  localStorage.clear();
  sessionStorage.clear();
  for (const key of await caches.keys()) await caches.delete(key);
  for (const database of await indexedDB.databases()) if (database.name) indexedDB.deleteDatabase(database.name);
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  return null;
};
