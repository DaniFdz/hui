/**
 * HUI's fixture for the shared e2e suite: the disposable gateway each target runs against, setup and cleanup through
 * its API, the deterministic provider's address and barriers, a gateway request a test holds, then delivers, rejects or
 * delivers while dropping its answer or answers in its place, and the steps whose gesture differs per platform, such as
 * holding a control, opening a context menu, turning a switch (a Web Awesome switch draws its track over its input, so the web taps the
 * point instead of the input), attaching files from `files/` or made up of a name and a size, reading what a download
 * saved or what the page copied, opening a session's menu, reading a sidebar row's status glyph (its tooltip and
 * whether it spins) and whether its unread dot has the accent colour, and reading how a piece of the screen looks (its
 * text colour and the colour behind it as RGB, its font families, those of HUI's bundled faces that have loaded to draw
 * its text, its text size in pixels and the colour of the focus ring it shows when reached from the keyboard), a
 * disposable Git repository (on `feature/current`, with `main`, a `release/1.0` at its own commit and a `sub`
 * directory) that it removes at teardown, the files of the gateway's state and workspace that hold a text, the secret
 * directories the gateway wrote, a restart of the gateway against the same state and port, the end of its PI worker
 * processes, and, on the web, closing the page's WebSockets as a dropped connection would. The web page never opens
 * Vite's development socket, whose client reloads the page when the gateway restarts, which no installed gateway does.
 * On iOS it relaunches the app pointed at the gateway, follows a `hui://open` link instead of loading a page, and
 * clears the app's preferences through `defaults` before the engine empties its data container, because `cfprefsd`
 * would otherwise hand the relaunched app the deleted values; the web-only steps throw. On the web it also goes Back and
 * Forward through the browser's history, sizes the window as a phone held upright or sideways or as the desktop, tells
 * whether the page, its main area or the sidebar overflows sideways and whether a tap at a control's centre reaches it
 * (nothing covers it and it is not inert), and presses the command palette's chord: ⌘K where the page runs on an Apple
 * platform, Ctrl+K elsewhere. Test files import `test` from here, never from `e2e`, and never read `platform`, `device`
 * or `browser` themselves.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Locator } from "e2e";
import type { Device } from "@e2e-dev/mobile";
import type { Browser, WebRoute } from "@e2e-dev/web";
import { IOS_PORT } from "../../e2e.config.ts";

type Receipt = { url: string; providerUrl: string; workspace: string; serverPid: number; runnerPid: number };
type Rgb = [number, number, number];
type SessionList = { groups: { label: string; sessions: ListedSession[] }[] };
type ListedSession = { id: string; title: string; status: string; parentId?: string; subagent?: { status: string; completionDelivery?: string } };
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
  wideScreen(): Promise<void>;
  paletteChord(): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  overflowsSideways(): Promise<boolean>;
  reachable(target: Locator): Promise<boolean>;
  clipboard(options?: { refuse?: boolean }): Promise<void>;
  copied(): Promise<string>;
  keyboard: { down(key: string): Promise<void>; up(key: string): Promise<void> };
  peek(target: Locator): Promise<void>;
  sessionMenu(title: string): Promise<void>;
  glyph(title: string): Promise<{ label: string; animated: boolean }>;
  accentDot(title: string): Promise<boolean>;
  appearance(): Promise<"light" | "dark">;
  look(target: Locator): Promise<{ color: Rgb; background: Rgb; fonts: string[]; loaded: string[]; size: number; ring: Rgb | null }>;
  deviceAppearance(scheme: "light" | "dark"): Promise<void>;
  newSessionDraft(): Promise<string>;
  attach(target: Locator, files: (string | { name: string; bytes: number })[]): Promise<void>;
  download(target: Locator): Promise<{ name: string; text: string }>;
  hold(target: Locator, until: Locator): Promise<void>;
  contextMenu(target: Locator): Promise<void>;
  flip(target: Locator): Promise<void>;
  intercept(method: string, path: RegExp): Promise<Intercepted>;
  repository(): Promise<{ path: string; git(...args: string[]): string }>;
  stored(text: string): Promise<string[]>;
  secretDirectories(): Promise<string[]>;
};

const touch = ({ x, y, type }: { x: number; y: number; type: "pointerdown" | "pointerup" }) => {
  const target = document.elementFromPoint(x, y);
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
  target?.dispatchEvent(new PointerEvent(type, { ...init, pointerId: 1, pointerType: "touch", isPrimary: true }));
  if (type === "pointerup") target?.dispatchEvent(new MouseEvent("click", init));
  return null;
};

const trackSockets = () => {
  const sockets = new Set<WebSocket>();
  (window as unknown as { huiSockets: Set<WebSocket> }).huiSockets = sockets;
  window.WebSocket = class extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(protocols === "vite-hmr" ? "ws://127.0.0.1:1/" : url, protocols);
      sockets.add(this);
      this.addEventListener("close", () => sockets.delete(this));
    }
  };
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
    const prompt = async (session: { id: string }, text: string) => {
      await expect.poll(async () => (await sessions()).find(({ id }) => id === session.id)?.status, { timeout: 30_000 }).toBe("idle");
      await api("POST", `/__hui/sessions/${session.id}/prompt`, { text });
    };
    const browser = () => (fixtures as unknown as { browser: Browser }).browser;
    const device = () => (fixtures as unknown as { device: Device }).device;
    const launch = () => device().openApp("dev.hui.ios", { relaunch: true, launchArguments: ["-HUIGatewayURL", receipt.url] });
    const clearState = async () => {
      if (!web) {
        await device().closeApp();
        const container = execFileSync("xcrun", ["simctl", "get_app_container", "HUI iPhone", "dev.hui.ios", "data"], { encoding: "utf8" }).trim();
        const forget = spawnSync("xcrun", ["simctl", "spawn", "HUI iPhone", "defaults", "delete", join(container, "Library/Preferences/dev.hui.ios")], { encoding: "utf8" });
        if (forget.status !== 0 && !forget.stderr.includes("not found")) throw new Error(`defaults delete dev.hui.ios answered ${forget.status}: ${forget.stderr}`);
      }
      await fixtures.app.clearState();
    };
    const notOnIos = (step: string) => () => {
      throw new Error(`hui.${step} is not on iOS yet; keep the test on platforms: ['web']`);
    };

    const existing = new Set(await sessionIds());
    const existingGroups = new Set((await groups()).map((group) => group.label));
    const existingTasks = new Set(await taskIds());
    const settings = await api<unknown>("GET", "/__hui/settings");
    if (web) await browser().addInitScript(trackSockets);
    await clearState();
    if (!web) await launch();
    const directories: string[] = [];

    const webSteps: Omit<Hui, "workspace" | "gateway" | "api" | "createSession" | "prompt" | "createSubagent" | "provider" | "restartGateway" | "exitRuntimes" | "open" | "reload" | "clearState" | "repository"> = {
      url: () => browser().url(),
      clipboard: ({ refuse = false } = {}) => browser().addInitScript((refused: boolean) => {
        const page = window as unknown as { huiCopied: string };
        page.huiCopied = "";
        navigator.clipboard.writeText = async (text) => {
          if (refused) throw new DOMException("Clipboard write refused", "NotAllowedError");
          page.huiCopied = text;
        };
        if (refused) document.execCommand = () => false;
      }, refuse),
      copied: () => browser().evaluate(() => (window as unknown as { huiCopied?: string }).huiCopied ?? ""),
      keyboard: { down: (key) => browser().keyboard.down(key), up: (key) => browser().keyboard.up(key) },
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
      wideScreen: () => browser().setViewport({ width: 1440, height: 900 }),
      paletteChord: async () => {
        const apple = await browser().evaluate(() => /Mac|iPhone|iPad|iPod/u.test(navigator.platform));
        await browser().keyboard.press(apple ? "Meta+K" : "Control+K");
      },
      back: () => browser().back(),
      forward: () => browser().forward(),
      peek: (target) => target.hover(),
      sessionMenu: async (title) => {
        const row = fixtures.screen.getByTestId("session-row").filter({ hasText: title });
        await row.hover();
        await row.getByRole("button", `Actions for ${title}`).tap();
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
      appearance: () => browser().evaluate(() => (document.documentElement.dataset["themeMode"] === "dark" ? "dark" : "light")),
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
          const fonts = style.fontFamily.split(",").map((family) => family.trim().replace(/^"(.*)"$/u, "$1"));
          const faces = [...document.fonts];
          const outerShadow = style.boxShadow.split(/,(?![^(]*\))/u).at(-1)!.trim();
          return {
            color: rgb(style.color),
            background: rgb(getComputedStyle(behind).backgroundColor),
            fonts,
            loaded: fonts.filter((family) => faces.some((face) => face.family === family && face.status === "loaded")
              && document.fonts.check(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} "${family}"`, element.textContent ?? "")),
            size: Number.parseFloat(style.fontSize),
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
      contextMenu: (target) => target.secondaryTap(),
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
        let arrive: () => void = () => undefined;
        let decide: (handle: (route: WebRoute) => Promise<void>) => void = () => undefined;
        let done: () => void = () => undefined;
        const arrival = new Promise<void>((resolve) => { arrive = resolve; });
        const decision = new Promise<(route: WebRoute) => Promise<void>>((resolve) => { decide = resolve; });
        const handled = new Promise<void>((resolve) => { done = resolve; });
        await browser().route(path, async (route) => {
          if (route.request.method !== method) return route.fallback();
          arrive();
          try {
            await (await decision)(route);
          } finally {
            done();
          }
        });
        const settle = async (handle: (route: WebRoute) => Promise<void>) => {
          await arrival;
          decide(handle);
          await handled;
          await browser().unroute(path);
        };
        return {
          arrived: () => arrival,
          deliver: () => settle((route) => route.continue()),
          reject: (status, error) => settle((route) => route.fulfill({ status, json: { error } })),
          answer: (json) => settle((route) => route.fulfill({ status: 200, contentType: "application/json", body: json })),
          deliverAndDrop: () => settle(async (route) => {
            const response = await fetch(route.request.url, {
              method,
              headers: { "x-hui": "1", "content-type": "application/json" },
              body: route.request.postData,
            });
            if (!response.ok) throw new Error(`${method} ${route.request.url} answered ${response.status}: ${await response.text()}`);
            await route.abort();
          }),
        };
      },
    };

    await use({
      ...(web ? webSteps : Object.fromEntries(Object.keys(webSteps).map((step) => [step, notOnIos(step)])) as unknown as typeof webSteps),
      ...(web ? {} : { keyboard: { down: notOnIos("keyboard.down"), up: notOnIos("keyboard.up") } }),
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
    for (const id of await taskIds()) {
      if (!existingTasks.has(id)) await api("DELETE", `/__hui/automation/tasks/${id}`);
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
  },
});
