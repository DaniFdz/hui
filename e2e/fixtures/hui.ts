/**
 * HUI's fixture for the shared e2e suite: the disposable gateway each target runs against (restartable against the same
 * state and port), setup and cleanup through its API, the deterministic provider's address and barriers, gateway
 * requests a test holds, rejects, answers or delivers while dropping the answer, disposable Git repositories, cleanup
 * of the backlog tasks a test created, searches of the gateway's state and secret directories, and every step whose
 * gesture or reading differs per platform: taps, holds, drags held mid-way, context menus, a message's actions (on the
 * web a hover reveals its footer, on iOS its long press), switches (a Web Awesome
 * switch draws its track over its input, so the web taps the point), attachments, sideways scrolling, downloads, the
 * clipboard, the Work pane's launcher (the web's + menu writes each shortcut on its entry and opens the pane beside the
 * chat; on iOS the pane opens over it and names the view alone), a Files row's delete (a button on the web, the row's
 * menu on iOS), the phone screen's size (on iOS the app's own), the session list (on the web's drawer layout, the
 * shell's drawer media, the navigation drawer; on iOS, Back), the Settings page list (the drawer on a phone, on iOS
 * its sheet), the app's chrome outside Settings (the web's primary navigation, on iOS the app's own screen), the
 * chosen button of a group (aria-pressed; on iOS the selected trait), the app's colour scheme (on iOS read from a
 * screenshot) and the device's (on iOS set through `simctl ui` and restored after the test), the session menu (on iOS
 * the open chat's toolbar menu, else a long press on the row), status glyphs (on iOS the row's session-glyph label and whether it is a spinner), how
 * a piece of the screen looks (on iOS its colours from a screenshot and its type from the value the app's typeface
 * reports), and on the web the window's size, Back and Forward, sideways overflow, whether a tap reaches a control
 * and the command palette's chord. The web page never opens Vite's development socket, whose client reloads the page
 * when the gateway restarts, which no installed gateway does. On iOS it relaunches the app pointed at a proxy in front
 * of the gateway, which holds the requests a test intercepts and passes everything else through, WebSocket upgrades
 * included, with the app's own `Origin` and `Host`; it follows `hui://open` links, reads the address the app shows
 * from its app-route marker, scrolls a container by swiping it once (which puts a screen's keyboard away, so a row it
 * clipped can be read) and then until the target is on screen (the device reports only
 * on-screen nodes), and checks a link's address through its accessibility identifier, which the platform sets to the
 * link's URL; each test starts by deleting only the app's preferences through `defaults`, and
 * `clearState` deletes them too before the engine empties the data container, because `cfprefsd` would otherwise hand
 * the relaunched app the deleted values; it reads a container's text as its texts and labels in order, since a device
 * reports no text for a container, and what the app copied from the simulator's pasteboard; steps only the web has
 * throw there. Test files import `test` from here, never from `e2e`, and never read `platform`, `device` or `browser`
 * themselves.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Locator, type Screen } from "e2e";
import type { Device } from "@e2e-dev/mobile";
import type { Browser, WebRoute } from "@e2e-dev/web";
import { IOS_DEVICE, IOS_PORT } from "../../e2e.config.ts";
import { navigationPath, resolveNavigation } from "../../src/lib/navigation.ts";

const MAX_SCROLL_SWIPES = 20;

type Receipt = { url: string; providerUrl: string; workspace: string; serverPid: number; runnerPid: number };
type Rgb = [number, number, number];
type SessionList = { groups: { label: string; sessions: ListedSession[] }[] };
type ListedSession = { id: string; title: string; status: string; parentId?: string; runtime?: { active: true }; subagent?: { status: string; completionDelivery?: string } };
type GatewayRequest = { incoming: IncomingMessage; body: Buffer; response: ServerResponse };
type Intercepted = {
  arrived(): Promise<void>;
  deliver(): Promise<void>;
  reject(status: number, error: string): Promise<void>;
  answer(json: string): Promise<void>;
  deliverAndDrop(): Promise<void>;
};

export type Hui = {
  workspace: string;
  gateway: string;
  api<T>(method: string, path: string, body?: unknown): Promise<T>;
  createSession(input: { title: string; tool?: "pi"; group?: string; cwd?: string; model?: string }): Promise<{ id: string }>;
  createSubagent(parent: { id: string }): Promise<{ id: string; title: string }>;
  prompt(session: { id: string }, text: string): Promise<void>;
  provider: { url: string; held(): Promise<void>; release(): Promise<void> };
  restartGateway(): Promise<void>;
  exitRuntimes(): Promise<void>;
  dropStreams(): Promise<void>;
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
  sessionMenu(title: string): Promise<Pick<Locator, "getByText">>;
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
  hold(target: Locator, until: Locator): Promise<void>;
  textOf(target: Locator): Promise<string>;
  /** A task progress step's state: the web's `data-status`, and on the phone the row's accessibility value. */
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
   * shortcut on each entry and opens the pane beside the chat; the phone's opens it over the chat and names the
   * view alone. */
  openWorkView(name: string): Promise<void>;
  /** Asks to delete a named file or folder row of a Files navigator, which the phone keeps in the row's menu. */
  deleteEntry(within: Locator, name: string): Promise<void>;
  flip(target: Locator): Promise<void>;
  intercept(method: string, path: RegExp): Promise<Intercepted>;
  repository(): Promise<{ path: string; git(...args: string[]): string }>;
  stored(text: string): Promise<string[]>;
  secretDirectories(): Promise<string[]>;
};

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

