/**
 * Gateway half of configuration sync: which local files make up the user's PI
 * setup, and where they live in the remote mirror.
 *
 * Mirrored: PI's agent files and resource directories, `~/.agents/skills`,
 * every local path named in PI settings (packages, skills, extensions,
 * prompts), HUI's settings and provider selections and the worker's extra
 * paths. Never
 * mirrored: credentials (they are brokered, as are literal keys and header
 * values in PI's models.json: `brokeredModels`), transcripts, installed
 * npm/git packages (the remote installs its own), `node_modules` and `.git`.
 *
 * Local paths in settings become absolute mirror paths, so relative sources and
 * `~` keep meaning the same files on a remote with another home directory.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { configuredResourceId } from "../runtimes/resource-policy.ts";
import { inside, type SyncEntry } from "./sync-apply.ts";

const internal = async <T>(path: string): Promise<T> =>
  await import(new URL(path, import.meta.resolve("@earendil-works/pi-coding-agent")).href) as T;
type Headers = Record<string, string>;
type ProviderConfig = { apiKey?: string; headers?: Headers; models?: { id: string; headers?: Headers }[]; modelOverrides?: Record<string, { headers?: Headers }> };
const { ModelConfig } = await internal<{ ModelConfig: { load(path: string): Promise<{ providers: Map<string, ProviderConfig>; error?: string }> } }>("./core/model-config.js");
const configValue = await internal<{
  isCommandConfigValue(value: string): boolean;
  getConfigValueEnvVarNames(value: string): string[];
  resolveConfigValue(value: string): string | undefined;
}>("./core/resolve-config-value.js");
/** PI rejects a models.json provider that sets none of these. */
const PROVIDER_FIELDS = ["models", "baseUrl", "headers", "compat", "modelOverrides", "apiKey", "oauth", "authHeader"];

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 20_000;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const AGENT_FILES = ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "SYSTEM.md", "APPEND_SYSTEM.md"];
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

/** Headers whose names carry credentials. Other literal headers (routing,
 * tags, feature flags) are configuration, mirrored so the worker keeps them
 * even with nothing served. */
const CREDENTIAL_HEADER = /auth|cookie|token|secret|password|key/iu;

/** Literal models.json values a worker gets from the gateway, by provider:
 * the key and the header values, under the variable names the mirror uses. */
export type ModelSecrets = Map<string, { key?: string; env: Record<string, string> }>;

/**
 * PI's models.json as a worker gets it, and the literals it leaves out. A
 * literal key is dropped (the gateway serves it as the provider's credential
 * when PI's login has none, which is PI's own precedence) and a literal
 * credential header value becomes `${HUI_SECRET_…}`, resolved from the `env` of the credential
 * the gateway serves. Values PI resolves itself (`$NAME`, `!command`) stay.
 */
export async function brokeredModels(path: string): Promise<{ mirrored?: Buffer; secrets: ModelSecrets; error?: string }> {
  const secrets: ModelSecrets = new Map();
  const loaded = await ModelConfig.load(path);
  if (loaded.error) return { secrets, error: loaded.error };
  if (!loaded.providers.size) return { secrets };
  const literal = (value: string) => !configValue.isCommandConfigValue(value) && !configValue.getConfigValueEnvVarNames(value).length;
  const providers: Record<string, ProviderConfig> = {};
  for (const [id, frozen] of loaded.providers) {
    const provider = structuredClone(frozen);
    const env: Record<string, string> = {};
    const broker = (headers: Headers | undefined, scope: string) => {
      for (const [name, value] of Object.entries(headers ?? {})) {
        if (!literal(value) || !CREDENTIAL_HEADER.test(name)) continue;
        const variable = `HUI_SECRET_${createHash("sha256").update(JSON.stringify([id, scope, name])).digest("hex").slice(0, 16).toUpperCase()}`;
        env[variable] = configValue.resolveConfigValue(value) ?? "";
        headers![name] = `\${${variable}}`;
      }
    };
    broker(provider.headers, "");
    for (const model of provider.models ?? []) broker(model.headers, `model:${model.id}`);
    for (const [model, override] of Object.entries(provider.modelOverrides ?? {})) broker(override.headers, `override:${model}`);
    const key = provider.apiKey !== undefined && literal(provider.apiKey) ? configValue.resolveConfigValue(provider.apiKey) : undefined;
    if (key !== undefined) delete provider.apiKey;
    if (key !== undefined || Object.keys(env).length) secrets.set(id, { ...(key === undefined ? {} : { key }), env });
    // A built-in provider's key alone: the served credential is all it needs.
    if (PROVIDER_FIELDS.some((field) => field in provider)) providers[id] = provider;
  }
  return { mirrored: Buffer.from(`${JSON.stringify({ providers }, null, 2)}\n`), secrets };
}

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

/** A generated file, as opposed to one read from a local path. */
export function contentFile(path: string, content: Buffer, mode = 0o600): PlannedFile {
  return { path, content, mode, size: content.byteLength, hash: createHash("sha256").update(content).digest("hex") };
}

export async function buildSyncPlan(source: SyncSource): Promise<SyncPlan> {
  const files = new Map<string, PlannedFile>();
  const skipped: string[] = [];
  const pluginIds = new Map<string, string>();
  const packageRoots: string[] = [];
  const roots = new Set<string>();
  let total = 0;
  const remote = (local: string) => `${source.remoteMirror}/${mirrorPath(local, source)}`;
  const addContent = (path: string, content: Buffer) => { files.set(path, contentFile(path, content)); };

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
  const models = await brokeredModels(join(source.agentDir, "models.json"));
  if (models.mirrored) addContent("agent/models.json", models.mirrored);
  else if (models.error) skipped.push("models.json: invalid, not mirrored");
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
