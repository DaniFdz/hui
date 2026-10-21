/**
 * HUI's fixture for the shared e2e suite: the disposable gateway each target runs against, setup and cleanup through
 * its API, the deterministic provider's barriers, a gateway request a test holds, rejects or delivers while dropping
 * its answer, and the steps whose gesture differs per platform, such as holding a control, attaching files from
 * `files/`, reading what a download saved or what the page copied and opening a session's menu. Test files import
 * `test` from here, never from `e2e`, and never read `platform`, `device` or `browser` themselves.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Locator } from "e2e";
import type { Browser, WebRoute } from "@e2e-dev/web";

type Receipt = { url: string; providerUrl: string; workspace: string };
type SessionList = { groups: { label: string; sessions: ListedSession[] }[] };
type ListedSession = { id: string; title: string; status: string; parentId?: string; subagent?: { status: string; completionDelivery?: string } };
type Intercepted = {
  arrived(): Promise<void>;
  reject(status: number, error: string): Promise<void>;
  deliverAndDrop(): Promise<void>;
};

export type Hui = {
  workspace: string;
  api<T>(method: string, path: string, body?: unknown): Promise<T>;
  createSession(input: { title: string; tool?: "pi"; group?: string }): Promise<{ id: string }>;
  createSubagent(parent: { id: string }): Promise<{ id: string; title: string }>;
  prompt(session: { id: string }, text: string): Promise<void>;
  provider: { held(): Promise<void>; release(): Promise<void> };
  open(path: string): Promise<void>;
  reload(): Promise<void>;
  url(): Promise<string>;
  phoneScreen(): Promise<{ width: number; height: number }>;
  clipboard(options?: { refuse?: boolean }): Promise<void>;
  copied(): Promise<string>;
  keyboard: { down(key: string): Promise<void>; up(key: string): Promise<void> };
  peek(target: Locator): Promise<void>;
  sessionMenu(title: string): Promise<void>;
  appearance(): Promise<"light" | "dark">;
  deviceAppearance(scheme: "light" | "dark"): Promise<void>;
  newSessionDraft(): Promise<string>;
  attach(target: Locator, files: string[]): Promise<void>;
  download(target: Locator): Promise<{ name: string; text: string }>;
  hold(target: Locator, until: Locator): Promise<void>;
  intercept(method: string, path: RegExp): Promise<Intercepted>;
};

const touch = ({ x, y, type }: { x: number; y: number; type: "pointerdown" | "pointerup" }) => {
  const target = document.elementFromPoint(x, y);
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
  target?.dispatchEvent(new PointerEvent(type, { ...init, pointerId: 1, pointerType: "touch", isPrimary: true }));
  if (type === "pointerup") target?.dispatchEvent(new MouseEvent("click", init));
  return null;
};

export const test = base.extend<{ hui: Hui }>({
  hui: async (fixtures, use) => {
    const port = new URL(fixtures.app.baseUrl!).port;
    const file = new URL(`../../.e2e/hui/receipt-${port}.json`, import.meta.url);
    await expect.poll(() => readFile(file).then(() => true, () => false), { timeout: 60_000 }).toBe(true);
    const receipt = JSON.parse(await readFile(file, "utf8")) as Receipt;

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
    const prompt = async (session: { id: string }, text: string) => {
      await expect.poll(async () => (await sessions()).find(({ id }) => id === session.id)?.status, { timeout: 30_000 }).toBe("idle");
      await api("POST", `/__hui/sessions/${session.id}/prompt`, { text });
    };
    const browser = () => (fixtures as unknown as { browser: Browser }).browser;

    const existing = new Set(await sessionIds());
    const existingGroups = new Set((await groups()).map((group) => group.label));
    const settings = await api<unknown>("GET", "/__hui/settings");
    await fixtures.app.clearState();

    await use({
      workspace: receipt.workspace,
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
        held: () => control("GET", "/control/wait-replay-ready"),
        release: () => control("POST", "/control/release-replay"),
      },
      open: (path) => fixtures.app.open(path),
      reload: () => browser().reload(),
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
      phoneScreen: async () => {
        const phone = { width: 390, height: 844 };
        await browser().setViewport(phone);
        return phone;
      },
      peek: (target) => target.hover(),
      sessionMenu: async (title) => {
        const row = fixtures.screen.getByTestId("session-row").filter({ hasText: title });
        await row.hover();
        await row.getByRole("button", `Actions for ${title}`).tap();
      },
      appearance: () => browser().evaluate(() => (document.documentElement.dataset["themeMode"] === "dark" ? "dark" : "light")),
      deviceAppearance: (scheme) => browser().emulateMedia({ colorScheme: scheme }),
      attach: (target, files) => target.setInputFiles(files.map((name) => fileURLToPath(new URL(`files/${name}`, import.meta.url)))),
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
          reject: (status, error) => settle((route) => route.fulfill({ status, json: { error } })),
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
    });

    await control("POST", "/control/release-replay");
    for (const id of await sessionIds()) {
      if (existing.has(id)) continue;
      const response = await fetch(`${receipt.url}/__hui/sessions/${id}`, { method: "DELETE", headers: { "x-hui": "1" } });
      if (!response.ok && response.status !== 404) throw new Error(`DELETE /__hui/sessions/${id} answered ${response.status}`);
    }
    for (const { label } of await groups()) {
      if (!existingGroups.has(label)) await api("DELETE", `/__hui/session-groups/${encodeURIComponent(label)}`);
    }
    await api("PUT", "/__hui/settings", settings);
  },
});
