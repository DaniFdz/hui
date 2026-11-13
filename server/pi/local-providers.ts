/**
 * Local model servers: the custom providers in PI's `models.json` that live on a machine which may be asleep, the
 * operator's one start command for each, their reachability and a start that waits for the server to answer.
 *
 * The command is HUI-owned state in `providers/local-providers.json`, never in PI's configuration. It runs once, as
 * the gateway's user, on the machine that runs the gateway; HUI does not stop or restart what it starts. A model
 * request waits while a manual start is in progress, never to begin one.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { LocalProvider, LocalProviderSnapshot } from "../api/local-providers.ts";
import { PROVIDERS_DIR } from "../paths.ts";
import { resolvePiAgentDir } from "./paths.ts";

const FILE_NAME = "local-providers.json";
export const DEFAULT_READY_TIMEOUT_MS = 180_000;
export const MIN_READY_TIMEOUT_MS = 10_000;
export const MAX_READY_TIMEOUT_MS = 15 * 60_000;
const START_COMMAND_MAX = 4_000;
const HEALTH_URL_MAX = 2_048;
const PROBE_TIMEOUT_MS = 2_500;
const PROBE_CACHE_MS = 2_000;
const POLL_MS = 750;
const OUTPUT_LIMIT = 8_192;
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const TERMINATE_GRACE_MS = 2_000;

export class LocalProviderInputError extends Error {}

export type LocalProviderConfig = { startCommand: string; healthUrl?: string; readyTimeoutMs: number };
type LocalProviderConfigs = Record<string, LocalProviderConfig>;
type PiProvider = { id: string; name: string; models: number; baseUrl?: string };
type RuntimeState = {
  status: "online" | "offline" | "starting" | "failed" | "unknown";
  message?: string;
  checkedAt?: number;
  /** The running start; waiters share it. Absent once it settles. */
  done?: Promise<void>;
};
type Options = { dir?: string; agentDir?: string | (() => string) };

/** The readiness a model request waits for; a running gateway's service, or a test's. */
export type LocalModelGate = Pick<LocalProviderService, "isStarting" | "waitWhileStarting">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderId(id: string): boolean {
  return PROVIDER_ID.test(id);
}

/** A health URL is HTTP(S), without credentials in it, and bounded. */
export function validHealthUrl(value: string): boolean {
  if (value.length > HEALTH_URL_MAX) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function checkedCommand(value: unknown): string {
  if (typeof value !== "string") throw new LocalProviderInputError("Enter a start command.");
  const command = value.trim();
  if (!command) throw new LocalProviderInputError("Enter a start command.");
  if (command.length > START_COMMAND_MAX) throw new LocalProviderInputError(`A start command can be at most ${START_COMMAND_MAX} characters.`);
  if (command.includes("\u0000")) throw new LocalProviderInputError("A start command cannot contain a null character.");
  return command;
}

function checkedTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_READY_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_READY_TIMEOUT_MS || value > MAX_READY_TIMEOUT_MS) {
    throw new LocalProviderInputError(`The ready timeout must be a whole number of milliseconds from ${MIN_READY_TIMEOUT_MS} to ${MAX_READY_TIMEOUT_MS}.`);
  }
  return value;
}

function checkedHealthUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new LocalProviderInputError("Enter a health URL or leave it empty.");
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!validHealthUrl(trimmed)) throw new LocalProviderInputError("Enter an http:// or https:// health URL without a username or password.");
  return trimmed;
}

/** Read the commands the operator saved for local providers. Missing means none; a malformed file is an error, so a
 * broken edit never silently drops every command. */
export async function readLocalProviderConfigs(dir = PROVIDERS_DIR): Promise<LocalProviderConfigs> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(dir, FILE_NAME), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("HUI local provider configuration could not be read.");
  }
  if (!isRecord(raw)) throw new Error("Invalid HUI local provider configuration.");
  const result: LocalProviderConfigs = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!isProviderId(id) || !isRecord(entry)) throw new Error("Invalid HUI local provider configuration.");
    const unknown = Object.keys(entry).filter((key) => !["startCommand", "healthUrl", "readyTimeoutMs"].includes(key));
    if (unknown.length) throw new Error(`Unknown local provider field: ${unknown[0]}`);
    try {
      const startCommand = checkedCommand(entry["startCommand"]);
      const healthUrl = checkedHealthUrl(entry["healthUrl"]);
      const readyTimeoutMs = checkedTimeout(entry["readyTimeoutMs"]);
      result[id] = { startCommand, ...(healthUrl === undefined ? {} : { healthUrl }), readyTimeoutMs };
    } catch (error) {
      if (error instanceof LocalProviderInputError) throw new Error(`Invalid local provider ${id}: ${error.message}`);
      throw error;
    }
  }
  return result;
}

