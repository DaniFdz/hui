/**
 * HUI's fixture for the shared e2e suite: the disposable gateway each target runs against (restartable against the same
 * state and port), setup and cleanup through its API, the deterministic provider's address and barriers, gateway
 * requests a test holds, rejects, answers or delivers while dropping the answer, disposable chiefs and Git repositories, cleanup
 * of the backlog tasks a test created, searches of the gateway's state and secret directories, and every step whose
 * gesture or reading would differ per platform, kept in one table per target that the web fills: opening, reloading
 * and clearing the app, taps, holds, drags held mid-way, context menus, a message's actions (a hover reveals its
 * footer), switches (a Web Awesome switch draws its track over its input, so the web taps the point), attachments,
 * sideways scrolling, downloads, the clipboard, the statuses a page shows and replaces within one render (a rich embed's
 * "Rendering diagram…"), the Work pane's launcher (the + menu writes each shortcut on its entry
 * and opens the pane beside the chat), a Files row's delete, the phone screen's size, the session list (on the drawer
 * layout, the shell's drawer media, the navigation drawer), the Settings page list (the drawer on a phone), the app's
 * chrome outside Settings (the primary navigation), the chosen button of a group (aria-pressed), the app's and the
 * device's colour scheme, the session menu, status glyphs, how a piece of the screen looks, the window's size, Back and
 * Forward, sideways overflow, whether a tap reaches a control, the command palette's chord and a frame's own document
 * (an agent widget runs where only its sandbox can reach it, so a test reads and taps inside it there); and the steps
 * that are the fixture's own rather than a platform's: a download the app saves itself (the browser's download event on
 * the web, and on the phone the file the shell wrote into `Downloads`), the other tabs the page asks for (the engine
 * drives one page, so a `window.open` or a `target="_blank"` press is recorded as the address it asked for instead of
 * being followed), a controllable clock a test advances so a timer's deadline can be read on both sides of it
 * (`clock.ts`), an independently controlled gateway automation clock whose state the launcher retains across child
 * restarts (only its real scheduler's timers move, and Node-side controls stay behind the verification token),
 * the browser's permission for the fake camera and microphone the web target's Chromium carries
 * (`web-browser.ts`), a native dialog the page asks to confirm, a subagent's conversation opened from the card
 * its parent's chat draws, a tool call held while it runs so its row and the working indicator can be read in flight, and
 * a fixture world started for one test (`world.ts`). The web page never opens Vite's development socket, whose client
 * reloads the page when the gateway restarts, which no installed gateway does. Test files import `test` from here, never
 * from `e2e`, and never read `platform`, `device` or `browser` themselves.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Locator, type Screen } from "e2e";
import type { Browser, FrameScreen, WebRoute } from "@e2e-dev/web";
import { addWorkerOnThisMachine } from "./worker.ts";
import { startGatewayStub, type GatewayStub } from "./gateway-stub.ts";
import { advanceClock, installClock } from "./clock.ts";
import { allowMedia } from "./web-browser.ts";
import { clearAppStorage, deviceBytes, deviceFiles, forwardPhoneGateway, onPhone, openPhoneGateway, refusePhoneNotificationPrompt, PHONE_DOWNLOADS } from "./phone.ts";
import { onWebKitPhone, webkitServiceWorkers } from "./phone-webkit.ts";
import { observeOfflineLifecycle, offlineReadinessProbe, readOfflineCacheNames, readOfflineReadiness } from "./offline-readiness.ts";
import { startWorld, type World, type WorldName } from "./world.ts";
import { storedContent } from "./stored-content.ts";
import { androidDisplay, type DisplayArea, type Insets } from "./display-area.ts";
import { readLook } from "./look.ts";

type Receipt = { url: string; providerUrl: string; workspace: string; huiConfig: string; receipt: string; serverPid: number; runnerPid: number };
type Rgb = [number, number, number];
type SessionList = { groups: { label: string; sessions: ListedSession[] }[] };
type ListedSession = { id: string; title: string; status: string; parentId?: string; runtime?: { active: true }; subagent?: { status: string; completionDelivery?: string } };
/** One other tab the page asked for: what it asked to open, and how. */
export type TabRequest = {
  /** The address it asked for, resolved against the page that asked. */
  url: string;
  /** `window.open`: a page script asked; `link`: a press on a `target="_blank"` link asked. */
  via: "window.open" | "link";
  /** Whether the request asked for no opener (`noopener` in `window.open`'s features, or in the link's `rel`). */
  noopener: boolean;
  /** Whether the request asked for no referrer (`noreferrer`, in the same place). */
  noreferrer: boolean;
  /** What the request said about the new tab: `window.open`'s features, or the link's `rel`, as written. */
  asked: string;
};

type Intercepted = {
  arrived(): Promise<void>;
  /** The request that arrived: what the app sent, for a test that asserts a body rather than an outcome. */
  request(): { method: string; url: string; body: string };
  /** Matching requests observed at the HTTP barrier, including those still held. */
  count(): number;
  /** Real fetches initiated during a trusted tap's click dispatch, excluding background tasks and deferred work. */
  requestsFromTap(target: Locator): Promise<number>;
  deliver(): Promise<void>;
  reject(status: number, error: string): Promise<void>;
  answer(json: string): Promise<void>;
  deliverAndDrop(): Promise<void>;
};

