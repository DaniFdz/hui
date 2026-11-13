/**
 * The `android` target's device half (mobile/AGENTS.md, WP4): the debug app's WebView, driven by the web engine
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
 * - **What the device wrote.** A download in the app is the shell's own (`ShellDownloads` writes `Downloads` through
 *   `DownloadManager` or `MediaStore`), so the browser's download event never fires there: `deviceFiles` and
 *   `deviceBytes` read the folder the shell saved into, which is how the fixture's `download` step observes the app's
 *   result instead of claiming one.
 *
 * Two workers on one machine need their own emulator, DevTools port and gateway port (plan §2, ports):
 * `ANDROID_SERIAL`, `E2E_CDP_PORT` and `E2E_PHONE_PORT`. `adb` comes from `nix develop .#android`; the CI job's shell
 * provides its own.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { attachmentInitScripts, type InitScript } from "../../scripts/phone-init-scripts.ts";
import { attachedNativeTarget, nativeTransportGate, nativeWindowIdentity, type NativeTarget } from "../../scripts/phone-native-target.ts";

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

/** The folder the app saves a download into: `Downloads`, which `DownloadManager` and `MediaStore` both write on Android
 * 10 and later (`ShellDownloads.download`, `ShellDownloads.saveBytes`). */
export const PHONE_DOWNLOADS = "/sdcard/Download";

/**
 * One file a device directory holds. A phone keeps a download its own way, so a fixture reads the device rather than the
 * browser's download event: `ls -l` gives the size that tells a download still being written from a settled one.
 */
export type DeviceFile = { name: string; size: number };

/** The files in a device directory, read through `adb shell ls -l`. */
export function deviceFiles(directory = PHONE_DOWNLOADS): DeviceFile[] {
  // An absent folder has nothing to list, which is the same answer to a caller: no file of that name.
  const listing = (() => {
    try {
      return adb("shell", "ls", "-l", directory);
    } catch {
      return "";
    }
  })();
  return listing.split("\n").flatMap((line) => {
    // `-rw-rw---- 1 u0_a155 media_rw 77 2026-11-10 22:20 flaky-test.pdf`; a name may hold spaces, so the rest of the line
    // after the date and time is the name.
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 8 || !fields[0]!.startsWith("-")) return [];
    const size = Number(fields[4]);
    if (!Number.isInteger(size)) return [];
    return [{ name: fields.slice(7).join(" "), size }];
  });
}

