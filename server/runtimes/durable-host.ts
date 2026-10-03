/**
 * One Pi Durable harness per gateway process.
 *
 * Durable owns conversations, runs, queues and crash recovery in a single
 * SQLite store under HUI's configuration directory. PI keeps owning agent
 * configuration, skills, context files, models and credentials; HUI reads them
 * through PI's SDK, exactly as the PI worker does. The store has one owner at a
 * time, so a lock file refuses a second gateway instead of sharing the database.
 */
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness, UsageDoc, type ConversationId, type EnvTarget, type Extension, type HarnessSettings, type ToolRegistration } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { recordDiagnosticEvent } from "../observability.ts";
import { CONFIG_DIR } from "../paths.ts";
import { resolvePiAgentDir } from "../pi-paths.ts";
import { readHuiSettings } from "../hui-settings.ts";
import { createSessionModelRuntime } from "./hui-models.ts";
import { DurablePrompt, type PromptSettings } from "./durable-prompt.ts";
import { huiDurableTools, type DurableToolInvoker } from "./durable-tools.ts";
import { invokeAgentTool } from "../agent-tools-bridge.ts";

/** Durable APIs take a cancellation context; HUI's own calls are not scoped. */
export const durableContext = BACKGROUND_CONTEXT;

const internal = async <T>(path: string): Promise<T> =>
  await import(new URL(path, import.meta.resolve("@earendil-works/pi-coding-agent")).href) as T;

/** PI's provider HTTP setup. Without its longer idle timeout, long reasoning
 * streams can be cut off by fetch's default body timeout. */
async function configureProviderHttp(settings: SettingsManager): Promise<void> {
  const http = await internal<{ configureHttpDispatcher(timeoutMs?: number): void }>("./core/http-dispatcher.js");
  http.configureHttpDispatcher(settings.getHttpIdleTimeoutMs());
}

/** Harness policy read at every use, so PI settings edits apply to the next turn. */
function harnessSettings(settings: SettingsManager): HarnessSettings {
  return {
    get stream() {
      const provider = settings.getProviderRetrySettings();
      const idle = settings.getHttpIdleTimeoutMs();
      return {
        timeoutMs: provider.timeoutMs ?? (idle === 0 ? 2_147_483_647 : idle),
        maxRetryDelayMs: provider.maxRetryDelayMs,
        ...(provider.maxRetries === undefined ? {} : { maxRetries: provider.maxRetries }),
      };
    },
    get compaction() { return settings.getCompactionSettings(); },
    get retry() { return settings.getRetrySettings(); },
    get steeringMode() { return settings.getSteeringMode(); },
    get followUpMode() { return settings.getFollowUpMode(); },
  };
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** One owner per store: Durable has no cross-process locking of its own. */
function acquireStoreLock(path: string): () => void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try { if (readFileSync(path, "utf8").trim() === String(process.pid)) unlinkSync(path); } catch { /* already gone */ }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(readFileSync(path, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) {
        throw new Error(pid === process.pid
          ? "The Durable session store is already open in this process."
          : `The Durable session store is already open in another HUI gateway (pid ${pid}).`);
      }
      try { unlinkSync(path); } catch { /* raced with another cleanup */ }
    }
  }
  throw new Error("The Durable session store could not be locked.");
}

/** Model reads go to the runtime current at each use, so provider changes
 * made in Settings reach running conversations at their next request. */