export type Hui = {
  workspace: string;
  /** The gateway's own config directory, where its settings and tool icons live. */
  configDir: string;
  /** This disposable gateway's PI agent directory, where models.json and settings.json live. */
  piAgentDir: string;
  gateway: string;
  api<T>(method: string, path: string, body?: unknown): Promise<T>;
  createSession(input: { title: string; tool?: "pi"; group?: string; cwd?: string; model?: string }): Promise<{ id: string }>;
  /** A real group chief owned by this test, so its conversation and usage are removed by the normal bot cleanup. */
  createChief(): Promise<{ id: string; name: string; sessionId: string; group: string }>;
  createSubagent(parent: { id: string }): Promise<{ id: string; title: string }>;
  prompt(session: { id: string }, text: string): Promise<void>;
  provider: { url: string; held(): Promise<void>; release(): Promise<void> };
  network(mode: "online" | "offline" | "silent"): Promise<void>;
  /** Answers the page's next native dialog (`window.confirm`) as an operator does, instead of the engine dismissing it. */
  answerNextDialog(answer: "accept" | "dismiss"): Promise<void>;
  /** True once this browser has installed the open build's offline files and can serve its shell without the gateway. */
  offlineFilesReady(): Promise<boolean>;
  restartGateway(): Promise<void>;
  exitRuntimes(): Promise<void>;
  /** Waits until the open conversation's stream holds an open WebSocket, so a drop lands on a live stream. */
  streamOpen(): Promise<void>;
  dropStreams(): Promise<void>;
  /** Focuses a sidebar row's link and activates it from the keyboard, clear of the drawer's moving backdrop. */
  activateSidebarRow(title: string): Promise<void>;
  open(path: string): Promise<void>;
  reload(): Promise<void>;
  clearState(): Promise<void>;
  url(): Promise<string>;
  phoneScreen(orientation?: "portrait" | "landscape"): Promise<{ width: number; height: number }>;
  /** Reads the current CSS viewport without changing rotation, focus or keyboard state. */
  viewportSize(): Promise<{ width: number; height: number }>;
  /**
   * States synthetic browser insets through the page's \`--safe-area-*\` tokens. Refuses in the native app, where
   * the shell fits the physical WebView frame and zeroes page tokens. Use safeDisplay for positive native evidence.
   */
  insets(insets: { top?: number; right?: number; bottom?: number; left?: number }): Promise<void>;
  /** Measures safe display bounds and control boxes in one coordinate space. Browser insets are synthetic; Android uses real system overlays and its physical WebView frame. */
  safeDisplay(insets?: Insets): Promise<DisplayArea>;
  wideScreen(width?: number): Promise<void>;
  paletteChord(): Promise<void>;
  /** A bot's Settings chord: ⇧⌘, on Apple platforms and Ctrl+Shift+, elsewhere. */
  settingsChord(): Promise<void>;
  /** A Work pane chord: `code` pressed with ⌥⇧⌘ on Apple platforms and Ctrl+Alt+Shift elsewhere. */
  workChord(code: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  overflowsSideways(): Promise<boolean>;
  reachable(target: Locator): Promise<boolean>;
  clipboard(options?: { refuse?: boolean; legacyCopy?: boolean }): Promise<void>;
  copied(): Promise<string>;
  /** Starts recording the statuses a page shows and replaces within one render, from every page after this call. */
  recordStatuses(): Promise<void>;
  /** The statuses recorded since `recordStatuses()`, in the order the page added them. */
  statuses(): Promise<string[]>;
  keyboard: { down(key: string): Promise<void>; up(key: string): Promise<void> };
  type(text: string): Promise<void>;
  peek(target: Locator): Promise<void>;
  sessionList(): Promise<void>;
  settingsPages(): Promise<void>;
  appChrome(): Locator;
  sessionMenu(title: string): Promise<Pick<Locator, "getByText" | "getByTestId">>;
  glyph(title: string): Promise<{ label: string; animated: boolean }>;
  faces(): Promise<{ size: string; shape: string; ears: string; emoji: string; color: string }[]>;
  zone(): Promise<string>;
  providerRequests(): Promise<number>;
  accentDot(title: string): Promise<boolean>;
  appearance(): Promise<"light" | "dark">;
  /** This device's appearance record, as its own storage holds it, or null when it stored nothing. */
  storedAppearance(): Promise<Record<string, unknown> | null>;
  /** Writes this device's appearance as the page would, for a starting state a test sets up without clicking. */
  saveAppearance(patch: Record<string, unknown>): Promise<void>;
  /** Makes the page's storage refuse every write, as a full quota or a private window does, until the next load. */
  refuseStorage(): Promise<void>;
  pressed(within: Screen | Locator, name: string, on?: boolean): Locator;
  look(target: Locator): Promise<{ color: Rgb; background: Rgb; opacity: number; fonts: string[]; loaded: string[]; size: number; weight: number; align: string; ring: Rgb | null }>;
  overflowX(): Promise<number>;
  deviceAppearance(scheme: "light" | "dark"): Promise<void>;
  newSessionDraft(): Promise<string>;
  attach(target: Locator, files: (string | { name: string; bytes: number } | { name: string; text: string })[]): Promise<void>;
  /** Taps a download control and answers with the file it saved: the browser's download event on the web, and on the
   * app the file the shell wrote into `Downloads`, read off the device. A step that saved nothing fails with what the
   * folder holds instead of answering with a file no one wrote. */
  download(target: Locator): Promise<{ name: string; text: string }>;
  /** A worker on this machine: its own home, this checkout pre-installed as its release. */
  addWorker(name: string): Promise<{ id: string; home: string }>;
  /** A second, disposable gateway that answers the identity handshake with \`name\` and nothing else. */
  gatewayStub(name: string): Promise<GatewayStub>;
  /** Records, from now on, the text the page copies to the clipboard. */
  clipboardSpy(): Promise<void>;
  clipboardWrites(): Promise<string[]>;
  hold(target: Locator, until: Locator): Promise<void>;
  /**
   * Prompts a session for one tool call and holds it while it runs, so a test can read the row and the working indicator
   * in flight: the tool answers only when the returned `release` runs. `name` is any tool the fixture's disposable
   * extension registers as holdable — `fixture_echo`, and the `read`, `edit` and `git` classes HUI names its indicator
   * after (`read_file`, `apply_patch`, `git_status`) — or the shell's own `bash`, whose held call waits on the same
   * control endpoint. A name no tool answers waits until the test ends, so the prompt is refused here rather than
   * hanging. */
  holdTool(session: { id: string }, name: string, input?: Record<string, unknown>): Promise<{ release(): Promise<void> }>;
  /**
   * Opens a subagent's own conversation from its parent's Swarm card, the row the chat draws for it, opening the
   * folded card first. The card is the same control on every target; a phone reaches it in the chat where the web's
   * sidebar also lists the child, so a test that reads a child's header works on both.
   */
  openSubagent(child: { title: string }): Promise<void>;
  /**
   * Starts a fixture world for this test: its own disposable gateway, seeded by the launcher's `--jira-fixture`,
   * `--github-fixture`, `--activity-fixture`, `--datadog-fixture` or `--quota-fixture` (`world.ts`), or by none of them
   * with `plain`, which is a gateway of this test's own. The world is another gateway on another port, so a test
   * opens its pages with `hui.open(`${world.url}/...`)` and calls it with `world.api`. On Android, opening that origin
   * rebuilds the real native bridge on it, with its port reverse-forwarded to this isolated host.
   */
  world(name: WorldName): Promise<World>;
  textOf(target: Locator): Promise<string>;
  /** A task progress step's state, its `data-status`. */
  stepState(step: Locator, state: string): Promise<void>;
  drag(target: Locator, onto: Locator, whileOver: () => Promise<void>): Promise<void>;
  /** Drags the pointer from a target's centre by a pixel offset, holding it there for `whileOver` before letting go. */
  dragBy(target: Locator, offset: { dx: number; dy: number }, whileOver: () => Promise<void>): Promise<void>;
  touchTap(target: Locator): Promise<void>;
  /** A real touch gesture on a target: a tap, or a drag of `drag` pixels down the screen. */
  touch(target: Locator, gesture?: { drag?: number }): Promise<void>;
  /** Two fingers pinching around a target's centre, going from `from` to `to` pixels apart and lifting the second, which leaves the first down for `fingerDrag`. */
  pinch(target: Locator, { from, to }: { from: number; to: number }): Promise<void>;
  /** Drags the finger a `pinch` left down by `dx` and `dy` pixels and lifts it. */
  fingerDrag({ dx, dy }: { dx: number; dy: number }): Promise<void>;
  scrollSideways(target: Locator): Promise<void>;
  wheel(target: Locator, deltaY: number): Promise<void>;
  /** A tap at the middle of where the target is now, read at the moment of the press: a phone sends a plain tap to the row its last reading put the target in, which a screen that just laid that row out elsewhere would miss. */
  tapAt(target: Locator): Promise<void>;
  scrollTo(within: Locator, target: Locator): Promise<void>;
  /** The screen of the frame a CSS selector matches, so a test reads and taps a document HUI only hosts, such as an agent
   * widget's sandboxed frame; a frame nested inside it comes from that screen's own `frameLocator`. */
  frame(selector: string): Promise<FrameScreen>;
  /**
   * Installs a controllable clock in the page: `Date.now()` and every timer the app schedules from now on run on a clock
   * only `advanceClock` moves, so a test can assert both sides of a deadline without waiting for it. Rendering and
   * animation keep real time (`performance.now`, `requestAnimationFrame`), and a timer due at once still runs on the
   * loop's next turn. The clock survives a reload; nothing is installed until a test asks. Answers the time it starts at.
   */
  controllableClock(): Promise<number>;
  /** Advances the controlled clock by `ms`, running every timer that falls due in order, and answers the time it now
   * reads. Needs `controllableClock()` first. */
  advanceClock(ms: number): Promise<number>;
  /** Freezes only this fixture gateway's automation scheduler; its clock survives gateway-child restarts. */
  automationClock(): Promise<{ now: number; advance(ms: number): Promise<number> }>;
  /**
   * Grants the open page the microphone and the camera, as an operator allowing them in the browser's permission prompt.
   * The web target's Chromium carries a fake camera and microphone (`web-browser.ts`), so `getUserMedia` then answers with
   * that device instead of refusing. A page that never asks keeps being refused, which is what a use case about a refused
   * microphone proves.
   */
  allowMedia(): Promise<void>;
  /**
   * Every other tab the page asked for since it loaded: a `window.open` call, or a press on a `target="_blank"` link
   * nothing else handled, in the order the app asked. It answers the address the app asked to open, resolved against
   * the page, and whether the request asked for `noopener`/`noreferrer` — never what a second page would end up with,
   * because the engine only ever drives one page. An empty list means the app asked for no tab at all.
   */
  tabs(): Promise<TabRequest[]>;
  /** The last tab the page asked for, or `undefined` when it asked for none. */
  tab(): Promise<TabRequest | undefined>;
  expectLinkTo(within: Locator, name: string, href: string): Promise<void>;
  contextMenu(target: Locator): Promise<void>;
  messageActions(target: Locator): Promise<void>;
  /** Shows the open conversation's Work pane and adds the view it names. The web's launcher menu writes a keyboard
   * shortcut on each entry and opens the pane beside the chat. */
  openWorkView(name: string): Promise<void>;
  /** Asks to delete a named file or folder row of a Files navigator. */
  deleteEntry(within: Locator, name: string): Promise<void>;
  flip(target: Locator): Promise<void>;
  /** Replaces the user agent the next page sees, for the macOS-only app hand-off. */
  spoofUserAgent(userAgent: string): Promise<void>;
  intercept(method: string, path: RegExp): Promise<Intercepted>;
  /** Answers every request matching `method` and `path` with the same JSON until stopped. */
  answerAll(method: string, path: RegExp, body: string, status?: number): Promise<{ stop(): Promise<void> }>;
  /** Holds every download of the app chunk until `deliver`, so the boot screen stays up; `reject` refuses them. */
  holdAppChunks(): Promise<{ arrived(): Promise<void>; deliver(): Promise<void>; reject(status: number, error: string): Promise<void> }>;
  /** Drops an installed offline worker and its caches before the next load. */
  clearOffline(): Promise<void>;
  repository(): Promise<{ path: string; git(...args: string[]): string }>;
  stored(text: string): Promise<string[]>;
  secretDirectories(): Promise<string[]>;
};

/** The steps whose gesture or reading differs per platform; each target fills its own table of them. */
type PlatformSteps = Omit<Hui, "workspace" | "configDir" | "piAgentDir" | "gateway" | "api" | "createSession" | "createChief" | "prompt" | "createSubagent" | "provider" | "restartGateway" | "exitRuntimes" | "repository" | "holdTool" | "openSubagent" | "world" | "gatewayStub" | "automationClock">;

/** A tap at the middle of where a target is at the moment of the press. */
const tapAt = async (target: Locator) => {
  const box = await target.boundingBox();
  if (!box) throw new Error("tapAt: the target is not on screen");
  await target.tap({ position: { x: box.width / 2, y: box.height / 2 } });
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * The clipboard a test reads and refuses: `navigator.clipboard`'s writes recorded on `window.huiCopied`, and a refused
 * write throwing the way a browser refuses one. It runs in the page, so it closes over nothing, and every target
 * installs it twice: as an init script for every page after it and in the page that is open, so a test may install it
 * before or after its last navigation. A page stub that only reached the open page would be gone at the next one —
 * `hui.clipboard()` followed by `hui.open(...)` is the ordinary order — and the copy would go to the device's own
 * clipboard, which no test can read.
 */
const clipboardStub = ({ refuse = false, legacyCopy = false }: { refuse?: boolean; legacyCopy?: boolean } = {}) => {
  const page = window as unknown as { huiCopied: string };
  page.huiCopied = "";
  navigator.clipboard.writeText = async (text) => {
    if (refuse) throw new DOMException("Clipboard write refused", "NotAllowedError");
    page.huiCopied = text;
  };
  navigator.clipboard.write = async (items) => {
    if (refuse) throw new DOMException("Clipboard write refused", "NotAllowedError");
    const blobs = await Promise.all(items.flatMap((item) => item.types.map((type) => item.getType(type))));
    const sizes = await Promise.all(blobs.map(async (blob) => blob.type === "image/png" ? createImageBitmap(blob).then((bitmap) => ` ${bitmap.width}x${bitmap.height}`, () => "") : ""));
    page.huiCopied = blobs.map((blob, index) => `${blob.type}${sizes[index]}`).join(",");
  };
  if (refuse) {
    document.execCommand = ((command: string) => {
      if (command === "copy" && legacyCopy) {
        const active = document.activeElement;
        page.huiCopied = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
          ? active.value
          : String(document.getSelection() ?? "");
      }
      return legacyCopy;
    }) as typeof document.execCommand;
  }
  return null;
};

/**
 * Records the state a page shows and then replaces within one render: a rich embed's "Rendering diagram…" lives only
 * until its chunk arrives, and how long that takes is the device's, so a test that watched only the live DOM would race
 * it. Every element a page adds with `role="status"` is kept with the text it carried, on `window.huiStatuses`.
 */
const statusRecorder = () => {
  const page = window as unknown as { huiStatuses: string[] };
  const seen: string[] = page.huiStatuses = [];
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && node.getAttribute("role") === "status") seen.push(node.textContent ?? "");
      }
    }
  }).observe(document, { childList: true, subtree: true });
  return null;
};