const gatewayProxy = async (gateway: string) => {
  const upstream = new URL(gateway);
  const holds = new Set<{ method: string; path: RegExp; hold(route: GatewayRequest): Promise<void> }>();
  const upgraded = new Set<Socket>();
  const forward = ({ incoming, body, response }: GatewayRequest) => new Promise<void>((resolve, reject) => {
    const outgoing = request({ host: upstream.hostname, port: upstream.port, method: incoming.method, path: incoming.url, headers: incoming.headers }, (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.on("error", () => response.destroy()).pipe(response);
      resolve();
    });
    outgoing.on("error", reject);
    response.on("close", () => outgoing.destroy());
    outgoing.end(body);
  });
  const server = createServer(async (incoming, response) => {
    try {
      const route = { incoming, body: Buffer.concat(await incoming.toArray()), response };
      const href = new URL(incoming.url ?? "/", gateway).href;
      const held = [...holds].find((hold) => hold.method === incoming.method && hold.path.test(href));
      await (held ? held.hold(route) : forward(route));
    } catch {
      response.destroy();
    }
  });
  server.on("upgrade", (incoming: IncomingMessage, socket: Socket, head: Buffer) => {
    const target = connect(Number(upstream.port), upstream.hostname, () => {
      const headers = incoming.rawHeaders.flatMap((value, index) => (index % 2 ? [] : [`${value}: ${incoming.rawHeaders[index + 1]}`]));
      target.write([`${incoming.method} ${incoming.url} HTTP/1.1`, ...headers, "", ""].join("\r\n"));
      target.write(head);
      socket.pipe(target).pipe(socket);
    });
    const close = () => {
      socket.destroy();
      target.destroy();
    };
    for (const end of [socket, target]) {
      upgraded.add(end);
      end.on("error", close).on("close", () => {
        upgraded.delete(end);
        close();
      });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    intercept: (method: string, path: RegExp): Intercepted => {
      const { arrival, hold, settle } = holding<GatewayRequest>();
      const held = { method, path, hold };
      holds.add(held);
      const decide = (handle: (route: GatewayRequest) => Promise<void>) => settle(handle).finally(() => holds.delete(held));
      const answer = (status: number, json: string) => decide(async ({ response }) => {
        response.writeHead(status, { "content-type": "application/json" }).end(json);
      });
      return {
        arrived: () => arrival,
        deliver: () => decide(forward),
        reject: (status, error) => answer(status, JSON.stringify({ error })),
        answer: (json) => answer(200, json),
        deliverAndDrop: () => decide(async ({ incoming, body, response }) => {
          await deliverBehind(method, new URL(incoming.url ?? "/", gateway).href, body.toString() || undefined);
          response.destroy();
        }),
      };
    },
    dropStreams: () => {
      for (const socket of upgraded) socket.destroy();
    },
    close: async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      for (const socket of upgraded) socket.destroy();
      await closed;
    },
  };
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
    const web = fixtures.platform === "web";
    const port = web ? new URL(fixtures.app.baseUrl!).port : IOS_PORT;
    const file = new URL(`../../.e2e/hui/receipt-${port}.json`, import.meta.url);
    await expect.poll(() => readFile(file).then(() => true, () => false), { timeout: 60_000 }).toBe(true);
    const readReceipt = async () => JSON.parse(await readFile(file, "utf8")) as Receipt;
    const receipt = await readReceipt();

    const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const response = await fetch(receipt.url + path, {
        method,
        headers: { "x-hui": "1", "content-type": "application/json" },
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
    // Archived bots too: leaving one behind keeps its chat, and the session cleanup then refuses to delete it.
    const botIds = async () => {
      const listed = [...(await api<{ bots: { id: string }[] }>("GET", "/__hui/bots")).bots, ...(await api<{ bots: { id: string }[] }>("GET", "/__hui/bots?archived=1")).bots];
      return [...new Set(listed.map((bot) => bot.id))];
    };
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
    const device = () => (fixtures as unknown as { device: Device }).device;
    const proxy = web ? undefined : await gatewayProxy(receipt.url);
    try {
      const launch = () => device().openApp("dev.hui.ios", { relaunch: true, launchArguments: ["-HUIGatewayURL", proxy!.url, "-HUILooks", "YES"] });
      const forgetPreferences = async () => {
        await device().closeApp();
        const container = execFileSync("xcrun", ["simctl", "get_app_container", IOS_DEVICE, "dev.hui.ios", "data"], { encoding: "utf8" }).trim();
        const forget = spawnSync("xcrun", ["simctl", "spawn", IOS_DEVICE, "defaults", "delete", join(container, "Library/Preferences/dev.hui.ios")], { encoding: "utf8" });
        if (forget.status !== 0 && !forget.stderr.includes("not found")) throw new Error(`defaults delete dev.hui.ios answered ${forget.status}: ${forget.stderr}`);
      };
      const clearState = async () => {
        if (!web) await forgetPreferences();
        await fixtures.app.clearState();
      };
      const notOnIos = (step: string) => () => {
        throw new Error(`hui.${step} is not on iOS yet; keep the test on platforms: ['web']`);
      };

      const existing = new Set(await sessionIds());
      const existingGroups = new Set((await groups()).map((group) => group.label));
      const existingTasks = new Set(await taskIds());
      const existingBots = new Set(await botIds());
      const existingBacklogTasks = new Set(await backlogTaskIds());
      const settings = await api<unknown>("GET", "/__hui/settings");
      if (web) await browser().addInitScript(trackSockets);
      if (web) await clearState();
      else {
        await forgetPreferences();
        await launch();
      }
      const directories: string[] = [];

      const webSteps: Omit<Hui, "workspace" | "gateway" | "api" | "createSession" | "prompt" | "createSubagent" | "provider" | "restartGateway" | "exitRuntimes" | "open" | "reload" | "clearState" | "repository"> = {
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
          if (refused) document.execCommand = () => legacy;
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
        sessionList: async () => {
          const phone = await browser().evaluate(() => matchMedia("(max-width: 900px), (max-width: 932px) and (max-height: 500px) and (orientation: landscape)").matches);
          if (phone && await fixtures.screen.getByRole("button", "Close navigation", { visible: true }).count() === 0) {
            await fixtures.screen.getByRole("button", "Open navigation", { visible: true }).tap();
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
        flip: async (target) => {
          const box = await target.boundingBox();
          if (!box) throw new Error("flip: the switch is not on screen");
          await target.tap({ position: { x: box.width / 2, y: box.height / 2 } });
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

      let appArea: { x: number; y: number; width: number; height: number } | undefined;
      const screenshot = async () => {
        const marker = fixtures.screen.getByTestId("app-route");
        if (await marker.count() > 0) appArea = await marker.boundingBox() ?? appArea;
        const route = appArea;
        if (!route) throw new Error("screenshot: the app shows no screen");
        const shot = join(await mkdtemp(join(tmpdir(), "hui-e2e-shot-")), "screen.bmp");
        directories.push(dirname(shot));
        execFileSync("xcrun", ["simctl", "io", IOS_DEVICE, "screenshot", "--type=bmp", shot], { stdio: "ignore" });
        const bmp = await readFile(shot);
        const width = bmp.readInt32LE(18), height = Math.abs(bmp.readInt32LE(22)), bytes = bmp.readUInt16LE(28) / 8;
        const scale = width / (route.x + route.width);
        const pixel = (x: number, y: number): Rgb => {
          const top = Math.min(height - 1, Math.floor(y * scale));
          const row = bmp.readInt32LE(22) > 0 ? height - 1 - top : top;
          const at = bmp.readUInt32LE(10) + row * Math.ceil((width * bytes) / 4) * 4 + Math.min(width - 1, Math.floor(x * scale)) * bytes;
          return [bmp[at + 2]!, bmp[at + 1]!, bmp[at]!];
        };
        return { scale, pixel };
      };
      const deviceScheme = () => execFileSync("xcrun", ["simctl", "ui", IOS_DEVICE, "appearance"], { encoding: "utf8" }).trim();
      const startScheme = web ? "" : deviceScheme();
      const appChrome = () => fixtures.screen.getByTestId("app-route");
      const onScreen = async (within: Locator, target: Locator) => {
        const box = await target.count() > 0 ? await target.boundingBox() : null;
        if (!box) return false;
        const area = await within.count() > 0 ? await within.boundingBox() : appArea;
        if (!area) return false;
        const middle = box.y + box.height / 2;
        return middle >= area.y && middle <= area.y + area.height;
      };
      const iosSteps: Partial<typeof webSteps> = {
        pressed: (within, name, on = true) => within.getByRole("button", { name, selected: on }),
        deviceAppearance: async (scheme) => {
          execFileSync("xcrun", ["simctl", "ui", IOS_DEVICE, "appearance", scheme]);
          await expect.poll(() => fixtures.screen.getByTestId("app-route").inputValue(), { timeout: 60_000 }).not.toBe("");
        },
        appearance: async () => {
          const box = await fixtures.screen.getByTestId("app-route").boundingBox();
          if (!box) throw new Error("appearance: the app shows no screen");
          const [r, g, b] = (await screenshot()).pixel(box.x + 2, box.y + box.height / 2);
          return (r + g + b) / 3 < 128 ? "dark" : "light";
        },
        look: async (target) => {
          if (!await onScreen(appChrome(), target)) await iosSteps.scrollTo!(appChrome(), target);
          const box = await target.boundingBox();
          if (!box) throw new Error("look: the target lays out no box");
          const shot = await screenshot();
          const counts = new Map<string, number>();
          for (let y = box.y; y < box.y + box.height; y += 1 / shot.scale) {
            for (let x = box.x; x < box.x + box.width; x += 1 / shot.scale) {
              const key = shot.pixel(x, y).join(",");
              counts.set(key, (counts.get(key) ?? 0) + 1);
            }
          }
          const inside = [...counts].sort((a, b) => b[1] - a[1]).map(([key]) => key.split(",").map(Number) as Rgb);
          const background = inside[0]!;
          const distance = (rgb: Rgb) => Math.max(...rgb.map((channel, index) => Math.abs(channel - background[index]!)));
          const farthest = Math.max(...inside.map(distance));
          const color = inside.find((rgb) => farthest > 0 && distance(rgb) >= farthest / 2) ?? background;
          const reading = Object.fromEntries((await target.inputValue()).split(";").map((pair) => pair.split("=") as [string, string]));
          const typed = (field: string) => {
            if (reading[field] === undefined) throw new Error(`look: on iOS the target reports no ${field}; give its Text a typeface`);
            return reading[field];
          };
          const unread = (field: string) => () => { throw new Error(`look: iOS can't read ${field} yet`); };
          return Object.defineProperties({ color, background }, {
            size: { get: () => Number(typed("size")) },
            fonts: { get: () => typed("fonts").split(",") },
            weight: { get: unread("weight") },
            opacity: { get: unread("opacity") },
            loaded: { get: () => typed("loaded").split(",").filter(Boolean) },
            align: { get: unread("align") },
            ring: { get: unread("ring") },
          }) as Awaited<ReturnType<typeof webSteps.look>>;
        },
        stored: webSteps.stored,
        secretDirectories: webSteps.secretDirectories,
        phoneScreen: async (orientation = "portrait") => {
          if (orientation !== "portrait") throw new Error("phoneScreen: the iPhone app runs in portrait");
          const box = await fixtures.screen.getByTestId("app-route").boundingBox();
          if (!box) throw new Error("phoneScreen: the app shows no screen");
          return { width: box.x + box.width, height: box.y + box.height };
        },
        sessionList: async () => {
          for (let address = await iosSteps.url!(); new URL(address).pathname !== "/";) {
            const shown = address;
            await fixtures.screen.getByTestId("BackButton").tap();
            await expect.poll(async () => (address = await iosSteps.url!())).not.toBe(shown);
          }
        },
        sessionMenu: async (title) => {
          const open = (await sessions()).find((session) => session.title === title);
          if (open && (await iosSteps.url!()).endsWith(`/sessions/${encodeURIComponent(open.id)}`)) {
            await fixtures.screen.getByRole("button", `Actions for ${title}`).tap();
          } else {
            await fixtures.screen.getByTestId("session-row").filter({ hasText: title }).getByRole("button", title).longPress();
          }
          return fixtures.screen;
        },
        glyph: async (title) => {
          const row = fixtures.screen.getByTestId("session-row").filter({ hasText: title });
          await expect(row).toHaveCount(1);
          const glyph = row.getByTestId("session-glyph");
          if (await glyph.count() === 0) return { label: "", animated: false };
          return { label: (await glyph.textContent()) ?? "", animated: await row.getByRole("status").count() > 0 };
        },
        appChrome: () => fixtures.screen.getByTestId("app-route"),
        settingsPages: async () => {
          if (await fixtures.screen.getByRole("button", "Close settings navigation").count() > 0) return;
          await fixtures.screen.getByRole("button", "Open settings navigation").tap();
          await expect(fixtures.screen.getByRole("button", "Close settings navigation")).toBeVisible();
        },
        keyboard: { down: notOnIos("keyboard.down"), up: notOnIos("keyboard.up") },
        workChord: notOnIos("workChord"),
        hold: async (target, until) => {
          await target.longPress();
          await expect(until).toBeVisible();
        },
        textOf: async (target) => (await target.getByText(/\S/u).allTextContents()).join(" "),
        stepState: (step, state) => expect.poll(async () => step.inputValue()).toBe(state),
        flip: async (target) => {
          const control = target.getByRole("switch");
          const toggle = await control.count() > 0 ? control.last() : target;
          const area = await fixtures.screen.getByTestId("app-route").boundingBox();
          const box = await toggle.boundingBox();
          // A settings page's saved footer is a safe-area inset the tree doesn't show, so it swallows a press on a row
          // scrolled to the bottom edge; one more swipe lifts the control clear of it.
          if (area && box && box.y + box.height / 2 > area.y + area.height * 0.85) {
            await fixtures.screen.getByTestId("app-route").swipe({ direction: "down", momentum: "slow" });
          }
          await toggle.tap();
        },
        contextMenu: (target) => target.longPress(),
        messageActions: (target) => target.longPress(),
        openWorkView: async (name) => {
          await fixtures.screen.getByRole("button", "Show Work pane").tap();
          await fixtures.screen.getByLabel("Open Work view").tap();
          await fixtures.screen.getByText(name, { exact: true, visible: true }).tap();
        },
        deleteEntry: async (within, name) => {
          await within.getByRole("button", name).longPress();
          await fixtures.screen.getByText(`Delete ${name}`, { exact: true, visible: true }).tap();
        },
        clipboard: async ({ refuse = false } = {}) => {
          if (refuse) notOnIos("clipboard({ refuse: true })")();
          execFileSync("xcrun", ["simctl", "pbcopy", IOS_DEVICE], { input: "" });
        },
        copied: async () => execFileSync("xcrun", ["simctl", "pbpaste", IOS_DEVICE], { encoding: "utf8" }),
        intercept: async (method, path) => proxy!.intercept(method, path),
        dropStreams: async () => proxy!.dropStreams(),
        url: async () => proxy!.url + await fixtures.screen.getByTestId("app-route").inputValue(),
        tapAt,
        scrollTo: async (within, target) => {
          await within.swipe({ direction: "down", momentum: "slow" });
          const bar = within.getByLabel(/^Vertical scroll bar/u).first();
          const shown = async () => [...await within.getByText(/\S/u).allTextContents(), await bar.count() > 0 ? await bar.inputValue() : ""].join("\n");
          for (const direction of ["down", "up"] as const) {
            for (let swipes = 0, before = "", now = await shown(); now !== before && swipes < MAX_SCROLL_SWIPES; swipes++, before = now, now = await shown()) {
              if (await onScreen(within, target)) return;
              await within.swipe({ direction, momentum: "slow" });
            }
          }
          await expect.poll(() => onScreen(within, target)).toBe(true);
        },
        expectLinkTo: async (within, name, href) => {
          if (!name.trim()) throw new Error("expectLinkTo: the link needs a name");
          await expect(within.getByRole("link", name)).toHaveCount(1);
          await expect(within.getByTestId(href).filter({ hasText: name })).toHaveCount(1);
        },
      };

      await use({
        ...(web ? webSteps : Object.fromEntries(Object.keys(webSteps).map((step) => [step, notOnIos(step)])) as unknown as typeof webSteps),
        ...(web ? {} : iosSteps),
        workspace: receipt.workspace,
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
        open: async (path) => {
          if (web) return fixtures.app.open(path);
          await launch();
          await device().openLink(`hui://open?path=${encodeURIComponent(path)}`);
          const { target } = resolveNavigation(new URL(path, receipt.url).pathname);
          const shown = target.kind === "session" || target.kind === "settings" ? navigationPath(target) : target.kind === "page" && target.page.id === "sessions" ? "/sessions" : undefined;
          if (shown) await expect.poll(async () => new URL(await iosSteps.url!()).pathname).toBe(shown);
        },
        reload: () => (web ? browser().reload() : fixtures.app.restart()),
        clearState,
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

      await control("POST", "/control/release-replay");
      if (!web && deviceScheme() !== startScheme) execFileSync("xcrun", ["simctl", "ui", IOS_DEVICE, "appearance", startScheme]);
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
      for (const { label } of await groups()) {
        if (!existingGroups.has(label)) await api("DELETE", `/__hui/session-groups/${encodeURIComponent(label)}`);
      }
      await api("PUT", "/__hui/settings", settings);
      for (const path of directories) await rm(path, { recursive: true, force: true });
    } finally {
      await proxy?.close();
    }
  },
});