async function writeLocalProviderConfigs(configs: LocalProviderConfigs, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `local-providers.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(configs, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, join(dir, FILE_NAME));
}

async function managedProviderIds(dir: string): Promise<Set<string>> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(dir, "models.json"), "utf8"));
    return new Set(isRecord(raw) ? Object.keys(raw) : []);
  } catch {
    return new Set();
  }
}

/** PI's custom providers, in the order models.json lists them. HUI-managed connections override a provider they
 * share an id with, so those are left to Settings' provider cards. Only display-safe fields leave this function. */
async function readCustomProviders(agentDir: string, dir: string): Promise<PiProvider[]> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")); }
  catch { return []; }
  if (!isRecord(raw) || !isRecord(raw["providers"])) return [];
  const managed = await managedProviderIds(dir);
  return Object.entries(raw["providers"]).flatMap(([id, config]) => {
    if (!isProviderId(id) || !isRecord(config) || managed.has(id)) return [];
    const models = Array.isArray(config["models"]) ? config["models"].length : 0;
    const name = typeof config["name"] === "string" && config["name"].trim() ? config["name"].trim() : id;
    const baseUrl = typeof config["baseUrl"] === "string" && config["baseUrl"].trim() ? config["baseUrl"].trim() : undefined;
    return [{ id, name, models, ...(baseUrl === undefined ? {} : { baseUrl }) }];
  });
}

/** Any HTTP answer means the server is listening. A gateway or reverse proxy that is still bringing it up answers
 * 502/503/504, which count as not ready. */
async function responds(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(Math.max(250, timeoutMs)),
      headers: { accept: "*/*" },
    });
    await response.body?.cancel();
    return response.status !== 502 && response.status !== 503 && response.status !== 504;
  } catch {
    return false;
  }
}

function endpointOf(configured: string | undefined, provider: PiProvider | undefined): string | undefined {
  const value = configured ?? provider?.baseUrl;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    // A health check never sends credentials that a base URL may carry for the model API itself.
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return undefined;
  }
}

/** The command runs in the operator's home directory with the gateway's environment, and must not prompt: stdin is
 * closed. It gets its own process group so a timeout can end a shell that spawned ssh or a container CLI. */
function startCommand(command: string): ChildProcess {
  const windows = process.platform === "win32";
  return spawn(windows ? process.env["COMSPEC"] || "cmd.exe" : "/bin/sh", windows ? ["/d", "/s", "/c", command] : ["-c", command], {
    cwd: homedir(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !windows,
    windowsHide: true,
  });
}

function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const signal = (name: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, name);
      else child.kill(name);
    } catch { /* already gone */ }
  };
  signal("SIGTERM");
  const timer = setTimeout(() => signal("SIGKILL"), TERMINATE_GRACE_MS);
  timer.unref();
}

function lastLine(output: string): string {
  const cleaned = output.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, "").replace(/[^\t\n\u0020-\u007e\u00a0-\uffff]/gu, "");
  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
  const line = lines.at(-1) ?? "";
  return line.length > 300 ? `${line.slice(0, 297)}...` : line;
}

function settled<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

export class LocalProviderService {
  readonly dir: string;
  readonly #agentDir: () => string;
  readonly #states = new Map<string, RuntimeState>();
  readonly #probes = new Map<string, { at: number; reachable: boolean }>();
  readonly #names = new Map<string, string>();
  #configs?: Promise<LocalProviderConfigs>;

  constructor(options: Options = {}) {
    this.dir = options.dir ?? PROVIDERS_DIR;
    const agentDir = options.agentDir;
    this.#agentDir = typeof agentDir === "function" ? agentDir : () => agentDir ?? resolvePiAgentDir();
  }

  #config(): Promise<LocalProviderConfigs> {
    return this.#configs ??= readLocalProviderConfigs(this.dir).catch((error: unknown) => {
      this.#configs = undefined;
      throw error;
    });
  }

  /** Whether a manual start is in progress for this provider; the only condition a model request waits on. */
  isStarting(provider: string): boolean {
    return this.#states.get(provider)?.status === "starting";
  }

  /** The provider's display name from the last snapshot, for notices outside Settings. */
  name(provider: string): string {
    return this.#names.get(provider) ?? provider;
  }

  /** Resolves at once unless a manual start is running, then when it finishes; a failed start rejects with its
   * reason so the model request reports what happened instead of a bare connection error. */
  async waitWhileStarting(provider: string, signal?: AbortSignal): Promise<void> {
    const state = this.#states.get(provider);
    if (state?.status !== "starting" || !state.done) return;
    await settled(state.done, signal);
    signal?.throwIfAborted();
  }

  async snapshot(): Promise<LocalProviderSnapshot> {
    const [configs, providers] = await Promise.all([this.#config(), readCustomProviders(this.#agentDir(), this.dir)]);
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    const ids = [...byId.keys(), ...Object.keys(configs).filter((id) => !byId.has(id)).sort()];
    const views = await Promise.all(ids.map((id) => this.#view(id, configs[id], byId.get(id), true)));
    return { providers: views };
  }

  async save(id: string, input: unknown): Promise<LocalProvider> {
    if (!isProviderId(id)) throw new LocalProviderInputError("Unknown local provider.");
    if (!isRecord(input)) throw new LocalProviderInputError("Enter a start command.");
    const unknown = Object.keys(input).filter((key) => !["startCommand", "healthUrl", "readyTimeoutMs"].includes(key));
    if (unknown.length) throw new LocalProviderInputError(`Unknown field: ${unknown[0]}`);
    const startCommand = checkedCommand(input["startCommand"]);
    const healthUrl = checkedHealthUrl(input["healthUrl"]);
    const readyTimeoutMs = checkedTimeout(input["readyTimeoutMs"]);
    const providers = await readCustomProviders(this.#agentDir(), this.dir);
    const provider = providers.find((entry) => entry.id === id);
    if (!provider) throw new LocalProviderInputError("Add this provider to PI's models.json first.");
    const configs = { ...await this.#config() };
    configs[id] = { startCommand, ...(healthUrl === undefined ? {} : { healthUrl }), readyTimeoutMs };
    await writeLocalProviderConfigs(configs, this.dir);
    this.#configs = Promise.resolve(configs);
    // A changed command invalidates the old failure; reachability is checked again.
    if (!this.isStarting(id)) this.#states.delete(id);
    this.#probes.delete(id);
    this.#names.set(id, provider.name);
    return this.#view(id, configs[id], provider, true);
  }

  async remove(id: string): Promise<void> {
    if (!isProviderId(id)) throw new LocalProviderInputError("Unknown local provider.");
    const configs = { ...await this.#config() };
    if (!Object.hasOwn(configs, id)) throw new LocalProviderInputError("No start command is saved for this provider.");
    delete configs[id];
    await writeLocalProviderConfigs(configs, this.dir);
    this.#configs = Promise.resolve(configs);
    this.#probes.delete(id);
    if (!this.isStarting(id)) this.#states.delete(id);
  }

  /** Runs the saved command unless the server already answers. Returns at once with the starting state; the start
   * continues in the background and the next snapshot reports how it ended. */
  async start(id: string): Promise<LocalProvider> {
    if (!isProviderId(id)) throw new LocalProviderInputError("Unknown local provider.");
    const config = (await this.#config())[id];
    if (!config) throw new LocalProviderInputError("Set a start command first.");
    const providers = await readCustomProviders(this.#agentDir(), this.dir);
    const provider = providers.find((entry) => entry.id === id);
    this.#names.set(id, provider?.name ?? id);
    if (this.isStarting(id)) return this.#view(id, config, provider, false);
    const state: RuntimeState = { status: "starting", message: "Starting the server…", checkedAt: Date.now() };
    this.#states.set(id, state);
    this.#probes.delete(id);
    const done = this.#run(config, provider, state).finally(() => {
      if (this.#states.get(id) === state) state.done = undefined;
      this.#probes.delete(id);
    });
    state.done = done;
    void done.catch(() => {});
    return this.#view(id, config, provider, false);
  }

  async #view(id: string, config: LocalProviderConfig | undefined, provider: PiProvider | undefined, probe: boolean): Promise<LocalProvider> {
    const state = this.#states.get(id);
    const endpoint = endpointOf(config?.healthUrl, provider);
    let status = state?.status ?? "unknown";
    let message = state?.message;
    let checkedAt = state?.checkedAt;
    if (status !== "starting") {
      if (!endpoint) {
        message ??= "Set a health URL, or a baseUrl for this provider in PI's models.json, to check the server.";
      } else if (probe) {
        const reachable = await this.#probe(id, endpoint);
        checkedAt = Date.now();
        if (reachable) {
          status = "online";
          message = undefined;
        } else if (status !== "failed") {
          status = "offline";
          message = "The server did not answer.";
        }
      }
    }
    return {
      id,
      name: provider?.name ?? this.#names.get(id) ?? id,
      models: provider?.models ?? 0,
      inPi: provider !== undefined,
      hasEndpoint: endpoint !== undefined,
      configured: config !== undefined,
      status,
      ...(message === undefined ? {} : { message }),
      ...(checkedAt === undefined ? {} : { checkedAt }),
      ...(config === undefined ? {} : {
        startCommand: config.startCommand,
        ...(config.healthUrl === undefined ? {} : { healthUrl: config.healthUrl }),
        readyTimeoutMs: config.readyTimeoutMs,
      }),
    };
  }

  async #probe(id: string, url: string): Promise<boolean> {
    const cached = this.#probes.get(id);
    if (cached && Date.now() - cached.at < PROBE_CACHE_MS) return cached.reachable;
    const reachable = await responds(url);
    this.#probes.set(id, { at: Date.now(), reachable });
    return reachable;
  }

  async #run(config: LocalProviderConfig, provider: PiProvider | undefined, state: RuntimeState): Promise<void> {
    const endpoint = endpointOf(config.healthUrl, provider);
    if (endpoint && await responds(endpoint)) {
      this.#settle(state, "online");
      return;
    }
    const child = startCommand(config.startCommand);
    let output = "";
    const capture = (chunk: Buffer) => {
      if (output.length >= OUTPUT_LIMIT) return;
      output += chunk.toString("utf8").slice(0, OUTPUT_LIMIT - output.length);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let spawnError: string | undefined;
    child.once("exit", (code, signal) => { exit = { code, signal }; });
    child.once("error", (error) => { spawnError = error.message; exit = { code: null, signal: null }; });
    const deadline = Date.now() + config.readyTimeoutMs;
    let failed: string | undefined;
    try {
      for (;;) {
        if (spawnError) {
          failed = `The start command could not run: ${spawnError}`;
          break;
        }
        if (exit && (exit.code !== 0 || exit.signal)) {
          const detail = lastLine(output);
          failed = `The start command ${exit.signal ? `stopped (${exit.signal})` : `exited with code ${exit.code}`}.${detail ? ` ${detail}` : ""}`;
          break;
        }
        if (endpoint && await responds(endpoint, Math.min(PROBE_TIMEOUT_MS, Math.max(250, deadline - Date.now())))) {
          this.#settle(state, "online");
          return;
        }
        if (!endpoint && exit) {
          this.#settle(state, "unknown", "The start command finished. Set a health URL to confirm the server is ready.");
          return;
        }
        if (Date.now() >= deadline) {
          failed = endpoint
            ? `The server did not answer within ${Math.round(config.readyTimeoutMs / 1000)} s.`
            : `The start command did not finish within ${Math.round(config.readyTimeoutMs / 1000)} s.`;
          break;
        }
        await delay(Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
      }
    } catch (error) {
      failed = error instanceof Error ? error.message : "The start command failed.";
    } finally {
      if (failed) terminate(child);
      // A failed start must not keep this process alive for its pipes alone.
      if (child.exitCode === null && child.signalCode === null && failed) child.unref();
    }
    if (failed) {
      this.#settle(state, "failed", failed);
      throw new Error(failed);
    }
  }

  #settle(state: RuntimeState, status: RuntimeState["status"], message?: string): void {
    state.status = status;
    state.message = message;
    state.checkedAt = Date.now();
  }
}

/** The gateway's local-provider service: commands and reachability in the running process, with names from PI's
 * current models.json. Workers keep their own; only the machine that runs the gateway can run its command. */
export const localProviders = new LocalProviderService({ agentDir: () => resolvePiAgentDir() });
