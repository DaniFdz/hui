/**
 * HUI's fixture for the shared e2e suite: the disposable gateway each target runs against (restartable against the same
 * state and port), setup and cleanup through its API, the deterministic provider's address and barriers, gateway
 * requests a test holds, rejects, answers or delivers while dropping the answer, disposable Git repositories, cleanup
 * of the backlog tasks a test created, searches of the gateway's state and secret directories, and every step whose
 * gesture or reading would differ per platform, kept in one table per target that the web fills: opening, reloading
 * and clearing the app, taps, holds, drags held mid-way, context menus, a message's actions (a hover reveals its
 * footer), switches (a Web Awesome switch draws its track over its input, so the web taps the point), attachments,
 * sideways scrolling, downloads, the clipboard, the Work pane's launcher (the + menu writes each shortcut on its entry
 * and opens the pane beside the chat), a Files row's delete, the phone screen's size, the session list (on the drawer
 * layout, the shell's drawer media, the navigation drawer), the Settings page list (the drawer on a phone), the app's
 * chrome outside Settings (the primary navigation), the chosen button of a group (aria-pressed), the app's and the
 * device's colour scheme, the session menu, status glyphs, how a piece of the screen looks, the window's size, Back and
 * Forward, sideways overflow, whether a tap reaches a control and the command palette's chord. The web page never
 * opens Vite's development socket, whose client reloads the page when the gateway restarts, which no installed gateway
 * does. Test files import `test` from here, never from `e2e`, and never read `platform`, `device` or `browser`
 * themselves.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Locator, type Screen } from "e2e";
import type { Browser, WebRoute } from "@e2e-dev/web";
import { addWorkerOnThisMachine } from "./worker.ts";
import { clearAppStorage, onPhone } from "./phone.ts";
import { IPHONE_SCREEN, onWebKitPhone } from "./phone-webkit.ts";

type Receipt = { url: string; providerUrl: string; workspace: string; huiConfig: string; receipt: string; serverPid: number; runnerPid: number };
type Rgb = [number, number, number];
type SessionList = { groups: { label: string; sessions: ListedSession[] }[] };
type ListedSession = { id: string; title: string; status: string; parentId?: string; runtime?: { active: true }; subagent?: { status: string; completionDelivery?: string } };
type Intercepted = {
  arrived(): Promise<void>;
  deliver(): Promise<void>;
  reject(status: number, error: string): Promise<void>;
  answer(json: string): Promise<void>;
  deliverAndDrop(): Promise<void>;
};

export type Hui = {
  workspace: string;
  /** The gateway's own config directory, where its settings and tool icons live. */
  configDir: string;
  gateway: string;
  api<T>(method: string, path: string, body?: unknown): Promise<T>;
  createSession(input: { title: string; tool?: "pi"; group?: string; cwd?: string; model?: string }): Promise<{ id: string }>;
  createSubagent(parent: { id: string }): Promise<{ id: string; title: string }>;
  prompt(session: { id: string }, text: string): Promise<void>;
  provider: { url: string; held(): Promise<void>; release(): Promise<void> };
  network(mode: "online" | "offline" | "silent"): Promise<void>;
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
  pressed(within: Screen | Locator, name: string, on?: boolean): Locator;
  look(target: Locator): Promise<{ color: Rgb; background: Rgb; opacity: number; fonts: string[]; loaded: string[]; size: number; weight: number; align: string; ring: Rgb | null }>;
  overflowX(): Promise<number>;
  deviceAppearance(scheme: "light" | "dark"): Promise<void>;
  newSessionDraft(): Promise<string>;
  attach(target: Locator, files: (string | { name: string; bytes: number })[]): Promise<void>;
  download(target: Locator): Promise<{ name: string; text: string }>;
  /** A worker on this machine: its own home, this checkout pre-installed as its release. */
  addWorker(name: string): Promise<{ id: string; home: string }>;
  /** Records, from now on, the text the page copies to the clipboard. */
  clipboardSpy(): Promise<void>;
  clipboardWrites(): Promise<string[]>;
  hold(target: Locator, until: Locator): Promise<void>;
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
type PlatformSteps = Omit<Hui, "workspace" | "configDir" | "gateway" | "api" | "createSession" | "prompt" | "createSubagent" | "provider" | "restartGateway" | "exitRuntimes" | "repository">;

