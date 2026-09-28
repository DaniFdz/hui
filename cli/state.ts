import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR } from "../server/paths.ts";

export const GATEWAY_DIR = join(CONFIG_DIR, "gateway");
export const STATE_FILE = join(GATEWAY_DIR, "state.json");
export const LOG_FILE = join(GATEWAY_DIR, "gateway.log");
export type GatewayState = {
  format: 1; pid: number; instance: string; token: string; controlUrl: string;
  url: string; host: string; allowedHosts: string[]; port: number;
  version: string; packageRoot: string; startedAt: string;
};

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function readState(): Promise<GatewayState | undefined> {
  let raw: string;
  try { raw = await readFile(STATE_FILE, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  const value = JSON.parse(raw) as GatewayState;
  const control = new URL(value.controlUrl);
  if (value.format !== 1 || !Number.isSafeInteger(value.pid) || value.pid <= 0
    || typeof value.instance !== "string" || !/^[a-f0-9]{64}$/u.test(value.token)
    || control.protocol !== "http:" || control.hostname !== "127.0.0.1" || !control.port
    || control.username || control.password || control.pathname !== "/" || control.search || control.hash
    || typeof value.version !== "string" || typeof value.url !== "string" || typeof value.host !== "string"
    || !Array.isArray(value.allowedHosts) || !value.allowedHosts.every((host) => typeof host === "string")
    || !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535
    || typeof value.packageRoot !== "string" || typeof value.startedAt !== "string") {
    throw new Error(`Invalid gateway state; inspect ${STATE_FILE}. Nothing was stopped.`);
  }
  return value;
}

export async function removeState(instance: string): Promise<void> {
  if ((await readState())?.instance === instance) await unlink(STATE_FILE);
}

/** Serialize lifecycle operations. A dead owner's uniquely named file can be
 * reclaimed without deleting a replacement owner's lock in a concurrent race. */
export async function withLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
  await mkdir(GATEWAY_DIR, { recursive: true, mode: 0o700 });
  const directory = join(GATEWAY_DIR, "operation.lock");
  const owner = `${process.pid}-${randomUUID()}`;
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const entries = await readdir(directory);
    const stale = entries.length === 1 ? entries[0] : undefined;
    if (!stale || !/^\d+-[a-f0-9-]+$/u.test(stale) || processAlive(Number(stale.split("-")[0]))) {
      throw new Error("Another gateway/update operation is in progress. Retry after it finishes.");
    }
    await unlink(join(directory, stale));
    await rmdir(directory);
    await mkdir(directory, { mode: 0o700 });
  }
  await writeFile(join(directory, owner), "", { flag: "wx", mode: 0o600 });
  try { return await operation(); }
  finally { await unlink(join(directory, owner)); await rmdir(directory); }
}