/** Mobile WebKit cannot emit a protocol mouse wheel. Canvas controls consume the same wheel path their touch adapter
 * uses; otherwise scroll the browser-owned container, producing its real scroll events without changing its layout. */
const scrollPhone = ({ x, y, dx, dy }: { x: number; y: number; dx: number; dy: number }) => {
  let target = document.elementFromPoint(x, y);
  if (!target) throw new Error(`scroll: nothing is at ${x}, ${y}`);
  for (let inner = target.shadowRoot?.elementFromPoint(x, y); inner && inner !== target; inner = target.shadowRoot?.elementFromPoint(x, y)) target = inner;
  const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, deltaX: dx, deltaY: dy });
  if (!target.dispatchEvent(wheel)) return null;
  for (let node: Element | null = target; node; node = node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null) {
    const style = getComputedStyle(node);
    const scrolls = dx !== 0
      ? node.scrollWidth > node.clientWidth && /auto|scroll|overlay/u.test(style.overflowX)
      : node.scrollHeight > node.clientHeight && /auto|scroll|overlay/u.test(style.overflowY);
    if (scrolls) { node.scrollBy({ left: dx, top: dy, behavior: "instant" }); return null; }
  }
  window.scrollBy({ left: dx, top: dy, behavior: "instant" });
  return null;
};

const holding = <R>() => {
  let arrive: () => void = () => undefined;
  let decide: (handle: (route: R) => Promise<void>) => void = () => undefined;
  let done: (failure?: unknown) => void = () => undefined;
  const arrival = new Promise<void>((resolve) => { arrive = resolve; });
  const decision = new Promise<(route: R) => Promise<void>>((resolve) => { decide = resolve; });
  const handled = new Promise<unknown>((resolve) => { done = resolve; });
  return {
    arrival,
    hold: async (route: R) => {
      arrive();
      try {
        await (await decision)(route);
        done();
      } catch (failure) {
        done(failure ?? new Error("the held request's handler failed"));
        throw failure;
      }
    },
    settle: async (handle: (route: R) => Promise<void>) => {
      await arrival;
      decide(handle);
      const failure = await handled;
      if (failure) throw failure;
    },
  };
};

const deliverBehind = async (method: string, url: string, body: string | undefined) => {
  const response = await fetch(url, { method, headers: { "x-hui": "1", "content-type": "application/json" }, body });
  if (!response.ok) throw new Error(`${method} ${url} answered ${response.status}: ${await response.text()}`);
};

const touch = ({ x, y, type }: { x: number; y: number; type: "pointerdown" | "pointerup" }) => {
  const target = document.elementFromPoint(x, y);
  if (!target) throw new Error(`touch: nothing is at ${x}, ${y}`);
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
  target.dispatchEvent(new PointerEvent(type, { ...init, pointerId: 1, pointerType: "touch", isPrimary: true }));
  if (type === "pointerup") target.dispatchEvent(new MouseEvent("click", init));
  return null;
};

/** Touch events a browser sends; a canvas reads them where it never sees a synthetic pointer. */
const swipe = ({ x, y, drag }: { x: number; y: number; drag: number }) => {
  const target = document.elementFromPoint(x, y);
  if (!target) throw new Error(`touch: nothing is at ${x}, ${y}`);
  const legacy = document as Document & {
    createTouch?: (view: Window, target: EventTarget, id: number, pageX: number, pageY: number, screenX: number, screenY: number) => Touch;
    createTouchList?: (...touches: Touch[]) => TouchList;
  };
  let legacyLists = false;
  const at = (clientY: number) => {
    try { return new Touch({ identifier: 1, target, clientX: x, clientY, screenX: x, screenY: clientY }); }
    catch (error) {
      // WebKit exposes Touch but its constructor is illegal; its native Touch/TouchList factories remain supported.
      if (!legacy.createTouch || !legacy.createTouchList) throw error;
      legacyLists = true;
      return legacy.createTouch(window, target, 1, x + scrollX, clientY + scrollY, x, clientY);
    }
  };
  const list = (touches: Touch[]) => legacyLists ? legacy.createTouchList!(...touches) as unknown as Touch[] : touches;
  const fire = (type: string, moving: Touch[], ended: Touch[]) => target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches: list(moving), changedTouches: list(ended), targetTouches: list(moving) }));
  fire("touchstart", [at(y)], [at(y)]);
  for (let moved = 0; Math.abs(moved) < Math.abs(drag);) {
    moved = Math.sign(drag) * Math.min(Math.abs(moved) + 40, Math.abs(drag));
    fire("touchmove", [at(y + moved)], [at(y + moved)]);
  }
  // The finger settles where it stopped, so the drag ends without the momentum a flick would leave.
  if (drag) fire("touchmove", [at(y + drag)], [at(y + drag)]);
  fire("touchend", [], [at(y + drag)]);
  return null;
};

/**
 * Pointer events for a two-finger touch gesture, which a browser only sends for real fingers: a synthetic pointer has
 * no active pointer to capture, so the element that would capture it under a real finger accepts it here too.
 */
const pinch = ({ x, y, from, to }: { x: number; y: number; from: number; to: number }) => {
  const target = document.elementFromPoint(x, y);
  if (!target) throw new Error(`pinch: nothing is at ${x}, ${y}`);
  const capture = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function () {};
  const fire = (type: string, pointerId: number, clientX: number, isPrimary = false) => target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId, pointerType: "touch", isPrimary, clientX, clientY: y }));
  fire("pointerdown", 1, x - from / 2, true);
  fire("pointerdown", 2, x + from / 2);
  for (let step = 1; step <= 8; step += 1) {
    const gap = from + ((to - from) * step) / 8;
    fire("pointermove", 1, x - gap / 2);
    fire("pointermove", 2, x + gap / 2);
  }
  fire("pointerup", 2, x + to / 2);
  Element.prototype.setPointerCapture = capture;
  (window as unknown as { huiFinger?: { x: number; y: number } }).huiFinger = { x: x - to / 2, y };
  return null;
};

const fingerDrag = ({ dx, dy }: { dx: number; dy: number }) => {
  const held = (window as unknown as { huiFinger?: { x: number; y: number } }).huiFinger;
  if (!held) throw new Error("fingerDrag: no pinch left a finger down");
  const target = document.elementFromPoint(held.x, held.y);
  if (!target) throw new Error(`fingerDrag: nothing is at ${held.x}, ${held.y}`);
  const capture = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function () {};
  const fire = (type: string, clientX: number, clientY: number) => target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "touch", isPrimary: true, clientX, clientY }));
  for (let step = 1; step <= 8; step += 1) fire("pointermove", held.x + (dx * step) / 8, held.y + (dy * step) / 8);
  fire("pointerup", held.x + dx, held.y + dy);
  Element.prototype.setPointerCapture = capture;
  delete (window as unknown as { huiFinger?: unknown }).huiFinger;
  return null;
};

