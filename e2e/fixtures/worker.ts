/** A worker host on this machine, for the shared suite's worker tests: its own home with this checkout pre-installed as its release. */
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { workerRelease } from "../../server/worker/release.ts";

const checkout = fileURLToPath(new URL("../../", import.meta.url));

/** A worker's connect command as HUI stores it: plain words, POSIX quoted. */
const commandText = (words: readonly string[]) => words.map((word) => (/^[\w@%+=:,./-]+$/u.test(word) ? word : `'${word.replaceAll("'", `'"'"'`)}'`)).join(" ");

type Api = <T>(method: string, path: string, body?: unknown) => Promise<T>;

export async function addWorkerOnThisMachine(api: Api, homes: string[], name: string): Promise<{ id: string; home: string }> {
  // The checkout itself as the remote release, so connecting never needs the network (as workers.test.ts does).
  const home = join(await mkdtemp(join(tmpdir(), "hui-e2e-worker-")), "home");
  homes.push(home);
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
  const state = async () => (await api<{ workers: { id: string; state: string; error?: string }[] }>("GET", "/__hui/workers")).workers.find((worker) => worker.id === created.worker.id)?.state;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await state() === "connected") return { id: created.worker.id, home };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The worker did not connect: ${await state() ?? "unknown"}`);
}
