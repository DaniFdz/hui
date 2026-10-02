/**
 * Remote half of configuration sync. The gateway decides what to mirror; this
 * side only writes inside the mirror directory, removes files it wrote before
 * and no longer receives, and installs what PI would otherwise install lazily
 * during the first session start.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { WorkerPaths } from "./paths.ts";

export type SyncEntry = { path: string; hash: string; mode: number; size: number };
export type SyncFile = { path: string; mode: number; data: string };
export type SyncCommit = {
  entries: SyncEntry[];
  /** Mirror-relative local package roots that may need their dependencies. */
  packageRoots?: string[];
};
export type SyncResult = { files: number; deleted: number; installed: string[]; errors: string[] };

type Manifest = { version: 1; files: Record<string, string>; installed: Record<string, string> };

const NPM_TIMEOUT_MS = 10 * 60_000;

export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function writeAtomic(path: string, data: Buffer | string, mode = 0o644): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { mode });
  await rename(temporary, path).catch(async (error: unknown) => {
    await rm(temporary, { force: true });
    throw error;
  });
}

function target(paths: WorkerPaths, path: unknown): string {
  if (typeof path !== "string" || !path || path.includes("\0") || path.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("Invalid sync path.");
  }
  const absolute = join(paths.mirrorDir, ...path.split("/"));
  if (!inside(paths.mirrorDir, absolute)) throw new Error("Sync path escapes the mirror.");
  return absolute;
}

async function readManifest(paths: WorkerPaths): Promise<Manifest> {
  try {
    const raw = JSON.parse(await readFile(join(paths.stateDir, "sync-manifest.json"), "utf8")) as Partial<Manifest>;
    return { version: 1, files: raw.files ?? {}, installed: raw.installed ?? {} };
  } catch {
    return { version: 1, files: {}, installed: {} };
  }
}

/** Which entries the remote lacks or holds in another version. */
export async function planSync(paths: WorkerPaths, entries: unknown): Promise<{ need: string[] }> {
  if (!Array.isArray(entries)) throw new Error("Invalid sync plan.");
  const manifest = await readManifest(paths);
  const need: string[] = [];
  for (const entry of entries as SyncEntry[]) {
    const path = target(paths, entry.path);
    if (manifest.files[entry.path] !== entry.hash || !existsSync(path)) need.push(entry.path);
  }
  return { need };
}

export async function putSyncFiles(paths: WorkerPaths, files: unknown): Promise<{ written: number }> {
  if (!Array.isArray(files)) throw new Error("Invalid sync upload.");
  for (const file of files as SyncFile[]) {
    if (typeof file.data !== "string") throw new Error("Invalid sync upload.");
    await writeAtomic(target(paths, file.path), Buffer.from(file.data, "base64"), (Number(file.mode) & 0o777) || 0o644);
  }
  return { written: files.length };
}

function npmCommand(): string {
  const local = join(dirname(process.execPath), "npm");
  return existsSync(local) ? local : "npm";
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await promisify(execFile)(command, args, { cwd, timeout: NPM_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }).catch((error: { stderr?: string; message: string }) => {
    throw new Error(String(error.stderr || error.message).trim().split("\n").slice(-3).join(" "));
  });
}

export async function applySync(paths: WorkerPaths, commit: SyncCommit): Promise<SyncResult> {
  if (!Array.isArray(commit.entries)) throw new Error("Invalid sync commit.");
  const previous = await readManifest(paths);
  const files: Record<string, string> = {};
  for (const entry of commit.entries) {
    target(paths, entry.path);
    files[entry.path] = entry.hash;
  }
  let deleted = 0;
  for (const path of Object.keys(previous.files)) {
    if (Object.hasOwn(files, path)) continue;
    await rm(target(paths, path), { force: true });
    deleted += 1;
  }
  const manifest: Manifest = { version: 1, files, installed: {} };
  const result: SyncResult = { files: commit.entries.length, deleted, installed: [], errors: [] };
  // Local packages are loaded in place by PI; give them their dependencies the
  // way PI installs git packages. Reinstall only when package.json changed.
  for (const root of commit.packageRoots ?? []) {
    const hash = files[`${root}/package.json`];
    const dir = target(paths, root);
    if (!hash) continue;
    if (previous.installed[root] === hash && existsSync(join(dir, "node_modules"))) { manifest.installed[root] = hash; continue; }
    try {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
        await run(npmCommand(), ["install", "--omit=dev", "--no-audit", "--no-fund"], dir);
        result.installed.push(root);
      }
      manifest.installed[root] = hash;
    } catch (error) {
      result.errors.push(`${root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await writeAtomic(join(paths.stateDir, "sync-manifest.json"), `${JSON.stringify(manifest)}\n`, 0o600);
  // npm: and git: packages from settings are installed now rather than inside
  // the first session's 30 second boot window.
  if (existsSync(join(paths.agentDir, "settings.json"))) {
    try {
      const { DefaultPackageManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
      await mkdir(paths.stateDir, { recursive: true });
      const settingsManager = SettingsManager.create(paths.stateDir, paths.agentDir);
      const manager = new DefaultPackageManager({ cwd: paths.stateDir, agentDir: paths.agentDir, settingsManager });
      const previousDir = process.env["PI_CODING_AGENT_DIR"];
      process.env["PI_CODING_AGENT_DIR"] = paths.agentDir;
      try {
        await manager.resolve(async (source) => {
          result.installed.push(source);
          return "install";
        });
      } finally {
        if (previousDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
        else process.env["PI_CODING_AGENT_DIR"] = previousDir;
      }
    } catch (error) {
      result.errors.push(`PI packages: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
