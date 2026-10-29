/**
 * HUI's fixture for the shared e2e suite: the disposable gateway each target runs against, setup and cleanup through
 * its API, the deterministic provider's barriers, and the steps whose gesture differs per platform, such as attaching
 * files from `files/` and reading what a download saved. Test files import `test` from here, never from `e2e`, and
 * never read `platform`, `device` or `browser` themselves.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Locator } from "e2e";
import type { Browser } from "@e2e-dev/web";
import { workerRelease } from "../../server/worker/release.ts";

const checkout = fileURLToPath(new URL("../../", import.meta.url));

/** A worker's connect command as HUI stores it: plain words, POSIX quoted. */
const commandText = (words: readonly string[]) => words.map((word) => (/^[\w@%+=:,./-]+$/u.test(word) ? word : `'${word.replaceAll("'", `'"'"'`)}'`)).join(" ");

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
  /** A worker on this machine: its own home, this checkout pre-installed as its release. */
  addWorker(name: string): Promise<{ id: string; home: string }>;
  /** Records, from now on, the text the page copies to the clipboard. */
  clipboardSpy(): Promise<void>;
  clipboardWrites(): Promise<string[]>;
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
    const sessionIds = async () =>
      (await api<SessionList>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions.map((session) => session.id));
    const browser = () => (fixtures as unknown as { browser: Browser }).browser;

    const botIds = async () => (await api<{ bots: { id: string }[] }>("GET", "/__hui/bots")).bots.map((bot) => bot.id);
    const workerIds = async () => (await api<{ workers: { id: string }[] }>("GET", "/__hui/workers")).workers.map((worker) => worker.id);
    const existing = new Set(await sessionIds());
    const existingBots = new Set(await botIds());
    const existingWorkers = new Set(await workerIds());
    const workerHomes: string[] = [];
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
      addWorker: async (name) => {
        // The checkout itself as the remote release, so connecting never needs the network (as workers.test.ts does).
        const home = join(await mkdtemp(join(tmpdir(), "hui-e2e-worker-")), "home");
        workerHomes.push(home);
        const release = await workerRelease();
        const dir = join(home, ".local", "share", "hui-worker", "releases", release.id);
        for (const file of release.files) {
          await mkdir(dirname(join(dir, file.path)), { recursive: true });
          await writeFile(join(dir, file.path), file.data, { mode: file.mode });
        }
        await symlink(join(checkout, "node_modules"), join(dir, "node_modules"));
        await writeFile(join(dir, ".ready"), "");
        const command = commandText(["env", "-u", "PI_CODING_AGENT_DIR", "-u", "XDG_CONFIG_HOME", "-u", "XDG_DATA_HOME", "-u", "PI_OFFLINE", "-u", "HUI_CONFIG_DIR", `HOME=${home}`, "SHELL=/bin/sh"]);
        const created = await api<{ worker: { id: string } }>("POST", "/__hui/workers", { name, command });
        await api("POST", `/__hui/workers/${created.worker.id}/connect`);
        await expect.poll(async () => (await api<{ workers: { id: string; state: string; error?: string }[] }>("GET", "/__hui/workers")).workers.find((worker) => worker.id === created.worker.id)?.state, { timeout: 120_000 })
          .toBe("connected");
        return { id: created.worker.id, home };
      },
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
    });

    await control("POST", "/control/release-replay");
    // A bot's chat goes only with its bot.
    for (const id of await botIds()) if (!existingBots.has(id)) await api("DELETE", `/__hui/bots/${id}?permanent=1`);
    for (const id of await sessionIds()) if (!existing.has(id) && (await sessionIds()).includes(id)) await api("DELETE", `/__hui/sessions/${id}`);
    for (const id of await workerIds()) if (!existingWorkers.has(id)) await api("DELETE", `/__hui/workers/${id}`);
    // A worker host is a daemon by design; stop the ones this test started.
    for (const home of workerHomes) {
      try { execFileSync("pkill", ["-f", home]); } catch { /* already gone */ }
    }
    await api("PUT", "/__hui/settings", settings);
  },
});