/** A tap at the middle of where a target is at the moment of the press. */
const tapAt = async (target: Locator) => {
  const box = await target.boundingBox();
  if (!box) throw new Error("tapAt: the target is not on screen");
  await target.tap({ position: { x: box.width / 2, y: box.height / 2 } });
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
  const at = (clientY: number) => new Touch({ identifier: 1, target, clientX: x, clientY, screenX: x, screenY: clientY });
  const fire = (type: string, moving: Touch[], ended: Touch[]) => target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches: moving, changedTouches: ended, targetTouches: moving }));
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

export const test = base.extend<{ hui: Hui }>({
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
    const botIds = async () => (await api<{ bots: { id: string }[] }>("GET", "/__hui/bots")).bots.map((bot) => bot.id);
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
    const settings = await api<unknown>("GET", "/__hui/settings");
    const directories: string[] = [];

    const webSteps: PlatformSteps = {
      open: (path) => fixtures.app.open(path),
      reload: () => browser().reload(),
      clearState: () => fixtures.app.clearState(),
      url: () => browser().url(),
      clipboard: ({ refuse = false, legacyCopy = false } = {}) => browser().addInitScript(({ refused, legacy }: { refused: boolean; legacy: boolean }) => {
        const page = window as unknown as { huiCopied: string };
        page.huiCopied = "";
        navigator.clipboard.writeText = async (text) => {
          if (refused) throw new DOMException("Clipboard write refused", "NotAllowedError");
          page.huiCopied = text;
        };
        navigator.clipboard.write = async (items) => {
          if (refused) throw new DOMException("Clipboard write refused", "NotAllowedError");
          const blobs = await Promise.all(items.flatMap((item) => item.types.map((type) => item.getType(type))));
          const sizes = await Promise.all(blobs.map(async (blob) => blob.type === "image/png" ? createImageBitmap(blob).then((bitmap) => ` ${bitmap.width}x${bitmap.height}`, () => "") : ""));
          page.huiCopied = blobs.map((blob, index) => `${blob.type}${sizes[index]}`).join(",");
        };
        if (refused) {
          document.execCommand = ((command: string) => {
            if (command === "copy" && legacy) {
              const active = document.activeElement;
              page.huiCopied = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
                ? active.value
                : String(document.getSelection() ?? "");
            }
            return legacy;
          }) as typeof document.execCommand;
        }
      }, { refused: refuse, legacy: legacyCopy }),
      copied: () => browser().evaluate(() => (window as unknown as { huiCopied?: string }).huiCopied ?? ""),
      keyboard: { down: (key) => browser().keyboard.down(key), up: (key) => browser().keyboard.up(key) },
      type: (text) => browser().keyboard.type(text),
      phoneScreen: async (orientation = "portrait") => {
        const phone = orientation === "portrait" ? { width: 390, height: 844 } : { width: 844, height: 390 };
        await browser().setViewport(phone);
        return phone;
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
      offlineFilesReady: () => browser().evaluate(async () => {
        if (!("serviceWorker" in navigator)) return false;
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.active?.state === "activated";
      }),
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
        if (phone && await fixtures.screen.getByRole("button", "Close navigation", { visible: true }).count() === 0) {
          await fixtures.screen.getByRole("button", "Open navigation", { visible: true }).tap();
          // A row is tappable only once a drawer has taken the screen. A split renders one per pane, so wait for
          // any of them instead of making a two-match locator an error.
          await expect.poll(() => fixtures.screen.getByRole("button", "Close navigation", { visible: true }).count()).toBeGreaterThan(0);
        }
      },
      settingsPages: async () => {
        const close = fixtures.screen.getByRole("button", "Close settings navigation", { visible: true });
        const open = fixtures.screen.getByRole("button", "Open settings navigation", { visible: true });
        if (await close.count() === 0 && await open.count() > 0) await open.tap();
      },
      sessionMenu: async (title) => {
        const row = fixtures.screen.getByTestId("session-row").filter({ hasText: title });
        await row.hover();
        await row.getByRole("button", `Actions for ${title}`).tap();
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
      appChrome: () => fixtures.screen.getByLabel("Primary navigation"),
      deviceAppearance: (scheme) => browser().emulateMedia({ colorScheme: scheme }),
      look: async (target) => {
        await target.scrollIntoView();
        const box = await target.boundingBox();
        if (!box) throw new Error("look: the target lays out no box");
        return browser().evaluate(({ x, y, width, height }) => {
          const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
          const element = document.elementsFromPoint(x + width / 2, y + height / 2).find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            return same(rect.x, x) && same(rect.y, y) && same(rect.width, width) && same(rect.height, height);
          });
          if (!element) throw new Error("look: no element has the target's box");
          const rgb = (color: string) => {
            const channels = /^(?:rgba?\(|color\(srgb )([\d.e-]+),? ([\d.e-]+),? ([\d.e-]+)/u.exec(color);
            if (!channels) throw new Error(`look: ${color} is not an sRGB colour`);
            const scale = color.startsWith("color(") ? 255 : 1;
            return channels.slice(1).map((value) => Math.round(Number(value) * scale)) as [number, number, number];
          };
          let behind: Element | null = element;
          while (behind && /^rgba\(.*, 0\)$|^color\(.* \/ 0\)$|^transparent$/u.test(getComputedStyle(behind).backgroundColor)) behind = behind.parentElement;
          if (!behind) throw new Error("look: nothing opaque is behind the target");
          const style = getComputedStyle(element);
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
          const fonts = style.fontFamily.split(",").map((family) => family.trim().replace(/^"(.*)"$/u, "$1"));
          const faces = [...document.fonts];
          const outerShadow = style.boxShadow.split(/,(?![^(]*\))/u).at(-1)!.trim();
          return {
            color: rgb(style.color),
            background: rgb(getComputedStyle(behind).backgroundColor),
            opacity,
            fonts,
            loaded: fonts.filter((family) => faces.some((face) => face.family === family && face.status === "loaded")
              && document.fonts.check(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} "${family}"`, element.textContent ?? "")),
            size: Number.parseFloat(style.fontSize),
            weight: Number(style.fontWeight),
            align: style.textAlign,
            ring: !element.matches(":focus-visible") ? null
              : style.outlineStyle !== "none" ? rgb(style.outlineColor)
              : outerShadow === "none" ? null : rgb(outerShadow),
          };
        }, box);
      },
      attach: async (target, files) => {
        const made = files.some((file) => typeof file !== "string") ? await mkdtemp(join(tmpdir(), "hui-e2e-files-")) : "";
        if (made) directories.push(made);
        await target.setInputFiles(await Promise.all(files.map(async (file) => {
          if (typeof file === "string") return fileURLToPath(new URL(`files/${file}`, import.meta.url));
          await writeFile(join(made, file.name), Buffer.alloc(file.bytes, "x"));
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
      messageActions: (target) => target.hover(),
      openWorkView: async (name) => {
        await browser().setViewport({ width: 1440, height: 900 });
        await fixtures.screen.getByRole("button", "Show Work pane").tap();
        await fixtures.screen.getByRole("button", "Open Work view").tap();
        await fixtures.screen.getByRole("menuitem").filter({ hasText: name }).tap();
      },
      deleteEntry: async (within, name) => {
        await within.getByRole("button", `Delete ${name}`).tap();
      },
      scrollTo: (_within, target) => target.scrollIntoView(),
      expectLinkTo: (within, name, href) => expect(within.getByRole("link", name)).toHaveAttribute("href", href),
      textOf: async (target) => (await target.textContent()) ?? "",
      stepState: (step, state) => expect(step).toHaveAttribute("data-status", state),
      tapAt,
      scrollSideways: async (target) => {
        const box = await target.boundingBox();
        if (!box) throw new Error("scrollSideways: the target is not on screen");
        await browser().mouse.move(box.x + Math.min(24, box.width / 2), box.y + box.height / 2);
        await browser().mouse.wheel(240, 0);
      },
      wheel: async (target, deltaY) => {
        const box = await target.boundingBox();
        if (!box) throw new Error("wheel: the target is not on screen");
        await browser().mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await browser().mouse.wheel(0, deltaY);
      },
      stored: async (text) => {
        const root = dirname(receipt.workspace);
        const files = (await readdir(root, { recursive: true, withFileTypes: true }))
          .filter((entry) => entry.isFile())
          .map((entry) => relative(root, join(entry.parentPath, entry.name)))
          .filter((file) => !file.startsWith("vite-cache/"));
        const read = (file: string) => readFile(join(root, file), "latin1").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? "" : Promise.reject(error));
        const holding = await Promise.all(files.map(async (file) => ((await read(file)).includes(text) ? [file] : [])));
        return holding.flat();
      },
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
        await browser().route(path, (route) => (route.request.method === method ? hold(route) : route.fallback()));
        const decide = (handle: (route: WebRoute) => Promise<void>) => settle(handle).then(() => browser().unroute(path));
        return {
          arrived: () => arrival,
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
    const noBrowserHarness = (step: string): never => {
      throw new Error(`hui.${step}() needs Playwright's own browser: the android target rides the app's WebView over CDP, which has one page and no context, so a route, an init script or a fresh context cannot be installed there`);
    };
    const desktopOnly = (step: string) => (): never => {
      throw new Error(`hui.${step}() needs a desktop: the webkit-phone target is a phone at ${IPHONE_SCREEN.width}x${IPHONE_SCREEN.height} with touch and no hover, so this step would prove the desktop's behaviour on a phone instead of failing where the phone cannot show it`);
    };
    const steps: PlatformSteps = onWebKitPhone(fixtures.app.baseUrl)
      ? {
          ...web,
          wideScreen: desktopOnly("wideScreen"),
          peek: desktopOnly("peek"),
          messageActions: desktopOnly("messageActions"),
          openWorkView: desktopOnly("openWorkView"),
        }
      : onPhone(fixtures.app.baseUrl)
        ? {
            ...web,
            // The phone target rides the app's own WebView over CDP: the browser-only harness steps below reach for a
            // Playwright init script, a request interception or a live context the WebView refuses, and they failed with
            // "Cannot read properties of undefined (reading 'triggerEvent')" before anyone could read the reason. They
            // refuse here instead, so a test that needs one fails where the phone cannot do it.
            clearOffline: noBrowserHarness("clearOffline"),
            holdAppChunks: noBrowserHarness("holdAppChunks"),
            spoofUserAgent: noBrowserHarness("spoofUserAgent"),
            answerAll: noBrowserHarness("answerAll"),
            wideScreen: noBrowserHarness("wideScreen"),
            peek: noBrowserHarness("peek"),
            messageActions: noBrowserHarness("messageActions"),
            openWorkView: noBrowserHarness("openWorkView"),
            clearState: async () => {
              await fixtures.app.open("/");
              await browser().evaluate(clearAppStorage);
              await browser().reload();
            },
          }
        : web;
    if (fixtures.platform === "web") await browser().addInitScript(trackSockets);
    await steps.clearState();

    await use({
      ...steps,
      workspace: receipt.workspace,
      configDir: receipt.huiConfig,
      gateway: receipt.url,
      api,
      createSession: async (input) =>
        (await api<{ session: { id: string } }>("POST", "/__hui/sessions", { cwd: receipt.workspace, ...input })).session,
      prompt,
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

    // A test that failed while offline must not leave the fixture unreachable.
    await network("online");
    await control("POST", "/control/release-replay");
    for (const id of await taskIds()) {
      if (!existingTasks.has(id)) await api("DELETE", `/__hui/automation/tasks/${id}`);
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
    // A worker host is a daemon by design; stop the ones this test started.
    for (const home of workerHomes) {
      try { execFileSync("pkill", ["-f", home]); } catch { /* already gone */ }
    }
    for (const { label } of await groups()) {
      if (!existingGroups.has(label)) await api("DELETE", `/__hui/session-groups/${encodeURIComponent(label)}`);
    }
    await api("PUT", "/__hui/settings", settings);
    for (const path of directories) await rm(path, { recursive: true, force: true });
  },
});