/** One device file's bytes, read through `adb exec-out`, which passes them through untouched. */
export function deviceBytes(path: string): Buffer {
  return execFileSync(ADB, [...(SERIAL ? ["-s", SERIAL] : []), "exec-out", "cat", path], {
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * The app's process, which owns its WebView and its DevTools socket. `am start -W` returns when the activity is drawn,
 * which is before the process has a pid under load, so the pid is polled for a few seconds instead of read once: a single
 * read cost every catch-up worker its first attempt and reported itself as a test failure.
 */
function appPid(): number {
  for (let attempt = 0; attempt < 40; attempt++) {
    const pid = Number(adb("shell", "pidof", PACKAGE).split(/\s+/u)[0]);
    if (Number.isInteger(pid) && pid > 0) return pid;
    execFileSync("sleep", ["0.25"]);
  }
  throw new Error(`${PACKAGE} is not running on ${SERIAL ?? "the attached device"} after 10 s: build and install it with \`npm run mobile -- build\`, and check \`npm run mobile -- doctor\``);
}

const launch = (gateway: string) => adb("shell", "am", "start", "-S", "-W", "-n", `${PACKAGE}/${ACTIVITY}`, "--es", "huiGatewayUrl", gateway);
let activeGateway: string | undefined;
/** Each native attachment sample reconciles the currently bound transport before the fixture dispatches again. */
let observeNativeWindow: ((target: NativeTarget) => void) | undefined;

/** Decline only the isolated app's real startup notification prompt, using its native refusal control, not a grant. */
export function refusePhoneNotificationPrompt(): void {
  adb("shell", "uiautomator", "dump", "/sdcard/hui-notification-consent.xml");
  const xml = adb("shell", "cat", "/sdcard/hui-notification-consent.xml");
  if (!xml.includes("Allow HUI to send you notifications?")) return;
  const deny = xml.match(/<node\b[^>]*resource-id="com\.android\.permissioncontroller:id\/permission_deny(?:_and_dont_ask_again)?_button"[^>]*>/u)?.[0];
  const bounds = deny?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u);
  if (!bounds) throw new Error("the real notification prompt has no native refusal button");
  const [left, top, right, bottom] = bounds.slice(1).map(Number) as [number, number, number, number];
  adb("shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
  console.log("Declined the isolated app's native startup notification prompt");
}

/** A gateway stub or world runs on the host, not the emulator's own loopback interface. */
export function forwardPhoneGateway(gateway: string): void {
  const port = new URL(gateway).port;
  if (!port) throw new Error("A native fixture gateway needs an explicit host port.");
  adb("reverse", `tcp:${port}`, `tcp:${port}`);
}

/** A fixture world is another real gateway. Let the debug activity rebuild its bridge on that origin, as a Connect
 * handoff does, without force-stopping the app's process or replacing its persistent browser context. */
export async function openPhoneGateway(gateway: string): Promise<void> {
  const current = attachedNativeTarget(await nativeTargets());
  if (current) {
    observeNativeWindow?.(current);
    activeGateway = new URL(current.url).origin;
  }
  if (activeGateway === gateway) return;
  if (REUSE) throw new Error("Switching fixture gateways needs per-attempt app launches; unset E2E_PHONE_REUSE.");
  forwardPhoneGateway(gateway);
  adb("shell", "am", "start", "-W", "-n", `${PACKAGE}/${ACTIVITY}`, "--es", "huiGatewayUrl", gateway);
  activeGateway = gateway;
  forwardDevTools();
  await waitForGatewayPage(gateway);
}

/** Points the forwarded DevTools port at the running app's own socket; the process changes with every relaunch. */
function forwardDevTools(): void {
  // A forward left by an earlier attempt names a dead socket; removing one that is not there is not an error worth failing on.
  try { adb("forward", "--remove", `tcp:${CDP_PORT}`); } catch { /* no forward on this port yet */ }
  adb("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${appPid()}`);
}

async function nativeTargets(): Promise<NativeTarget[]> {
  return fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(5_000) })
    .then((response) => response.ok ? response.json() as Promise<NativeTarget[]> : [])
    .catch(() => [] as NativeTarget[]);
}

/** A launch must reach its requested gateway. A reconnect follows the app's current main window, including a gateway
 * the operator chose through the UI, rather than navigating back to the launch's old address. */
async function waitForGatewayPage(gateway: string | undefined, timeoutMs = 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let listed: string[] = [];
  for (;;) {
    const pages = await nativeTargets();
    listed = pages.map((page) => page.url);
    const page = attachedNativeTarget(pages);
    if (page && (gateway === undefined || new URL(page.url).origin === gateway)) {
      observeNativeWindow?.(page);
      return new URL(page.url).origin;
    }
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
 * Whether tests in a file share one app launch (`E2E_PHONE_REUSE=1`). The engine wants a browser identity it has not seen
 * for every attempt, and a WebView's default context has none, so the fixture hands out a synthetic one: the app's
 * process plus an attempt number. Relaunching per attempt made that number the process id; reusing the app keeps the
 * process and counts the attempts instead, which an in-page `clearState()` between tests makes safe enough to try. Off
 * by default: a suite that shares a process also shares its failures, so this is measured before it is trusted.
 */
const REUSE = process.env["E2E_PHONE_REUSE"] === "1";
/** The synthetic context identity of the attempt being prepared. */
let contextId = "";
let attempts = 0;
let owningPid = 0;
let lastTargetId = "";
let recovering = false;
let attachmentSignal: AbortSignal | undefined;
let initScripts: InitScript[] = [];

/**
 * Prepares the app for one CDP attach and resolves the endpoint to attach to. `relaunch` is what a fresh attempt needs
 * (a new process, and so a new WebView and default context); a transport drop reattaches to the same app instead.
 */
async function prepare({ relaunch, gateway, signal }: { relaunch: boolean; gateway: string; signal?: AbortSignal }): Promise<string> {
  signal?.throwIfAborted();
  attachmentSignal = signal;
  gateway = relaunch ? gateway : activeGateway ?? gateway;
  activeGateway = gateway;
  adb("reverse", `tcp:${new URL(gateway).port}`, `tcp:${new URL(gateway).port}`);
  if (first) {
    // Nothing is attached yet, so the app may be cleared: it is the only moment a WebView's storage can be reset from
    // outside. After this, a test's clearState() clears it in the page.
    if (APK !== undefined) adb("install", "-r", APK);
    adb("shell", "pm", "clear", PACKAGE);
    first = false;
    relaunch = true;
  }
  if (relaunch) {
    // A reused app keeps its process; only the identity the engine checks changes from attempt to attempt.
    if (REUSE && attempts > 0) {
      attempts += 1;
      contextId = `webview-${appPid()}-${attempts}`;
    } else {
      launch(gateway);
      attempts += 1;
      contextId = `webview-${appPid()}`;
    }
  }
  if (relaunch) {
    owningPid = appPid();
    initScripts = [];
  } else if (appPid() !== owningPid) throw new Error("the Android app process changed; this attempt cannot resume a different app context");
  // A transport reconnect resumes this attempt's context; its identity must not change merely because it reattaches.
  forwardDevTools();
  activeGateway = await waitForGatewayPage(relaunch ? gateway : undefined);
  if (relaunch) lastTargetId = attachedNativeTarget(await nativeTargets())?.id ?? "";
  recovering = !relaunch;
  await webViewProtocol();
  prepared = { port: PHONE_PORT };
  return `http://127.0.0.1:${CDP_PORT}`;
}

/** The endpoint a fresh attempt gets: it owns a relaunched app, and so a new WebView and a new default context. */
export const phoneCdpEndpoint = (gateway: string) => (signal?: AbortSignal) => prepare({ relaunch: true, gateway, signal });

/** The endpoint a dropped transport reattaches through: the same app process and logical main window. */
export const phoneReconnectEndpoint = (gateway: string) => (signal?: AbortSignal) => prepare({ relaunch: false, gateway, signal });

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
      const deadline = Date.now() + (typeof options["timeout"] === "number" ? options["timeout"] : 30_000);
      const signal = attachmentSignal;
      signal?.throwIfAborted();
      const resume = recovering;
      const scripts = initScripts;
      const logicalContextId = contextId;
      recovering = false;
      const browser = await connectOverCDP(endpoint, { ...options, noDefaults: true, isWebView: true });
      // The engine cannot own cancellation until this adapter returns. Own and reap the candidate meanwhile.
      const cancel = () => { void browser.close().catch(() => undefined); };
      const expiry = setTimeout(cancel, Math.max(0, deadline - Date.now()));
      signal?.addEventListener("abort", cancel, { once: true });
      const check = () => {
        signal?.throwIfAborted();
        if (Date.now() >= deadline) throw new Error("native attachment exceeded the CDP connection deadline");
      };
      try {
        check();
        if (browser.contexts().length !== 1) throw new Error("the Android app must have one default context");
        const context = browser.contexts()[0]!;
        const physicalPages = context.pages.bind(context);
        const openSession = context.newCDPSession.bind(context);
        // CDP's page-created event can precede View attachment. Match raw physical identity to native attachment,
        // never page order or URL: an outgoing WebView can remain readable at exactly the same address indefinitely.
        context.addInitScript = attachmentInitScripts(context.addInitScript.bind(context), scripts);
        let bound: { page: Page; target: NativeTarget; rawTargetInfo: Record<string, unknown> } | undefined;
        while (!bound) {
          check();
          const target = attachedNativeTarget(await nativeTargets());
          if (target) {
            for (const page of physicalPages()) {
              if (page.isClosed()) continue;
              let session: CdpSession | undefined;
              try {
                session = await openSession(page);
                const { targetInfo } = await session.send("Target.getTargetInfo") as { targetInfo: { targetId: string } };
                if (targetInfo.targetId === target.id && attachedNativeTarget(await nativeTargets())?.id === target.id) {
                  bound = { page, target, rawTargetInfo: targetInfo }; break;
                }
              } catch (error) {
                if (!page.isClosed()) throw error;
              } finally { await session?.detach().catch(() => undefined); }
            }
          }
          if (bound) {
            try {
              if (resume && bound.target.id !== lastTargetId) {
                // Replay actual scripts, never manufacture the engine's closed-shadow marker.
                for (const entry of [...scripts]) { check(); await context.addInitScript(entry.script, entry.argument); }
                await bound.page.reload({ waitUntil: "domcontentloaded", timeout: Math.max(1, deadline - Date.now()) });
              }
            } catch (error) {
              if (!bound.page.isClosed()) throw error;
              bound = undefined;
            }
            check();
            // An unpublished candidate can be replaced during script installation: resample actual attachment.
            if (bound && attachedNativeTarget(await nativeTargets())?.id !== bound.target.id) bound = undefined;
          }
          if (!bound) {
            if (Date.now() > deadline) throw new Error("the attached native main window has no matching Playwright page");
            await new Promise((done) => setTimeout(done, 100));
          }
        }
        const { page, target } = bound;
        console.log(`Native main window: ${JSON.stringify(target)} raw TargetInfo: ${JSON.stringify(bound.rawTargetInfo)}`);
        // Exclude obsolete detached windows, without closing native views or constructing a substitute Page.
        context.pages = () => page.isClosed() ? [] : [page];
        context.newCDPSession = async (candidate) => {
          const session = await openSession(candidate);
          const send = session.send.bind(session);
          session.send = async (method, params) => {
            const result = await send(method, params);
            if (method !== "Target.getTargetInfo" || candidate !== page) return result;
            const info = result as { targetInfo: Record<string, unknown> };
            return { ...info, targetInfo: nativeWindowIdentity(info.targetInfo, target.id, logicalContextId) };
          };
          return session;
        };
        check();
        lastTargetId = target.id;
        // Native attachment, not old Page.close, is the handoff boundary. Poll even when page-created arrived before
        // attachment. Publish obsolescence first; retire only at the engine's isConnected operation boundary, so an
        // in-flight click/read is not interrupted by our monitor. Closing CDP detaches, not the native app.
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;
        const retire = () => { stopped = true; clearTimeout(timer); void browser.close().catch(() => undefined); };
        const gate = nativeTransportGate(browser.isConnected.bind(browser), retire);
        browser.isConnected = gate.isConnected;
        const reconcile = (current: NativeTarget) => {
          if (current.id !== target.id) gate.invalidate();
        };
        observeNativeWindow = reconcile;
        const observeAttachment = async () => {
          try {
            const current = attachedNativeTarget(await nativeTargets());
            if (current && current.id !== target.id) {
              console.log(`Native main window handoff: ${target.id} -> ${current.id} ${current.description}`);
              reconcile(current);
              return;
            }
          } catch (error) {
            console.error("Native attachment verification failed", error);
            gate.invalidate();
            return;
          }
          if (!stopped) timer = setTimeout(() => { void observeAttachment(); }, 100);
        };
        browser.on("disconnected", () => {
          stopped = true; clearTimeout(timer);
          if (observeNativeWindow === reconcile) observeNativeWindow = undefined;
        });
        page.on("close", retire);
        void observeAttachment();
      } catch (error) {
        await browser.close().catch(() => undefined);
        throw error;
      } finally {
        clearTimeout(expiry);
        signal?.removeEventListener("abort", cancel);
      }
      const openBrowserSession = browser.newBrowserCDPSession.bind(browser);
      browser.newBrowserCDPSession = async () => {
        const session = await openBrowserSession();
        const send = session.send.bind(session);
        session.send = ((method: string, params?: Record<string, unknown>) => method === "Target.getBrowserContexts"
          ? Promise.resolve({ browserContextIds: [], defaultBrowserContextId: logicalContextId })
          : send(method, params)) as typeof session.send;
        return session;
      };
      return browser;
    };
  })();
  return patched;
}

type Page = { isClosed(): boolean; on(event: "close", listener: () => void): unknown; reload(options: { waitUntil: "domcontentloaded"; timeout?: number }): Promise<unknown> };
type Context = {
  pages(): Page[];
  addInitScript(script: unknown, argument?: unknown): Promise<void>;
  newCDPSession(page: Page): Promise<CdpSession>;
  on(event: "page", listener: (page: Page) => void): unknown;
  waitForEvent(event: "page", options: { predicate: (page: Page) => boolean; timeout: number }): Promise<Page>;
};
type Browser = { newBrowserCDPSession(): Promise<CdpSession>; contexts(): Context[]; isConnected(): boolean; close(): Promise<void>; on(event: "disconnected", listener: () => void): unknown };
type CdpSession = { send(method: string, params?: Record<string, unknown>): Promise<unknown>; detach(): Promise<void> };
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