/**
 * Records every other tab the app asks this page for — a `window.open` call, or the press of a `target="_blank"` link —
 * and lets the browser do exactly what it would do without this script: the app's request is what a test reads, because
 * the engine only ever drives one page. The listener sits on `window` in the bubble phase on purpose: HUI's own handlers
 * (the media viewer, a link's own component) run first and cancel the press with `preventDefault`, and a press the app
 * handled is no tab request at all. Each document keeps its own list, so a widget's frame records only what the widget
 * itself asked.
 */
const recordTabs = () => {
  type Raw = { url: string; via: "window.open" | "link"; asked: string };
  const requests: Raw[] = [];
  (window as unknown as { huiTabs: Raw[] }).huiTabs = requests;
  const address = (url: unknown) => {
    const asked = typeof url === "string" ? url : url instanceof URL ? url.href : "";
    try {
      return new URL(asked, window.location.href).href;
    } catch {
      return asked;
    }
  };
  const open = window.open.bind(window);
  window.open = function recordedOpen(url?: string | URL, _target?: string, features?: string) {
    requests.push({ url: address(url), via: "window.open", asked: features ?? "" });
    return open(url, _target, features);
  } as typeof window.open;
  window.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    if (!anchor || anchor.target !== "_blank" || anchor.hasAttribute("download")) return;
    requests.push({ url: anchor.href, via: "link", asked: anchor.getAttribute("rel") ?? "" });
  });
  return null;
};

const trackSockets = () => {
  const sockets = new Set<WebSocket>();
  (window as unknown as { huiSockets: Set<WebSocket> }).huiSockets = sockets;
  const Native = window.WebSocket;
  // Vite's development client opens its socket anyway, and any address that refuses it makes Chromium log a failed
  // connection on every page, so the client gets a socket that never connects and never reports.
  window.WebSocket = Object.setPrototypeOf(function (url: string | URL, protocols?: string | string[]) {
    if (protocols === "vite-hmr") return Object.assign(new EventTarget(), { readyState: 0, send() {}, close() {} }) as unknown as WebSocket;
    const socket = new Native(url, protocols);
    sockets.add(socket);
    socket.addEventListener("close", () => sockets.delete(socket));
    return socket;
  }, Native) as unknown as typeof WebSocket;
};

