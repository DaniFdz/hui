/**
 * Spike S2 of docs/mobile-app-plan.md: the Android app's WebView as an e2e target. Copy a device's own launcher and clears
 * its state through adb, forward the WebView's DevTools socket onto `E2E_CDP_PORT`, and answer the two questions a
 * Chromium browser and an Android WebView disagree on so `@e2e-dev/web`'s `connect` can drive it. Nothing here is
 * production code: it is the measurement WP4 replaces with a supported option or an upstream change.
 *
 * The two disagreements, measured on an Android 36 emulator with WebView 133 (see the spike's report):
 * - Playwright's `connectOverCDP` sends `Browser.setDownloadBehavior` to the default context, which a WebView answers
 *   with "Browser context management is not supported", so the attach itself fails. Playwright has the switch its own
 *   Android WebView support uses, `connectOverCDP(url, { noDefaults: true })`, and the engine never passes it.
 * - The engine's only workable mode on one page is a persistent context (`connect.reconnectEndpoint`), and it proves
 *   the context's identity with `Target.getBrowserContexts`, whose `defaultBrowserContextId` a WebView never reports.
 *   The id is derived from the app process instead, which is what actually distinguishes one WebView from the next.
 */
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type CDPSession } from "playwright-core";

/** The debug app the plan's launch line names. */
export const PACKAGE = "dev.hui.app.debug";
const ACTIVITY = "dev.hui.app.MainActivity";
/** The gateway port the emulator reaches through `adb reverse` (plan §2, ports). */
export const PHONE_PORT = process.env.E2E_PHONE_PORT ?? "47400";
/** The forwarded WebView DevTools socket (plan §2, ports). */
export const CDP_PORT = process.env.E2E_CDP_PORT ?? "9333";
/** `adb`, from `nix develop .#android`; a bare `adb` is what the CI job's shell provides. */
const ADB = process.env.ADB ?? "adb";
const SERIAL = process.env.ANDROID_SERIAL;

type CdpSession = { send(method: string, params?: Record<string, unknown>): Promise<unknown>; detach(): Promise<void> };
type Attach = (endpoint: string, options?: Record<string, unknown>) => Promise<Browser>;

/**
 * Attaches the way a WebView needs: the download-behavior call skipped (`noDefaults`) and the default context identified
 * by the app process that owns it. Both are the engine's gaps, not the WebView's.
 */
const connectOverCDP = chromium.connectOverCDP.bind(chromium) as unknown as Attach;
chromium.connectOverCDP = (async (url: string, options: Record<string, unknown> = {}) => {
  const browser = await connectOverCDP(url, { ...options, noDefaults: true, isWebView: true });
  const openBrowserSession = browser.newBrowserCDPSession.bind(browser);
  browser.newBrowserCDPSession = async () => {
    const session = (await openBrowserSession()) as unknown as CdpSession;
    const send = session.send.bind(session);
    session.send = (method, params) => method === "Target.getBrowserContexts"
      // A WebView has exactly one context and reports no id for it; the app process is its real identity, and a fresh
      // process per attempt is what makes the engine's "one context per attempt" rule hold.
      ? Promise.resolve({ browserContextIds: [], defaultBrowserContextId: `webview-${processId()}` })
      : send(method, params);
    return session as unknown as CDPSession;
  };
  return browser;
}) as unknown as typeof chromium.connectOverCDP;

const adb = (...args: string[]) => execFileSync(ADB, [...(SERIAL ? ["-s", SERIAL] : []), ...args], { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The app's process, which owns its WebView and its DevTools socket. */
function processId(): number {
  const pid = Number(adb("shell", "pidof", PACKAGE).split(/\s+/u)[0]);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`${PACKAGE} is not running on ${SERIAL ?? "the attached device"}: build and install it with npm run android -- build`);
  return pid;
}

const json = async (path: string) => (await fetch(`http://127.0.0.1:${CDP_PORT}${path}`)).json() as Promise<{ url: string; type: string; id: string; webSocketDebuggerUrl?: string }[]>;

/** Waits until the gateway's own page is the WebView's DevTools target, so a test never drives the Connect page. */
async function waitForGatewayPage(gateway: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pages = await json("/json/list").catch(() => []);
    if (pages.some((page) => page.type === "page" && page.url.startsWith(gateway))) return;
    if (Date.now() > deadline) {
      throw new Error(`the WebView never showed ${gateway}: /json/list reported ${JSON.stringify(pages.map((page) => page.url))}`);
    }
    await new Promise((done) => setTimeout(done, 500));
  }
}

/**
 * Prepares the app for one CDP attach: the gateway port comes back through `adb reverse`, a fresh app process when this
 * attempt needs its own browser, the DevTools socket is forwarded, and the gateway page has to be the target.
 */
export async function preparePhone({ relaunch, gateway }: { relaunch: boolean; gateway: string }): Promise<string> {
  // The build this run tests, when the job hands one over; otherwise the app the emulator already has.
  if (process.env.E2E_ANDROID_APK !== undefined) adb("install", "-r", process.env.E2E_ANDROID_APK);
  adb("reverse", `tcp:${PHONE_PORT}`, `tcp:${PHONE_PORT}`);
  if (relaunch) {
    adb("shell", "am", "start", "-S", "-W", "-n", `${PACKAGE}/${ACTIVITY}`, "--es", "huiGatewayUrl", gateway);
  }
  adb("forward", "--remove", `tcp:${CDP_PORT}`);
  adb("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${processId()}`);
  await waitForGatewayPage(gateway);
  return `http://127.0.0.1:${CDP_PORT}`;
}

/** The endpoint a fresh attempt gets: it owns a new app process, and so a new WebView and a new default context. */
export const phoneCdpEndpoint = (gateway: string) => () => preparePhone({ relaunch: true, gateway });

/** The endpoint a dropped transport reattaches through: the same app process, so the same page target. */
export const phoneReconnectEndpoint = (gateway: string) => () => preparePhone({ relaunch: false, gateway });

/**
 * Whether this worker drives the app. The target's platform is the engine's (`web`) on both targets, so the fixture
 * cannot tell them apart from `fixtures.platform`; the target's own address and a running app can, before any page opens.
 */
export function onPhone(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined || new URL(baseUrl).port !== PHONE_PORT) return false;
  try {
    return Number(adb("shell", "pidof", PACKAGE).split(/\s+/u)[0]) > 0;
  } catch {
    return false;
  }
}

/** The storage a fresh browser profile would not have: the app's own, cleared in place because a WebView has one context. */
export const clearAppStorage = async () => {
  localStorage.clear();
  sessionStorage.clear();
  for (const key of await caches.keys()) await caches.delete(key);
  for (const database of await indexedDB.databases()) if (database.name) indexedDB.deleteDatabase(database.name);
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  return null;
};

/**
 * Clears the app's data with `pm clear` and relaunches it. Only safe before an attempt's page exists: killing the app
 * mid-test takes the WebView's DevTools socket with it, and the engine cannot reattach to the page it was driving.
 */
export function clearPhoneApp(gateway: string) {
  adb("shell", "pm", "clear", PACKAGE);
  adb("shell", "am", "start", "-S", "-W", "-n", `${PACKAGE}/${ACTIVITY}`, "--es", "huiGatewayUrl", gateway);
  adb("forward", "--remove", `tcp:${CDP_PORT}`);
  adb("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${processId()}`);
  return CDP_PORT;
}