class CurrentModels {
  target: Models | undefined;
  readonly view = new Proxy({} as Models, {
    get: (_unused, key) => {
      const target = this.target;
      if (!target) throw new Error("Durable models are not loaded yet.");
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export type DurableHostOptions = {
  /** Directory holding `harness.sqlite` and its lock. */
  dir: string;
  /** PI agent directory: settings, skills, models.json, auth. */
  agentDir: string;
  readSettings?: () => Promise<PromptSettings>;
  /** In-process HUI agent tool handler; defaults to the gateway's bridge handler. */
  invokeTool?: DurableToolInvoker;
  /** HUI session for a conversation nobody has reopened since a restart. */
  lookupCaller?: (conversationId: ConversationId) => Promise<string | undefined>;
};

/** Registry fallback: the HUI session whose resume reference names this conversation. */
async function registryCaller(conversationId: ConversationId): Promise<string | undefined> {
  const { readRegistry } = await import("../sessions.ts");
  const reference = `durable:${conversationId}`;
  return (await readRegistry()).find((record) => record.piSessionFile === reference)?.id;
}

export class DurableHost {
  readonly dir: string;
  readonly agentDir: string;
  readonly prompt: DurablePrompt;
  readonly settings: () => Promise<PromptSettings>;
  #invokeTool: DurableToolInvoker;
  #lookupCaller: (conversationId: ConversationId) => Promise<string | undefined>;
  #tools: Extension;
  #models = new CurrentModels();
  #envs = new Map<string, NodeExecutionEnv>();
  /** Durable conversation → HUI session, the only caller identity HUI tools accept. */
  #callers = new Map<ConversationId, string>();
  #opening: Promise<Harness> | undefined;
  #harness: Harness | undefined;
  #release: (() => void) | undefined;

  constructor(options: DurableHostOptions) {
    this.dir = options.dir;
    this.agentDir = options.agentDir;
    this.settings = options.readSettings ?? readHuiSettings;
    this.prompt = new DurablePrompt(options.agentDir, this.settings);
    this.#invokeTool = options.invokeTool ?? invokeAgentTool;
    this.#lookupCaller = options.lookupCaller ?? registryCaller;
    this.#tools = huiDurableTools({
      invoke: async (conversationId, action, params) => {
        const callerSessionId = this.#callers.get(conversationId) ?? await this.#lookupCaller(conversationId);
        if (!callerSessionId) throw new Error("HUI agent tools are unavailable for this conversation.");
        this.#callers.set(conversationId, callerSessionId);
        return this.#invokeTool({ callerSessionId, action, params });
      },
    });
  }

  /** Names of the HUI-owned tools, for inspection labels. */
  get huiToolNames(): readonly string[] {
    return (this.#tools.tools ?? []).map((tool) => tool.name);
  }

  /** HUI tool registrations by name, for per-conversation tool selection. */
  toolsNamed(names: readonly string[]): ToolRegistration[] {
    return (this.#tools.tools ?? []).filter((tool) => names.includes(tool.name)) as ToolRegistration[];
  }

  get models(): Models { return this.#models.view; }
  get isOpen(): boolean { return this.#harness !== undefined; }

  /** Opens the store once and resumes every interrupted run in it. */
  open(): Promise<Harness> {
    this.#opening ??= this.#open().catch((error: unknown) => {
      this.#opening = undefined;
      throw error;
    });
    return this.#opening;
  }

  async #open(): Promise<Harness> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    this.#release = acquireStoreLock(join(this.dir, "harness.lock"));
    try {
      const settings = SettingsManager.create(this.agentDir, this.agentDir);
      await configureProviderHttp(settings);
      this.#models.target = await createSessionModelRuntime(this.agentDir);
      const registry = createRegistry();
      registry.install(CodingTools);
      registry.install(this.#tools);
      registry.install(this.prompt.extension);
      const harness = await Harness.open(await openNodeSqliteStorage(join(this.dir, "harness.sqlite")), {
        models: this.#models.view,
        registry,
        settings: harnessSettings(settings),
        env: (target) => this.#env(target),
        onReport: (error) => recordDiagnosticEvent({
          area: "runtime", level: "warning", action: "durable_report",
          summary: "Durable harness reported a recoverable failure",
          detail: error instanceof Error ? error.message : String(error),
        }),
      }, durableContext);
      this.#harness = harness;
      // Unfinished generations and tool calls continue now, even before any
      // browser reopens their session.
      harness.resume();
      return harness;
    } catch (error) {
      this.#release?.();
      this.#release = undefined;
      throw error;
    }
  }

  #env({ cwd }: EnvTarget): NodeExecutionEnv {
    const directory = cwd ?? this.agentDir;
    let env = this.#envs.get(directory);
    if (!env) {
      env = new NodeExecutionEnv({ cwd: directory });
      this.#envs.set(directory, env);
    }
    return env;
  }

  /** Re-read HUI and PI provider configuration for the next model request. */
  async refreshModels(): Promise<void> {
    this.#models.target = await createSessionModelRuntime(this.agentDir);
  }

  bindCaller(conversationId: ConversationId, huiSessionId: string | undefined): void {
    if (huiSessionId) this.#callers.set(conversationId, huiSessionId);
  }

  /** A fork answers to the same HUI session as the conversation it came from. */
  bindCallerLike(source: ConversationId, target: ConversationId): void {
    const caller = this.#callers.get(source);
    if (caller) this.#callers.set(target, caller);
  }

  /** Spend Durable recorded for one conversation, per model; undefined when
   * this process does not own the store. */
  async conversationUsage(conversationId: ConversationId): Promise<{ models?: Record<string, Record<string, unknown>> } | undefined> {
    const harness = this.#harness;
    if (!harness) return undefined;
    return harness.commit(async (tx) => JSON.parse(JSON.stringify(await tx.doc(UsageDoc, conversationId))) as { models?: Record<string, Record<string, unknown>> }, durableContext);
  }

  /** Closing records no outcome: running work resumes when the store reopens. */
  async close(): Promise<void> {
    const opening = this.#opening;
    this.#opening = undefined;
    const harness = this.#harness ?? await opening?.catch(() => undefined);
    this.#harness = undefined;
    try {
      await harness?.close(durableContext);
      const envs = [...this.#envs.values()];
      this.#envs.clear();
      for (const env of envs) await env.cleanup(durableContext);
    } finally {
      this.#release?.();
      this.#release = undefined;
      this.#callers.clear();
    }
  }
}

export const DURABLE_DIR = process.env["HUI_DURABLE_DIR"] || join(CONFIG_DIR, "durable");

let defaultHost: DurableHost | undefined;

/** The gateway's store: HUI's configuration directory and PI's agent directory. */
export function durableHost(): DurableHost {
  defaultHost ??= new DurableHost({ dir: DURABLE_DIR, agentDir: resolvePiAgentDir() });
  return defaultHost;
}
