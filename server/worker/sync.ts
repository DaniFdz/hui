/**
 * Gateway half of configuration sync: which local files make up the user's PI
 * setup, and where they live in the remote mirror.
 *
 * Mirrored: PI's agent files and resource directories, `~/.agents/skills`,
 * every local path named in PI settings (packages, skills, extensions,
 * prompts), HUI's provider selections and the worker's extra paths. Never
 * mirrored: credentials (they are brokered), transcripts, installed npm/git
 * packages (the remote installs its own), `node_modules` and `.git`.
 *
 * Local paths in settings become absolute mirror paths, so relative sources and
 * `~` keep meaning the same files on a remote with another home directory.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { configuredResourceId } from "../runtimes/resource-policy.ts";
import { inside, type SyncEntry } from "./sync-apply.ts";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 20_000;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const AGENT_FILES = ["models.json", "AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "SYSTEM.md", "APPEND_SYSTEM.md"];
const AGENT_DIRS = ["extensions", "skills", "prompts"];
const SETTINGS_KEYS = ["packages", "skills", "extensions", "prompts"] as const;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

export type PlannedFile = SyncEntry & { local?: string; content?: Buffer };

export type SyncPlan = {
  files: PlannedFile[];
  /** Mirror-relative roots of local packages, for their npm dependencies. */
  packageRoots: string[];
  /** Local HUI plugin id → the id of the same resource on the remote. */
  pluginIds: Map<string, string>;
  skipped: string[];
};

export type SyncSource = {
  agentDir: string;
  home: string;
  /** Absolute mirror directory on the remote. */
  remoteMirror: string;
  extraPaths?: readonly string[];
  /** Already-sanitized HUI provider files (no secrets), by file name. */
  providerFiles?: Record<string, string>;
};

/** Where a local path lives inside the mirror. */
export function mirrorPath(local: string, source: Pick<SyncSource, "agentDir" | "home">): string {
  const under = (root: string) => root === local ? "" : inside(root, local) ? relative(root, local) : undefined;
  const posix = (value: string) => value.split(sep).join("/");
  const agent = under(source.agentDir);
  if (agent !== undefined) return posix(join("agent", agent));
  const home = under(source.home);
  if (home !== undefined) return posix(join("home", home));
  return posix(join("root", local));
}

/** A settings source that names a local path, resolved; otherwise undefined. */
export function localSource(value: string, base: string, home: string): string | undefined {
  if (!value || /^(?:npm|git|https?|ssh):|^git@/u.test(value) || /[*?[]/u.test(value) || /^[!+-]/u.test(value)) return undefined;
  const expanded = value === "~" ? home : value.startsWith("~/") ? join(home, value.slice(2)) : value;
  return isAbsolute(expanded) ? expanded : resolve(base, expanded);
}

const hashes = new Map<string, { mtimeMs: number; size: number; hash: string }>();

async function fileHash(path: string, info: { mtimeMs: number; size: number }): Promise<string> {
  const cached = hashes.get(path);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.hash;
  const hash = createHash("sha256").update(await readFile(path)).digest("hex");
  hashes.set(path, { mtimeMs: info.mtimeMs, size: info.size, hash });
  return hash;
}

export async function buildSyncPlan(source: SyncSource): Promise<SyncPlan> {
  const files = new Map<string, PlannedFile>();
  const skipped: string[] = [];
  const pluginIds = new Map<string, string>();
  const packageRoots: string[] = [];
  const roots = new Set<string>();
  let total = 0;
  const remote = (local: string) => `${source.remoteMirror}/${mirrorPath(local, source)}`;
  const addContent = (path: string, content: Buffer, mode = 0o600) => {
    files.set(path, { path, content, mode, size: content.byteLength, hash: createHash("sha256").update(content).digest("hex") });
  };

  // Settings: local sources become absolute mirror paths.
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(await readFile(join(source.agentDir, "settings.json"), "utf8")) as Record<string, unknown>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") skipped.push("settings.json: unreadable"); }
  for (const key of SETTINGS_KEYS) {
    const list = settings[key];
    if (!Array.isArray(list)) continue;
    settings[key] = list.map((entry: unknown) => {
      const value = typeof entry === "string" ? entry : entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string" ? (entry as { source: string }).source : undefined;
      const local = value === undefined ? undefined : localSource(value, source.agentDir, source.home);
      if (value === undefined || local === undefined) return entry;
      roots.add(local);
      const rewritten = remote(local);
      if (key === "packages") {
        packageRoots.push(mirrorPath(local, source));
        pluginIds.set(configuredResourceId("package", value), configuredResourceId("package", rewritten));
      }
      if (key === "extensions") pluginIds.set(configuredResourceId("extension", value), configuredResourceId("extension", rewritten));
      return typeof entry === "string" ? rewritten : { ...(entry as object), source: rewritten };
    });
  }
  // Transcripts stay in the remote's default location.
  delete settings["sessionDir"];
  addContent("agent/settings.json", Buffer.from(`${JSON.stringify(settings, null, 2)}\n`));
  for (const name of AGENT_FILES) roots.add(join(source.agentDir, name));
  for (const name of AGENT_DIRS) roots.add(join(source.agentDir, name));
  roots.add(join(source.home, ".agents", "skills"));
  for (const extra of source.extraPaths ?? []) {
    const local = localSource(extra, source.home, source.home);
    if (local) roots.add(local);
    else skipped.push(`${extra}: not a local path`);
  }
  for (const [name, content] of Object.entries(source.providerFiles ?? {})) addContent(`hui/providers/${name}`, Buffer.from(content));

  const walk = async (local: string, ancestors: Set<string>): Promise<void> => {
    let info;
    try { info = await stat(local); } catch { return; }
    if (info.isDirectory()) {
      if (SKIP_DIRS.has(basename(local))) return;
      const real = await realpath(local);
      if (ancestors.has(real)) return;
      const next = new Set(ancestors).add(real);
      for (const entry of await readdir(local).catch(() => [] as string[])) await walk(join(local, entry), next);
      return;
    }
    if (!info.isFile()) return;
    const path = mirrorPath(local, source);
    if (files.has(path) || basename(local) === "auth.json") return;
    if (info.size > MAX_FILE_BYTES) { skipped.push(`${local}: larger than 8 MB`); return; }
    total += info.size;
    if (files.size >= MAX_FILES || total > MAX_TOTAL_BYTES) {
      throw new Error(`Too much to sync to the worker (over ${MAX_FILES} files or 256 MB). Narrow the PI resources or extra paths.`);
    }
    files.set(path, { path, local, mode: info.mode & 0o777, size: info.size, hash: await fileHash(local, info) });
  };
  for (const root of roots) await walk(root, new Set());
  return { files: [...files.values()].toSorted((a, b) => a.path.localeCompare(b.path)), packageRoots: [...new Set(packageRoots)], pluginIds, skipped };
}
