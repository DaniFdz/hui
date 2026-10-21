/**
 * HUI's fixture for the shared e2e suite: the disposable gateway each target runs against, setup and cleanup through
 * its API, the deterministic provider's barriers, and the steps whose gesture differs per platform, such as attaching
 * files from `files/` and reading what a download saved. Test files import `test` from here, never from `e2e`, and
 * never read `platform`, `device` or `browser` themselves.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Locator } from "e2e";
import type { Browser } from "@e2e-dev/web";

type Receipt = { url: string; providerUrl: string; workspace: string };
type SessionList = { groups: { sessions: { id: string }[] }[] };

export type Hui = {
  workspace: string;
  api<T>(method: string, path: string, body?: unknown): Promise<T>;
  createSession(input: { title: string; tool?: "pi" }): Promise<{ id: string }>;
  provider: { held(): Promise<void>; release(): Promise<void> };
  open(path: string): Promise<void>;
  reload(): Promise<void>;
  appearance(): Promise<"light" | "dark">;
  deviceAppearance(scheme: "light" | "dark"): Promise<void>;
  newSessionDraft(): Promise<string>;
  attach(target: Locator, files: string[]): Promise<void>;
  download(target: Locator): Promise<{ name: string; text: string }>;
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
    const sessionIds = async () =>
      (await api<SessionList>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions.map((session) => session.id));
    const browser = () => (fixtures as unknown as { browser: Browser }).browser;

    const existing = new Set(await sessionIds());
    const settings = await api<unknown>("GET", "/__hui/settings");
    await fixtures.app.clearState();

    await use({
      workspace: receipt.workspace,
      api,
      createSession: async (input) =>
        (await api<{ session: { id: string } }>("POST", "/__hui/sessions", { cwd: receipt.workspace, ...input })).session,
      provider: {
        held: () => control("GET", "/control/wait-replay-ready"),
        release: () => control("POST", "/control/release-replay"),
      },
      open: (path) => fixtures.app.open(path),
      reload: () => browser().reload(),
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
    });

    await control("POST", "/control/release-replay");
    for (const id of await sessionIds()) if (!existing.has(id)) await api("DELETE", `/__hui/sessions/${id}`);
    await api("PUT", "/__hui/settings", settings);
  },
});