/** Ordinary tests isolate routed requests from WebKit's worker; offline tests explicitly exercise the real worker. */
function huiTest(offline: boolean) {
  return base.extend<{ hui: Hui }>({
  hui: async (fixtures, use) => {
    const port = new URL(fixtures.app.baseUrl!).port;
    const file = new URL(`../../.e2e/hui/receipt-${port}.json`, import.meta.url);
    await expect.poll(() => readFile(file).then(() => true, () => false), { timeout: 60_000 }).toBe(true);
    const readReceipt = async () => JSON.parse(await readFile(file, "utf8")) as Receipt;
    const receipt = await readReceipt();

    const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const response = await fetch(receipt.url + path, {
        method,
        // A kept-alive socket may be closed by the gateway while a test works, and fetch never retries a POST.
        headers: { "x-hui": "1", "content-type": "application/json", connection: "close" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
      return (await response.json()) as T;
    };
    const control = async (method: string, path: string) => {
      const response = await fetch(receipt.providerUrl + path, { method });
      if (!response.ok) throw new Error(`provider ${path} answered ${response.status}`);
    };
    const groups = async () => (await api<SessionList>("GET", "/__hui/sessions")).groups;
    const sessions = async () => (await groups()).flatMap((group) => group.sessions);
    const sessionIds = async () => (await sessions()).map((session) => session.id);
    const taskIds = async () => (await api<{ tasks: { id: string }[] }>("GET", "/__hui/automation")).tasks.map((task) => task.id);
    // Archived bots count too: a test that archives one leaves it behind for the cleanup to remove.
    const botIds = async () => [...(await api<{ bots: { id: string }[] }>("GET", "/__hui/bots")).bots,
      ...(await api<{ bots: { id: string }[] }>("GET", "/__hui/bots?archived=1")).bots].map((bot) => bot.id);
    const backlogTaskIds = async () => (await api<{ items: { id: string; kind: string }[] }>("GET", "/__hui/backlog")).items
      .filter((item) => item.kind === "local").map((item) => item.id);
    const prompt = async (session: { id: string }, text: string) => {
      const state = async () => (await sessions()).find(({ id }) => id === session.id);
      // A stored row reports idle before its runtime exists, and a prompt then is refused as still starting, so the
      // fixture opens the chat as the operator does and waits for the runtime the prompt needs.
      if ((await state())?.runtime?.active !== true) await api("POST", `/__hui/sessions/${session.id}/open`);
      await expect.poll(async () => {
        const found = await state();
        return found?.runtime?.active === true && found.status === "idle";
      }, { timeout: 30_000 }).toBe(true);
      await api("POST", `/__hui/sessions/${session.id}/prompt`, { text });
    };
    const browser = () => (fixtures as unknown as { browser: Browser }).browser;
    // The shared receipt is safe to print, so the harness token stays in the private one it names.
    const token = (async () => (JSON.parse(await readFile(receipt.receipt, "utf8")) as { token: string }).token)();
    let automationFrozen = false;
    const automationClockControl = async (action: "freeze" | "advance" | "resume", ms?: number): Promise<number | null> => {
      const response = await fetch(`${receipt.url}/__verification/automation-clock`, {
        method: "POST", headers: { "x-hui-verification": await token, "content-type": "application/json" },
        body: JSON.stringify({ action, ms }),
      });
      if (!response.ok) throw new Error(`automation clock ${action} answered ${response.status}: ${await response.text()}`);
      return (await response.json() as { now: number | null }).now;
    };
    const network = async (mode: "online" | "offline" | "silent") => {
      const response = await fetch(`${receipt.url}/__verification/network`, {
        method: "POST",
        headers: { "x-hui-verification": await token, "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) throw new Error(`network control answered ${response.status}: ${await response.text()}`);
    };
    const existing = new Set(await sessionIds());
    const existingGroups = new Set((await groups()).map((group) => group.label));
    const existingTasks = new Set(await taskIds());
    const existingBots = new Set(await botIds());
    const existingBacklogTasks = new Set(await backlogTaskIds());
    const workerIds = async () => (await api<{ workers: { id: string }[] }>("GET", "/__hui/workers")).workers.map((worker) => worker.id);
    const existingWorkers = new Set(await workerIds());
    const workerHomes: string[] = [];
    const worlds: World[] = [];
    const gatewayStubs: GatewayStub[] = [];
    const settings = await api<unknown>("GET", "/__hui/settings");
    const directories: string[] = [];
    const nativeDisplay = onPhone(fixtures.app.baseUrl) ? androidDisplay() : undefined;

    const webSteps: PlatformSteps = {
      open: (path) => fixtures.app.open(path),
      reload: () => browser().reload(),
      clearState: () => fixtures.app.clearState(),
      url: () => browser().url(),
      // The stub goes into the page that is open as well as every page after it, so a test may install it once its last
      // navigation is behind it — which is the only order a WebView can take (`clipboardStub`).
      clipboard: async (options = {}) => {
        await browser().addInitScript(clipboardStub, options);
        await browser().evaluate(clipboardStub, options);
      },
      copied: () => browser().evaluate(() => (window as unknown as { huiCopied?: string }).huiCopied ?? ""),
      recordStatuses: async () => {
        await browser().addInitScript(statusRecorder);
        await browser().evaluate(statusRecorder);
      },
      statuses: () => browser().evaluate(() => (window as unknown as { huiStatuses?: string[] }).huiStatuses ?? []),
      keyboard: { down: (key) => browser().keyboard.down(key), up: (key) => browser().keyboard.up(key) },
      type: (text) => browser().keyboard.type(text),
      phoneScreen: async (orientation = "portrait") => {
        const phone = orientation === "portrait" ? { width: 390, height: 844 } : { width: 844, height: 390 };
        await browser().setViewport(phone);
        return phone;
      },
      viewportSize: () => browser().evaluate(() => ({ width: innerWidth, height: innerHeight })),
      insets: async ({ top = 0, right = 0, bottom = 0, left = 0 }) => {
        await browser().evaluate((insets) => {
          for (const [side, value] of Object.entries(insets)) document.documentElement.style.setProperty(`--safe-area-${side}`, `${value}px`);
          return null;
        }, { top, right, bottom, left });
      },
      safeDisplay: async (insets = {}) => {
        await webSteps.insets(insets);
        await browser().evaluate(async () => {
          await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => undefined)));
          return null;
        });
        const size = await browser().evaluate(() => ({ width: innerWidth, height: innerHeight }));
        return { ...size, top: insets.top ?? 0, left: insets.left ?? 0, right: size.width - (insets.right ?? 0),
          bottom: size.height - (insets.bottom ?? 0), box: async (target) => {
            const box = await target.boundingBox();
            if (!box) throw new Error("display measurement: the target is not laid out");
            return box;
          } };
      },
      overflowsSideways: () => browser().evaluate(() => [document.documentElement, ...document.querySelectorAll(".main, .sidebar")]
        .some((element) => element.scrollWidth > element.clientWidth)),
      reachable: async (target) => {
        await target.scrollIntoView();
        const box = await target.boundingBox();
        if (!box) throw new Error("reachable: the target lays out no box");
        return browser().evaluate(({ x, y, width, height }) => {
          const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
          const [cx, cy] = [x + width / 2, y + height / 2];
          let hit = document.elementFromPoint(cx, cy);
          for (let inner = hit?.shadowRoot?.elementFromPoint(cx, cy); inner && inner !== hit; inner = hit.shadowRoot?.elementFromPoint(cx, cy)) hit = inner;
          let matched = false;
          for (let element = hit; element; element = element.parentElement ?? (element.getRootNode() as ShadowRoot).host ?? null) {
            if (element.hasAttribute("inert")) return false;
            const rect = element.getBoundingClientRect();
            matched ||= same(rect.x, x) && same(rect.y, y) && same(rect.width, width) && same(rect.height, height);
          }
          return matched;
        }, box);
      },
      wideScreen: (width = 1440) => browser().setViewport({ width, height: 900 }),
      paletteChord: async () => {
        const apple = await browser().evaluate(() => /Mac|iPhone|iPad|iPod/u.test(navigator.platform));
        await browser().keyboard.press(apple ? "Meta+K" : "Control+K");
      },
      settingsChord: async () => {
        const apple = await browser().evaluate(() => /Mac|iPhone|iPad|iPod/u.test(navigator.platform));
        await browser().keyboard.press(apple ? "Meta+Shift+Comma" : "Control+Shift+Comma");
      },
      workChord: async (code) => {
        const apple = await browser().evaluate(() => /Mac|iPhone|iPad|iPod/u.test(navigator.platform));
        await browser().keyboard.press([apple ? "Meta" : "Control", "Alt", "Shift", code].join("+"));
      },
      back: () => browser().back(),
      forward: () => browser().forward(),
      peek: (target) => target.hover(),
      faces: () => browser().evaluate(() => [...document.querySelectorAll(".bot-avatar")].map((node) => ({
        size: [...node.classList].find((name) => name.startsWith("bot-avatar--") && !["bot-avatar--emoji", "bot-avatar--face"].includes(name))?.slice("bot-avatar--".length) ?? "",
        shape: node.querySelector("hui-bot-face")?.getAttribute("shape") ?? "",
        ears: node.querySelector("hui-bot-face")?.getAttribute("ears") ?? "",
        emoji: node.querySelector(".bot-avatar__glyph")?.textContent ?? "",
        color: (node.querySelector("hui-bot-face") as unknown as { color?: string } | null)?.color ?? "",
      }))),
      zone: () => browser().evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
      providerRequests: async () => (await readFile(join(dirname(receipt.workspace), "artifacts/provider.jsonl"), "utf8").catch(() => "")).split("\n").filter((line) => line.trim()).length,
      network,
      answerNextDialog: async (answer) => {
        const off = await browser().onDialog(async (dialog) => {
          // One answer only: a later dialog is the test's to expect.
          await off();
          if (answer === "accept") await dialog.accept();
          else await dialog.dismiss();
        });
      },
      offlineFilesReady: offlineReadinessProbe(
        () => browser().evaluate(readOfflineReadiness),
        () => browser().evaluate(readOfflineCacheNames),
      ),
      activateSidebarRow: async (title) => {
        await browser().evaluate((name) => {
          const row = [...document.querySelectorAll("[data-testid='session-row']")].find((element) => element.textContent?.includes(name));
          const link = row?.querySelector("a");
          if (!(link instanceof HTMLElement)) throw new Error(`activateSidebarRow: no link in the row for ${name}`);
          link.focus();
          return null;
        }, title);
        await browser().keyboard.press("Enter");
      },
      sessionList: async () => {
        const phone = await browser().evaluate(() => matchMedia("(max-width: 900px), (max-width: 932px) and (max-height: 500px) and (orientation: landscape)").matches);
        if (!phone) return;
        // A closing backdrop stays visible during its fade, and an initial route may not have drawn its trigger yet.
        // Read the drawer's actual state, then let tap wait for the real Open navigation control when it is closed.
        const opened = () => browser().evaluate(() => document.querySelector(".sidebar")?.getAttribute("data-open") === "true");
        if (!(await opened())) await fixtures.screen.getByRole("button", "Open navigation", { visible: true }).first().tap();
        await expect.poll(opened).toBe(true);
      },
      settingsPages: async () => {
        const phone = await browser().evaluate(() => matchMedia("(max-width: 900px), (max-width: 932px) and (max-height: 500px) and (orientation: landscape)").matches);
        if (!phone) return;
        const opened = () => browser().evaluate(() => document.querySelector(".settings-sidebar")?.getAttribute("data-open") === "true");
        if (!(await opened())) await fixtures.screen.getByRole("button", "Open settings navigation", { visible: true }).first().tap();
        await expect.poll(opened).toBe(true);
      },
      sessionMenu: async (title) => {
        await webSteps.sessionList();
        const row = fixtures.screen.getByTestId("session-row").filter({ hasText: title });
        const actions = row.getByRole("button", `Actions for ${title}`);
        await actions.focus();
        await actions.tap();
        return row;
      },
      glyph: (title) => browser().evaluate((name) => {
        const row = [...document.querySelectorAll("[data-testid='session-row']")].find((element) => element.textContent?.includes(name));
        const indicator = row?.querySelector(".sidebar-session-indicator");
        if (!indicator) throw new Error(`glyph: no sidebar row shows ${name}`);
        return { label: indicator.getAttribute("title") ?? "", animated: indicator.getAnimations({ subtree: true }).length > 0 };
      }, title),
      streamOpen: () => expect.poll(() => browser().evaluate(() => {
        const sockets = (window as unknown as { huiSockets?: Set<WebSocket> }).huiSockets;
        return sockets ? [...sockets].filter((socket) => socket.readyState === WebSocket.OPEN).length : 0;
      })).toBeGreaterThan(0),
      dropStreams: async () => {
        await browser().evaluate(() => {
          for (const socket of (window as unknown as { huiSockets: Set<WebSocket> }).huiSockets) socket.close();
          return null;
        });
      },
      accentDot: (title) => browser().evaluate((name) => {
        const row = [...document.querySelectorAll("[data-testid='session-row']")].find((element) => element.textContent?.includes(name));
        const dot = row?.querySelector(".sidebar-session-unread-dot");
        if (!dot) return false;
        const accent = document.createElement("span");
        accent.style.color = "var(--accent)";
        dot.append(accent);
        const shown = getComputedStyle(dot).backgroundColor === getComputedStyle(accent).color;
        accent.remove();
        return shown;
      }, title),
      overflowX: () => browser().evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      pressed: (within, name, on = true) => within.getByRole("button", { name, pressed: on }),
      appearance: () => browser().evaluate(() => (document.documentElement.dataset["themeMode"] === "dark" ? "dark" : "light")),
      storedAppearance: async () => {
        const raw = await browser().evaluate(() => localStorage.getItem("hui.appearance.v1"));
        try {
          const parsed: unknown = raw ? JSON.parse(raw) : null;
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
        } catch { return null; }
      },
      saveAppearance: async (patch) => {
        const raw = await browser().evaluate(() => localStorage.getItem("hui.appearance.v1"));
        const current: unknown = raw ? JSON.parse(raw) : {};
        const next = { ...(current && typeof current === "object" ? current as Record<string, unknown> : {}), ...patch, version: 1 };
        await browser().evaluate((json: string) => {
          localStorage.setItem("hui.appearance.v1", json);
          return null;
        }, JSON.stringify(next));
      },
      refuseStorage: async () => {
        await browser().evaluate(() => {
          Storage.prototype.setItem = function refuse() {
            throw new DOMException("The storage is full", "QuotaExceededError");
          };
          return null;
        });
      },
      appChrome: () => fixtures.screen.getByLabel("Primary navigation"),
      deviceAppearance: (scheme) => browser().emulateMedia({ colorScheme: scheme }),
      look: async (target) => {
        await target.scrollIntoView();
        const box = await target.boundingBox();
        if (!box) throw new Error("look: the target lays out no box");
        const [label, href, className, text] = await Promise.all([
          target.getAttribute("aria-label"), target.getAttribute("href"), target.getAttribute("class"), target.textContent(),
        ]);
        return browser().evaluate(readLook, { ...box, label, href, className, text });
      },
      attach: async (target, files) => {
        const made = files.some((file) => typeof file !== "string") ? await mkdtemp(join(tmpdir(), "hui-e2e-files-")) : "";
        if (made) directories.push(made);
        await target.setInputFiles(await Promise.all(files.map(async (file) => {
          if (typeof file === "string") return fileURLToPath(new URL(`files/${file}`, import.meta.url));
          await writeFile(join(made, file.name), "text" in file ? file.text : Buffer.alloc(file.bytes, "x"));
          return join(made, file.name);
        })));
      },
      download: async (target) => {
        const file = await browser().waitForDownload(() => target.tap());
        return { name: file.suggestedFilename, text: await readFile(file.absolutePath, "utf8") };
      },
      addWorker: (name) => addWorkerOnThisMachine(api, workerHomes, name),
      clipboardSpy: async () => {
        await browser().evaluate(() => {
          const writes: string[] = [];
          Object.assign(window, { huiClipboardWrites: writes });
          const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
          navigator.clipboard.writeText = (text) => {
            writes.push(text);
            return writeText(text);
          };
          return null;
        });
      },
      clipboardWrites: () => browser().evaluate(() => (window as unknown as { huiClipboardWrites?: string[] }).huiClipboardWrites ?? []),
      newSessionDraft: () => browser().evaluate(async () => {
        if (!(await indexedDB.databases()).some(({ name }) => name === "hui-control-ui")) return "";
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open("hui-control-ui");
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        try {
          if (!db.objectStoreNames.contains("composerDrafts")) return "";
          const record = await new Promise<{ text?: string } | undefined>((resolve, reject) => {
            const get = db.transaction("composerDrafts").objectStore("composerDrafts").get("new-session");
            get.onsuccess = () => resolve(get.result);
            get.onerror = () => reject(get.error);
          });
          return record?.text ?? "";
        } finally {
          db.close();
        }
      }),
      hold: async (target, until) => {
        const box = await target.boundingBox();
        if (!box) throw new Error("hold: the target is not on screen");
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await browser().evaluate(touch, { ...point, type: "pointerdown" });
        await expect(until).toBeVisible();
        await browser().evaluate(touch, { ...point, type: "pointerup" });
      },
      drag: async (target, onto, whileOver) => {
        const centre = async (locator: Locator) => {
          const box = await locator.boundingBox();
          if (!box) throw new Error("drag: a target is not on screen");
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        };
        const from = await centre(target);
        const to = await centre(onto);
        await browser().mouse.move(from.x, from.y);
        await browser().mouse.down();
        await browser().mouse.move(to.x, to.y);
        await whileOver();
        await browser().mouse.up();
      },
      dragBy: async (target, { dx, dy }, whileOver) => {
        const box = await target.boundingBox();
        if (!box) throw new Error("dragBy: the target is not on screen");
        const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await browser().mouse.move(from.x, from.y);
        await browser().mouse.down();
        await browser().mouse.move(from.x + dx, from.y + dy);
        await whileOver();
        await browser().mouse.up();
      },
      touchTap: async (target) => {
        await target.scrollIntoView();
        const box = await target.boundingBox();
        if (!box) throw new Error("touchTap: the target is not on screen");
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await browser().evaluate(touch, { ...point, type: "pointerdown" });
        await browser().evaluate(touch, { ...point, type: "pointerup" });
      },
      touch: async (target, { drag = 0 } = {}) => {
        const box = await target.boundingBox();
        if (!box) throw new Error("touch: the target is not on screen");
        await browser().evaluate(swipe, { x: box.x + box.width / 2, y: box.y + box.height / 2, drag });
      },
      pinch: async (target, { from, to }) => {
        const box = await target.boundingBox();
        if (!box) throw new Error("pinch: the target is not on screen");
        await browser().evaluate(pinch, { x: box.x + box.width / 2, y: box.y + box.height / 2, from, to });
      },
      fingerDrag: async ({ dx, dy }) => {
        await browser().evaluate(fingerDrag, { dx, dy });
      },
      contextMenu: (target) => target.secondaryTap(),
      messageActions: async (target) => {
        if (onPhone(fixtures.app.baseUrl) || onWebKitPhone(fixtures.app.baseUrl)) {
          // Touch layouts draw the actions outright. Bring the message into view rather than pretending to hover it.
          await target.scrollIntoView();
          await expect(target).toBeVisible();
        } else await target.hover();
      },
      openWorkView: async (name) => {
        const show = fixtures.screen.getByRole("button", "Show Work pane");
        const plus = fixtures.screen.getByRole("button", "Open Work view");
        const panel = fixtures.screen.getByRole("button", { name: /^Active panel/u });
        await expect.poll(async () => (await show.isVisible()) || (await plus.isVisible()) || (await panel.isVisible())).toBe(true);
        if (await show.isVisible()) await show.tap();
        if (await plus.isVisible()) {
          await plus.tap();
          await fixtures.screen.getByRole("menuitem").filter({ hasText: name }).tap();
        } else {
          await panel.tap();
          await fixtures.screen.getByRole("listbox", "Active panel").getByText(name, { exact: true }).first().tap();
        }
      },
      deleteEntry: async (within, name) => {
        await within.getByRole("button", `Delete ${name}`).tap();
      },
      scrollTo: (_within, target) => target.scrollIntoView(),
      frame: async (selector) => browser().frameLocator(selector),
      allowMedia,
      controllableClock: async () => {
        // The page that is open gets it now, and every page after it through an init script, so a reload keeps the clock.
        await browser().addInitScript(installClock);
        return browser().evaluate(installClock);
      },
      advanceClock: (ms) => browser().evaluate(advanceClock, ms),
      tabs: () => browser().evaluate(() => ((window as unknown as { huiTabs?: { url: string; via: "window.open" | "link"; asked: string }[] }).huiTabs ?? [])
        .map(({ url, via, asked }) => ({ url, via, asked, noopener: /\bnoopener\b/u.test(asked), noreferrer: /\bnoreferrer\b/u.test(asked) }))),
      tab: async () => (await steps.tabs()).at(-1),
      expectLinkTo: (within, name, href) => expect(within.getByRole("link", name)).toHaveAttribute("href", href),
      textOf: async (target) => (await target.textContent()) ?? "",
      stepState: (step, state) => expect(step).toHaveAttribute("data-status", state),
      tapAt,
      scrollSideways: async (target) => {
        const box = await target.boundingBox();
        if (!box) throw new Error("scrollSideways: the target is not on screen");
        const point = { x: box.x + Math.min(24, box.width / 2), y: box.y + box.height / 2 };
        if (onWebKitPhone(fixtures.app.baseUrl)) await browser().evaluate(scrollPhone, { ...point, dx: 240, dy: 0 });
        else {
          await browser().mouse.move(point.x, point.y);
          await browser().mouse.wheel(240, 0);
        }
      },
      wheel: async (target, deltaY) => {
        const box = await target.boundingBox();
        if (!box) throw new Error("wheel: the target is not on screen");
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        if (onWebKitPhone(fixtures.app.baseUrl)) await browser().evaluate(scrollPhone, { ...point, dx: 0, dy: deltaY });
        else {
          await browser().mouse.move(point.x, point.y);
          await browser().mouse.wheel(0, deltaY);
        }
      },
      stored: (text) => storedContent(dirname(receipt.workspace), text),
      secretDirectories: async () => (await readdir("/tmp")).filter((name) => name.startsWith(`hui-secret-${receipt.serverPid}-`)),
      spoofUserAgent: (userAgent) => browser().addInitScript((agent: string) => {
        Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => agent });
      }, userAgent),
      answerAll: async (method, path, body, status = 200) => {
        await browser().route(path, (route) => (route.request.method === method
          ? route.fulfill({ status, contentType: "application/json", body })
          : route.fallback()));
        return { stop: () => browser().unroute(path) };
      },
      flip: async (target) => {
        const box = await target.boundingBox();
        if (!box) throw new Error("flip: the switch is not on screen");
        await target.tap({ position: { x: box.width / 2, y: box.height / 2 } });
      },
      clearOffline: async () => {
        // A worker installed by an earlier test can answer this navigation (and its app chunk) before an init
        // script runs, so drop it in the page that is already open as well; the script covers later pages.
        const clear = async () => {
          try {
            const registrations = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistrations() : [];
            await Promise.all(registrations.map((registration) => registration.unregister()));
            if ("caches" in globalThis) for (const key of await caches.keys()) await caches.delete(key);
          } catch { /* the page may not have these APIs */ }
          return null;
        };
        await browser().evaluate(clear);
        await browser().addInitScript(clear);
      },
      holdAppChunks: async () => {
        // The production build may preload the app chunk and import it again; hold every copy, not the entry
        // module, so the page still reaches `load` and the boot screen can be read.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let arrive!: () => void;
        const arrival = new Promise<void>((resolve) => { arrive = resolve; });
        let rejectWith: { status: number; error: string } | undefined;
        const pending = new Set<Promise<void>>();
        const appChunk = /\/assets\/hui-app-[^/]+\.js$/u;
        await browser().route(appChunk, (route) => {
          if (route.request.method !== "GET") return route.fallback();
          arrive();
          const work = (async () => {
            await gate;
            try {
              if (rejectWith) await route.fulfill({ status: rejectWith.status, json: { error: rejectWith.error } });
              else await route.continue();
            } catch { /* the page may have navigated away */ }
          })();
          pending.add(work);
          void work.finally(() => pending.delete(work));
          return work;
        });
        const drain = async () => { while (pending.size) await Promise.all([...pending]); };
        return {
          arrived: () => arrival,
          deliver: async () => { release(); await drain(); await browser().unroute(appChunk); },
          reject: async (status, error) => {
            rejectWith = { status, error };
            release();
            await drain();
            await browser().unroute(appChunk);
          },
        };
      },
      intercept: async (method, path) => {
        const { arrival, hold, settle } = holding<WebRoute>();
        let count = 0;
        let seen: { method: string; url: string; body: string } | undefined;
        await browser().route(path, (route) => {
          if (route.request.method !== method) return route.fallback();
          count += 1;
          seen = { method: route.request.method, url: route.request.url, body: route.request.postData ?? "" };
          return hold(route);
        });
        const decide = (handle: (route: WebRoute) => Promise<void>) => settle(handle).then(() => browser().unroute(path));
        return {
          arrived: () => arrival,
          request: () => {
            if (!seen) throw new Error("intercept: no request has arrived yet");
            return seen;
          },
          count: () => count,
          requestsFromTap: async (target) => {
            // Observe the browser's transport, not app callbacks. Another stream task cannot run inside click
            // dispatch; eventPhase becomes NONE after dispatch even if a handler stops propagation.
            await browser().evaluate(({ method, source, flags }) => {
              const matches = new RegExp(source, flags);
              const fetch = window.fetch;
              let click: Event | undefined;
              let count = 0;
              const capture = (event: Event) => { if (event.isTrusted) click = event; };
              document.addEventListener("click", capture, true);
              window.fetch = (input, init) => {
                const url = input instanceof Request ? input.url : new URL(String(input), location.href).href;
                matches.lastIndex = 0;
                if (click && click.eventPhase !== Event.NONE && matches.test(url)
                  && (init?.method ?? (input instanceof Request ? input.method : "GET")) === method) count += 1;
                return fetch.call(window, input, init);
              };
              Object.assign(window, { huiTapRequests: () => {
                window.fetch = fetch;
                document.removeEventListener("click", capture, true);
                return count;
              } });
              return null;
            }, { method, source: path.source, flags: path.flags });
            let found = 0;
            try {
              await target.tap();
            } finally {
              // Restore transport even if the gesture fails; each invocation owns only its observation window.
              found = await browser().evaluate(() => (window as unknown as { huiTapRequests(): number }).huiTapRequests());
            }
            return found;
          },
          deliver: () => decide((route) => route.continue()),
          reject: (status, error) => decide((route) => route.fulfill({ status, json: { error } })),
          answer: (json) => decide((route) => route.fulfill({ status: 200, contentType: "application/json", body: json })),
          deliverAndDrop: () => decide(async (route) => {
            await deliverBehind(method, route.request.url, route.request.postData);
            await route.abort();
          }),
        };
      },
    };

    // Each target's steps: the web fills its table, and a platform the suite gains adds its own beside it.
    const web = ({ web: webSteps } as Record<string, PlatformSteps | undefined>)[fixtures.platform];
    if (!web) throw new Error(`hui: the fixture has no steps for the ${fixtures.platform} target`);
    // The Android app's WebView is HUI's web page in another host, so its table is the web's except for what a WebView
    // cannot do: it has one page and one context, which the engine cannot replace between attempts, so the app's own
    // storage is cleared in place (and the page reloaded) where the web asks the engine for a clean context.
    // `webkit-phone` is the iPhone's engine at a phone's size: its table is the web's too, except that the steps needing
    // a desktop would quietly prove the desktop's behaviour on a phone (a mouse still moves in a touch context, and the
    // engine can be told to lay the page out wide), so they refuse instead and the test fails where the behaviour is
    // unprovable. WP7's area owners take the failures to a phone step or a catalogue exclusion. `sessionMenu` stays the
    // web's: its hover only reveals the row's button there, and the phone draws that button at phone widths anyway.
    const desktopOnly = (step: string) => (): never => {
      throw new Error(`hui.${step}() needs a desktop: phone targets keep their narrow touch layout and cannot prove a desktop-only gesture`);
    };
    const steps: PlatformSteps = onWebKitPhone(fixtures.app.baseUrl)
      ? {
          ...web,
          wideScreen: desktopOnly("wideScreen"),
          peek: desktopOnly("peek"),
          // The fake camera and microphone are the web target's Chromium, which this target does not launch: its WebKit
          // has no device at all, so granting a permission would only prove a refusal. A use case that needs the
          // microphone open stays off this target's required list.
          allowMedia: async () => {
            throw new Error("hui.allowMedia() needs the web target's fake camera and microphone: the webkit-phone target runs Playwright's WebKit, which has no device to grant, so a call here could only prove the refusal. A use case that needs the microphone open stays off the phone's required list.");
          },
        }
      : onPhone(fixtures.app.baseUrl)
        ? {
            ...web,
            // Page.url() is cached after its physical WebView closes. A real main-window read makes the engine
            // recover the owned native window before observing a user-initiated bridge/gateway handoff.
            url: () => browser().evaluate(() => location.href),
            phoneScreen: async (orientation = "portrait") => {
              nativeDisplay!.rotate(orientation);
              return steps.viewportSize();
            },
            viewportSize: async () => {
              let size: { width: number; height: number } | undefined;
              await expect.poll(async () => {
                const metrics = await browser().evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio, scale: visualViewport?.scale ?? 1 }));
                size = await nativeDisplay!.viewportSize(metrics);
                return true;
              }, { message: "the CSS viewport must match the attached native frame" }).toBe(true);
              return size!;
            },
            insets: async () => { throw new Error("Android owns its frame insets; use safeDisplay for real native measurements"); },
            safeDisplay: async (insets) => {
              nativeDisplay!.prepare();
              if (insets) {
                const path = await browser().url();
                const previous = await nativeDisplay!.target();
                if (nativeDisplay!.cutout()) {
                  // Applying Android resources recreates the Activity. Wait for its new real target before binding it.
                  await expect.poll(() => nativeDisplay!.target()).not.toBe(previous);
                  await fixtures.app.open(path);
                  nativeDisplay!.prepare();
                }
              }
              const metrics = () => browser().evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio, scale: visualViewport?.scale ?? 1 }));
              await expect.poll(async () => nativeDisplay!.ready(await metrics()), { message: "native inset resize must reach the real CSS viewport" }).toBe(true);
              return nativeDisplay!.measure(await metrics());
            },
            open: async (path) => {
              const destination = new URL(path, receipt.url);
              await openPhoneGateway(destination.origin);
              await fixtures.app.open(destination.href);
              refusePhoneNotificationPrompt();
            },
            // CDP routes and attempt-scoped page scripts work in the app's persistent context just as in Chromium.
            // Only context replacement, native downloads and genuinely unavailable desktop gestures need overrides.
            clearOffline: async () => {
              // The web's own reason holds here too: a worker an earlier test left can answer this navigation (and its app
              // chunk) before an init script runs, so it is dropped in the page that is open as well.
              const clear = async () => {
                const registrations = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistrations() : [];
                await Promise.all(registrations.map((registration) => registration.unregister()));
                if ("caches" in globalThis) for (const key of await caches.keys()) await caches.delete(key);
                return null;
              };
              await browser().evaluate(clear);
              await browser().addInitScript(clear);
            },
            wideScreen: desktopOnly("wideScreen"),
            peek: desktopOnly("peek"),
            tabs: async () => {
              // The app never asks its page for a tab in the app: `installNativeShell` hands an external address to the
              // shell's own browser (`openExternal`), so a WebView has no `window.open` request to read and no second page
              // to open. Refusing names that, instead of answering with a list that would mean "the app asked for none".
              throw new Error("hui.tabs() needs a browser: the app's WebView hands an external address to the shell's own browser, so the page never asks for a tab there and there is nothing to read. A use case that reads one stays off the phone's required list.");
            },
            tab: async () => {
              throw new Error("hui.tab() needs a browser: the app's WebView hands an external address to the shell's own browser, so the page never asks for a tab there and there is nothing to read. A use case that reads one stays off the phone's required list.");
            },
            controllableClock: async () => {
              // The clock is advanced in the page that holds it (`advanceClock` evaluates here), so it goes into the open
              // page and a reload starts a new one: a use case whose timer has to pass across a reload waits on the real
              // clock instead.
              return browser().evaluate(installClock);
            },
            advanceClock: (ms) => browser().evaluate(advanceClock, ms),
            allowMedia: async () => {
              // The app's WebView answers a page's permission prompt with the app's own Android grant (`RECORD_AUDIO`),
              // which a Playwright attempt cannot hand to it and a fake device cannot stand in for. A use case that needs
              // the microphone open stays off the phone's required list until the app grows a step for it.
              throw new Error("hui.allowMedia() needs the browser's own permission grant: the app's WebView takes its permissions from the Android app, so there is nothing for a test to grant. A use case that needs the microphone stays off the phone's required list until the app has a step for it.");
            },
            clearState: async () => {
              await fixtures.app.open("/");
              await browser().evaluate(clearAppStorage);
              await browser().reload();
            },
            download: async (target) => {
              // The app saves a download itself: an `http(s)` one goes to the system's download manager, a `blob:` or
              // `data:` one is written by the shell (`ShellDownloads`), and both land in `Downloads`. No browser download
              // event reaches the engine in a WebView, so this reads the folder the app wrote and fails, naming what it
              // found, when no file appeared.
              const before = new Map(deviceFiles().map(({ name, size }) => [name, size]));
              await target.tap();
              let written: { name: string; size: number } | undefined;
              await expect.poll(() => {
                written = deviceFiles().find(({ name, size }) => before.get(name) !== size && size > 0);
                return written?.name;
              }, { timeout: 60_000, message: `hui.download: the app saved nothing into ${PHONE_DOWNLOADS}; it holds ${JSON.stringify(deviceFiles())}` }).toBeDefined();
              // The download manager writes the file itself, so its size settles a moment after it appears.
              const saving = written!;
              let settled = saving.size;
              let file: { name: string; size: number } | undefined;
              await expect.poll(() => {
                const now = deviceFiles().find(({ name }) => name === saving.name);
                file = now !== undefined && now.size > 0 && now.size === settled ? now : undefined;
                settled = now?.size ?? settled;
                return file !== undefined;
              }, { timeout: 60_000, message: `hui.download: ${saving.name} never finished writing to ${PHONE_DOWNLOADS}` }).toBe(true);
              const path = `${PHONE_DOWNLOADS}/${file!.name}`;
              try {
                // One UI action must write one file, even when Downloads already holds other tests' files.
                expect(deviceFiles().filter(({ name, size }) => before.get(name) !== size).map(({ name }) => name)).toEqual([file!.name]);
                return { name: file!.name, text: deviceBytes(path).toString("utf8") };
              } finally {
                // Never remove or rename anything that existed before this action, including a changed-size file.
                if (!before.has(file!.name)) execFileSync(process.env["ADB"] ?? "adb", [
                  ...(process.env["ANDROID_SERIAL"] ? ["-s", process.env["ANDROID_SERIAL"]!] : []),
                  "shell", "rm", "--", `'${path.replaceAll("'", "'\\''")}'`,
                ], { timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
              }
            },
          }
        : web;
    if (onWebKitPhone(fixtures.app.baseUrl)) webkitServiceWorkers(offline);
    if (offline && fixtures.platform === "web" && !onPhone(fixtures.app.baseUrl)) await browser().addInitScript(observeOfflineLifecycle);
    if (fixtures.platform === "web") await browser().addInitScript(trackSockets);
    if (fixtures.platform === "web") await browser().addInitScript(recordTabs);
    await steps.clearState();

    try {
    await use({
      ...steps,
      automationClock: async () => {
        const alignPage = async (now: number) => {
          await browser().addInitScript(installClock, now);
          await browser().evaluate(installClock, now);
        };
        // This control belongs only to the isolated fixture, never an unauthenticated browser or product API.
        const denied = await fetch(`${receipt.url}/__verification/automation-clock`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "advance", ms: 0 }),
        });
        expect(denied.status).toBe(403);
        const now = await automationClockControl("freeze");
        if (now === null) throw new Error("The automation clock did not freeze");
        automationFrozen = true;
        await alignPage(now);
        return { now, advance: async (ms) => {
          const next = await automationClockControl("advance", ms);
          if (next === null) throw new Error("The automation clock is not frozen");
          await alignPage(next);
          return next;
        } };
      },
      workspace: receipt.workspace,
      configDir: receipt.huiConfig,
      piAgentDir: join(dirname(receipt.workspace), "agent"),
      gateway: receipt.url,
      api,
      createSession: async (input) =>
        (await api<{ session: { id: string } }>("POST", "/__hui/sessions", { cwd: receipt.workspace, ...input })).session,
      createChief: async () => {
        // Never prompt the launcher's shared seeded chief: its real usage otherwise leaks into later tests.
        const group = `E2E ${randomUUID()}`;
        await api("POST", "/__hui/session-groups", { name: group });
        const { bot } = await api<{ bot: { id: string; name: string; sessionId: string; group: string } }>(
          "POST", "/__hui/staff/chiefs", { group, cwd: receipt.workspace },
        );
        expect(existingBots.has(bot.id)).toBe(false);
        return bot;
      },
      prompt,
      world: async (name) => {
        const world = await startWorld(name);
        worlds.push(world);
        return world;
      },
      /** Prompts for one held tool call and answers with the release, once the tool is running. */
      holdTool: async (session, name, input) => {
        const call = Buffer.from(JSON.stringify({ name, input: input ?? {} })).toString("base64url");
        await prompt(session, `E2E_HOLD:${call}`);
        // The provider registers a held response only once a tool is actually waiting, so this resolves when the call is
        // in flight and names the tool when nothing answers it.
        const waiting = await fetch(`${receipt.providerUrl}/control/wait-replay-ready`, { signal: AbortSignal.timeout(60_000) })
          .catch(() => undefined);
        if (!waiting?.ok) throw new Error(`hui.holdTool: ${name} never started: only a tool the fixture's disposable extension registers as holdable (fixture_echo, read_file, apply_patch, git_status) or the shell's own bash waits on the control endpoint`);
        return { release: () => control("POST", "/control/release-replay") };
      },
      openSubagent: async ({ title }) => {
        // Run status holds each child as `Open subagent <title>`. An all-success batch folds the section, and a batch
        // over six folds its rows under Child details; open whichever disclosure hides the row. A phone shows the same
        // popover, so no target branches here.
        const trigger = fixtures.screen.getByTestId("run-status-trigger");
        const popover = fixtures.screen.getByLabel("Run status");
        if (!(await popover.isVisible())) {
          await expect(trigger).toBeVisible();
          await trigger.tap();
        }
        const helpers = popover.getByRole("region", { name: "Helpers" });
        const row = helpers.getByLabel(new RegExp(`^Open subagent ${escapeRegExp(title)}`, "u"));
        if (!(await row.isVisible())) {
          const children = helpers.getByText(/^Child details/u);
          if (await children.count()) await children.tap();
        }
        if (!(await row.isVisible())) {
          const completed = helpers.getByText(/^\d+ completed$/u);
          if (await completed.count()) await completed.tap();
        }
        await expect(row).toBeVisible();
        await row.tap();
      },
      createSubagent: async (parent) => {
        await prompt(parent, "E2E_SUBAGENTS_START");
        let child: ListedSession | undefined;
        await expect.poll(async () => {
          const all = await sessions();
          child = all.find((session) => session.parentId === parent.id);
          return child?.status === "idle" && child.subagent?.status === "completed" && child.subagent.completionDelivery !== "pending"
            && all.find((session) => session.id === parent.id)?.status === "idle";
        }, { timeout: 30_000 }).toBe(true);
        return { id: child!.id, title: child!.title };
      },
      provider: {
        url: receipt.providerUrl,
        held: () => control("GET", "/control/wait-replay-ready"),
        release: () => control("POST", "/control/release-replay"),
      },
      gatewayStub: async (name) => {
        const stub = await startGatewayStub(name);
        gatewayStubs.push(stub);
        if (onPhone(fixtures.app.baseUrl)) forwardPhoneGateway(stub.url);
        return stub;
      },
      restartGateway: async () => {
        const stopped = receipt.serverPid;
        process.kill(receipt.runnerPid, "SIGUSR2");
        await expect.poll(async () => (receipt.serverPid = (await readReceipt()).serverPid) !== stopped, { timeout: 60_000 }).toBe(true);
      },
      exitRuntimes: async () => {
        execFileSync("pkill", ["-P", String(receipt.serverPid), "-f", "pi-sdk-worker"]);
      },
      repository: async () => {
        const path = await realpath(await mkdtemp(join(tmpdir(), "hui-e2e-repo-")));
        directories.push(path);
        const git = (...args: string[]) => execFileSync("git", ["-C", path, "-c", "user.name=e2e", "-c", "user.email=e2e@example.com",
          "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { encoding: "utf8" }).trim();
        git("init", "--quiet", "--initial-branch=main");
        await mkdir(join(path, "sub"));
        await writeFile(join(path, "sub", "keep.txt"), "sub\n");
        git("add", ".");
        git("commit", "--quiet", "-m", "main");
        git("switch", "--quiet", "-c", "release/1.0");
        git("commit", "--quiet", "--allow-empty", "-m", "release");
        git("switch", "--quiet", "-c", "feature/current", "main");
        git("commit", "--quiet", "--allow-empty", "-m", "feature");
        return { path, git };
      },
    });
    } finally {
      try {
        nativeDisplay?.restore();
      } finally {

    // A test that failed while offline must not leave the fixture unreachable.
    await network("online");
    await control("POST", "/control/release-replay");
    try {
      for (const id of await taskIds()) {
        if (!existingTasks.has(id)) await api("DELETE", `/__hui/automation/tasks/${id}`);
      }
    } finally {
      if (automationFrozen) await automationClockControl("resume");
    }
    for (const id of await botIds()) {
      if (!existingBots.has(id)) await api("DELETE", `/__hui/bots/${id}?permanent=1`);
    }
    for (const id of await backlogTaskIds()) {
      if (!existingBacklogTasks.has(id)) await api("DELETE", `/__hui/backlog/items/${encodeURIComponent(id)}`);
    }
    for (const id of await sessionIds()) {
      if (existing.has(id)) continue;
      const response = await fetch(`${receipt.url}/__hui/sessions/${id}`, { method: "DELETE", headers: { "x-hui": "1" } });
      if (!response.ok && response.status !== 404) throw new Error(`DELETE /__hui/sessions/${id} answered ${response.status}`);
    }
    for (const id of await workerIds()) {
      if (!existingWorkers.has(id)) await api("DELETE", `/__hui/workers/${id}`);
    }
    for (const stub of gatewayStubs) await stub.stop();
    // A worker host is a daemon by design; stop the ones this test started.
    for (const home of workerHomes) {
      try { execFileSync("pkill", ["-f", home]); } catch { /* already gone */ }
    }
    for (const { label } of await groups()) {
      if (!existingGroups.has(label)) await api("DELETE", `/__hui/session-groups/${encodeURIComponent(label)}`);
    }
    await api("PUT", "/__hui/settings", settings);
    for (const path of directories) await rm(path, { recursive: true, force: true });
    // A world is another gateway and its own fake services: stop each one the test started, gateway and all.
    for (const world of worlds.reverse()) await world.stop();
      }
    }
  },
  });
}

export const test = huiTest(false);
/** Real service-worker installation and offline recovery, never the intercepted online test mode. */
export const offlineTest = huiTest(true);
