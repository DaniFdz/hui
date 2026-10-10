/**
 * One Pi Durable harness per gateway process.
 *
 * Durable owns conversations, runs, queues and crash recovery in a single
 * SQLite store under HUI's configuration directory. PI keeps owning agent
 * configuration, skills, context files, extensions, models and credentials; HUI
 * reads them through PI's SDK, exactly as the PI worker does. The store has one
 * owner at a time, so a lock file refuses a second gateway instead of sharing
 * the database.
 */
import { randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { CompactionTask, createRegistry, defineExtension, GenerationTask, Harness, hook, UsageDoc, type Conversation, type ConversationId, type EnvTarget, type Extension, type HarnessSettings, type HookApi, type Registry, type ToolRegistration } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { SettingsManager, type ModelRuntime, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import { recordDiagnosticEvent } from "../observability.ts";
import { CONFIG_DIR } from "../paths.ts";
import { resolvePiAgentDir } from "../pi-paths.ts";
import { readHuiSettings } from "../hui-settings.ts";
import { createSessionModelRuntime } from "./hui-models.ts";
import { DurablePrompt, type PromptSettings } from "./durable-prompt.ts";
import { huiDurableTools, type DurableToolInvoker } from "./durable-tools.ts";
import type { Contribution, DurableExtensions, ExtensionHost } from "./durable-extensions.ts";
import { OptChatManager, type OptChatTuning } from "./durable-optchat.ts";
import { conversationBot, conversationBotState, huiBotsExtensions, type BotAccess, type BotSoulHost, type BotState } from "./durable-bots.ts";
import { botAccessParts, botMayCall, builtinOffer, type BotChat, type OfferedTool } from "./durable-bot-access.ts";
import { botRoutinesTool } from "./durable-bot-routines.ts";
import { botSkillsDir } from "../bot-skills.ts";
import { invokeAgentTool } from "../agent-tools-bridge.ts";

/** Durable APIs take a cancellation context; HUI's own calls are not scoped. */
export const durableContext = BACKGROUND_CONTEXT;
/** Longest interrupted runs wait for their sessions to load their PI extensions again before they resume anyway. */
const RESUME_WAIT_MS = 30_000;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// PI's `configureHttpDispatcher` is deliberately not installed: it replaces
// `globalThis.fetch` for the whole process, and the harness shares the gateway
// with every other HUI subsystem. Provider requests use Node's fetch, whose
// 5-minute body timeout matches PI's default HTTP idle timeout.

/** Harness policy read at every use, so PI settings edits apply to the next turn. `extensions` is the default
 * selection: each session's PI extensions are installed beside it and only that session's conversation adds them. */
function harnessSettings(settings: SettingsManager, extensions: readonly Extension[]): HarnessSettings {
  return {
    extensions,
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

/** HUI's provider identity (docs/api.md): a PI provider header may interpolate
 * `${PI_CLIENT_SESSION_ID}`. A PI worker has it in its environment; Durable
 * requests run in the gateway, so each carries its own in the request `env`. */
const CLIENT_SESSION_ENV = "PI_CLIENT_SESSION_ID";
/** pi-ai model calls whose third argument is the request options. */
const REQUEST_CALLS = new Set<PropertyKey>(["stream", "streamSimple", "complete", "completeSimple", "streamDeferred", "fetchDeferred", "cancelDeferred"]);
type ProviderResponse = { status: number; headers: Record<string, string> };
type RequestCallbacks = {
  onPayload?: (payload: unknown, model: unknown) => unknown;
  onResponse?: (response: ProviderResponse, model: unknown) => void | Promise<void>;
};
type RequestOptions = ({ readonly signal?: AbortSignal; readonly env?: Readonly<Record<string, string>>; readonly maxTokens?: number; readonly reasoning?: string } & RequestCallbacks) | undefined;

/** Model reads go to the runtime current at each use, so provider changes
 * made in Settings reach running conversations at their next request. Every
 * request also resolves provider configuration with `requestEnv`'s values and
 * runs the provider callbacks of its session's PI extensions. */
class CurrentModels {
  target: Models | undefined;
  readonly view: Models;

  constructor(requestEnv: (options: RequestOptions) => Record<string, string>, callbacks: (options: RequestOptions) => RequestCallbacks) {
    this.view = new Proxy({} as Models, {
      get: (_unused, key) => {
        const target = this.target;
        if (!target) throw new Error("Durable models are not loaded yet.");
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        const call = value as (...args: unknown[]) => unknown;
        if (!REQUEST_CALLS.has(key)) return call.bind(target);
        return (...args: unknown[]) => {
          const given = args[2] as RequestOptions;
          const { maxTokens: _cap, ...uncapped } = given ?? {};
          // Durable caps only its summary request, at 0.8 × reserveTokens, and adaptive and effort-based models spend
          // their thinking from that cap: at high levels the summary stops on `length` and the compaction fails
          // (earendil-works/pi#9075). A request that reasons gets the model's output cap, which pi-ai still fits into
          // the free context window, as an ordinary turn does.
          const options = given?.reasoning ? uncapped : given;
          // Only Durable's own requests are attributed, and they bring no callbacks of their own.
          args[2] = { ...callbacks(options), ...options, env: { ...requestEnv(options), ...options?.env } };
          return call.apply(target, args);
        };
      },
    });
  }
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
  /** Resume interrupted runs when the store opens (default). `hui doctor` opens it without running any work. */
  resume?: boolean;
  /** OptChat constants a test changes (docs/optchat.md). */
  optchat?: OptChatTuning;
  /**
   * HUI's utility model (Settings → Models), the memory compactor's model where a memory names none: a bot's utility
   * model defaults to it (HUI-18). Defaults to HUI's settings unless `readSettings` is given.
   */
  utilityModel?: () => Promise<string | undefined>;
  /**
   * HUI tools that act on another machine, which this host's sessions reach through a bridge that refuses them: a
   * worker host passes `GATEWAY_ONLY_TOOLS`, the gateway none. A bot's chat here isn't offered them, so its model never
   * calls them, `request_access` can't ask for them and the operator's catalog doesn't list them. Other sessions here
   * are offered them as before, and the bridge refuses them.
   */
  gatewayOnlyTools?: readonly string[];
};

/** Registry fallback: the HUI session whose resume reference names this conversation. */
export async function registryCaller(conversationId: ConversationId): Promise<string | undefined> {
  const { readRegistry } = await import("../sessions.ts");
  const reference = `durable:${conversationId}`;
  // A worker's `durable:N` names a conversation in that worker's own store.
  return (await readRegistry()).find((record) => record.piSessionFile === reference && !record.worker)?.id;
}

export class DurableHost implements ExtensionHost {
  readonly dir: string;
  readonly agentDir: string;
  readonly prompt: DurablePrompt;
  readonly settings: () => Promise<PromptSettings>;
  /** HUI tools a bot's chat here is never offered: they act on another machine (`DurableHostOptions.gatewayOnlyTools`). */
  readonly gatewayOnlyTools: readonly string[];
  /** OptChat memories of the conversations that enable it; a no-op for every other conversation. */
  readonly optchat: OptChatManager;
  #invokeTool: DurableToolInvoker;
  #lookupCaller: (conversationId: ConversationId) => Promise<string | undefined>;
  #tools: Extension;
  /** The `bots`, `bot_access` and `soul` sections (inert outside bots' chats), and the tools only bots' chats select:
   * `message_bot`, `write_soul`, `set_profile`, `request_access`, `load_skill` and `routines` (`durable-bots.ts`,
   * `durable-bot-access.ts`, `durable-bot-routines.ts`). */
  #bots: { section: Extension; tools: Extension };
  /** The `bots` section of a bot's chat; the gateway sets it, a worker host leaves it unset. */
  botSection: ((botId: string) => Promise<string | undefined>) | undefined;
  /** Where bots' SOUL.md files are on this host, for the `soul` section; the gateway sets it (each bot's home folder in
   * HUI's configuration), a host without one leaves the section out. */
  botSouls: BotSoulHost | undefined;
  /** Mirrors a bot's lists into the gateway's roster after the operator allowed one of its requests; a worker host
   * leaves it unset. */
  botAccessRecorded: ((botId: string, access: BotAccess) => Promise<void>) | undefined;
  /** Live sessions that answer for their conversation: a bot's own tools ask the operator through them. */
  #chats = new Set<BotChat & { conversation(): Conversation }>();
  /** Access requests waiting for a conversation's chat to open again (`whenChat`), and the chats that can take them. */
  #chatWaiters = new Set<{ conversationId: ConversationId; resolve(chat: BotChat): void }>();
  #readyChats = new WeakSet<BotChat>();
  #models = new CurrentModels((options) => this.#requestEnv(options), (options) => this.#requestCallbacks(options));
  #registry: Registry = createRegistry();
  /** Each live session's PI extensions, by HUI session. */
  #extensions = new Map<string, DurableExtensions>();
  /** Each attributed request's identity, by its task invocation's abort signal. */
  #requestIdentities = new WeakMap<AbortSignal, string>();
  /** Each attributed request's HUI session, for its PI extensions' provider callbacks. */
  #requestSessions = new WeakMap<AbortSignal, string>();
  /** One identity per HUI session for this gateway run, as one PI worker each would have. */
  #clientSessions = new Map<string, string>();
  /** For a request no hook attributed, such as a summary resumed after a restart. */
  #unattributedClientSession = randomUUID();
  /** Attributes generation and compaction requests to their conversation's HUI session. */
  #identity = defineExtension({
    name: "hui-request-identity",
    hooks: [
      hook(GenerationTask, { beforeRequest: (_request, api) => this.#attribute(api) }),
      hook(CompactionTask, { beforeCompact: (_compaction, api) => this.#attribute(api) }),
    ],
  });
  #envs = new Map<string, NodeExecutionEnv>();
  /** Durable conversation → HUI session, the only caller identity HUI tools accept. */
  #callers = new Map<ConversationId, string>();
  /** The current open, settled or not; a close takes it. */
  #opening: Promise<Harness> | undefined;
  /** The latest close, until it has released the store. */
  #closing: Promise<void> | undefined;
  #harness: Harness | undefined;
  #release: (() => void) | undefined;
  #resume: boolean;
  /**
   * Reopens the sessions of the conversations whose work resumes once the store opens. Their runs resume after it
   * settles (at most `RESUME_WAIT_MS`), so each finds its session's PI extensions installed: a tool call they make
   * otherwise finds no tool. Absent, they resume at once.
   */
  beforeResume: ((conversations: readonly ConversationId[]) => Promise<unknown>) | undefined;
  #resumed = deferred();

  constructor(options: DurableHostOptions) {
    this.dir = options.dir;
    this.agentDir = options.agentDir;
    this.#resume = options.resume !== false;
    this.settings = options.readSettings ?? readHuiSettings;
    this.gatewayOnlyTools = options.gatewayOnlyTools ?? [];
    this.optchat = new OptChatManager({
      dir: options.dir, models: () => this.models,
      // A bot's utility model defaults to Settings' (HUI-18): memory summaries are quick work.
      ...(options.utilityModel ? { utilityModel: options.utilityModel }
        : options.readSettings ? {} : { utilityModel: async () => (await readHuiSettings()).models.utility || undefined }),
      ...(options.optchat ? { tuning: options.optchat } : {}),
    });
    this.prompt = new DurablePrompt(options.agentDir, this.settings);
    this.prompt.extras = (conversationId) => {
      const extensions = this.#extensionsOf(conversationId);
      if (!extensions) return undefined;
      const run = extensions.runPrompt();
      return { contributions: extensions.contributions(), ...(run ? { run } : {}) };
    };
    this.#invokeTool = options.invokeTool ?? invokeAgentTool;
    this.#lookupCaller = options.lookupCaller ?? registryCaller;
    const invoke = (conversationId: ConversationId, action: string, params: Record<string, unknown>, signal?: AbortSignal) =>
      this.#invokeAs(conversationId, action, params, signal);
    this.#tools = huiDurableTools({ invoke });
    const access = botAccessParts({
      chat: (conversationId) => this.chatFor(conversationId),
      whenChat: (conversationId, signal) => this.whenChat(conversationId, signal),
      skills: async (cwd, conversationId) => (await this.prompt.loader(cwd, conversationId === undefined ? [] : await this.skillDirsFor(conversationId))).getSkills().skills,
      agentDir: this.agentDir,
      gatewayOnly: this.gatewayOnlyTools,
      recorded: async (botId, lists) => { await this.botAccessRecorded?.(botId, lists); },
      report: (step, error) => recordDiagnosticEvent({
        area: "runtime", level: "warning", action: step === "roster" ? "bot_access_mirror_failed" : "bot_access_offer_failed",
        summary: step === "roster"
          ? "A bot's chat turned tools back on that HUI's roster does not show yet"
          : "A bot's chat turned tools back on, but its tool offer was not refreshed",
        detail: error instanceof Error ? error.message : String(error),
      }),
    });
    this.#bots = huiBotsExtensions({
      chat: (conversationId) => this.chatFor(conversationId),
      invoke, section: async (botId) => this.botSection?.(botId), souls: () => this.botSouls,
      tools: [...access.tools, botRoutinesTool({ invoke })], sections: access.sections,
    });
    // A bot's chat lists only the skills the operator left on, its own among them.
    this.prompt.disabledSkillsFor = async (conversationId) => (await this.botStateFor(conversationId))?.disabledSkills;
    this.prompt.skillDirsFor = (conversationId) => this.skillDirsFor(conversationId);
  }

  /** HUI's agent-tool handler, called as the HUI session bound to the conversation. A bot's chat may not call a HUI tool
   * the operator turned off, whatever it was offered: the bridge checks the bot's document itself. `signal` is the tool
   * call's own abort (Stop), which the handler sees as a PI child's dropped call. A call from a bot's chat carries who
   * brought each input of its run, as the live chat here saw them (`runOrigins`): the gateway's gated tools judge the
   * run by all of them. Without a live chat here, or when its store can't be read, it carries none, and they judge the
   * message that started the run alone. */
  async #invokeAs(conversationId: ConversationId, action: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const bot = await this.botStateFor(conversationId);
    if (bot && !botMayCall(bot, action)) {
      throw new Error(`The operator turned off ${action} in this bot's chat. Ask for it with request_access if the job needs it.`);
    }
    const callerSessionId = this.#callers.get(conversationId) ?? await this.#lookupCaller(conversationId);
    if (!callerSessionId) throw new Error("HUI agent tools are unavailable for this conversation.");
    this.#callers.set(conversationId, callerSessionId);
    const runOrigins = bot ? await this.chatFor(conversationId)?.runOrigins().catch(() => undefined) : undefined;
    return this.#invokeTool({ callerSessionId, action, params, ...(signal ? { signal } : {}), ...(runOrigins ? { runOrigins } : {}) });
  }

  /** Names of the HUI-owned tools, for inspection labels. */
  get huiToolNames(): readonly string[] {
    return [...this.#tools.tools ?? [], ...this.#bots.tools.tools ?? []].map((tool) => tool.name);
  }

  /** Tools only bots' chats are offered. */
  get botTools(): readonly ToolRegistration[] { return this.#bots.tools.tools ?? []; }

  /** The extension carrying `message_bot` and a bot's own tools when the conversation is a bot's chat; its session
   * selects it. */
  async botToolsFor(conversationId: ConversationId): Promise<Extension | undefined> {
    const harness = this.#harness;
    return harness && await conversationBot(harness, conversationId, durableContext) ? this.#bots.tools : undefined;
  }

  /** The bot document of a bot's chat; undefined for every other conversation, or before the store opens. */
  async botStateFor(conversationId: ConversationId): Promise<BotState | undefined> {
    const harness = this.#harness;
    return harness ? conversationBotState(harness, conversationId, durableContext) : undefined;
  }

  /** A bot's own skill folder (`skills/` in its home on this host, `bot-skills.ts`), which only its chat loads, once it exists
   * (PI's loader warns about a missing one); none for every other conversation, or on a host that keeps no bots' homes. */
  async skillDirsFor(conversationId: ConversationId): Promise<readonly string[]> {
    const bot = await this.botStateFor(conversationId);
    const home = bot ? this.botSouls?.home(bot.bot) : undefined;
    const dir = home ? botSkillsDir(home) : undefined;
    return dir && await stat(dir).then((info) => info.isDirectory(), () => false) ? [dir] : [];
  }

  /** A live session answers for its conversation while it is open. */
  trackChat(chat: BotChat & { conversation(): Conversation }): void { this.#chats.add(chat); }

  /** A tracked chat has offered its tools (`applyTools`): it knows what the operator turned off, so an access request
   * waiting for it (`whenChat`) can ask there now. */
  chatReady(chat: BotChat & { conversation(): Conversation }): void {
    if (!this.#chats.has(chat)) return;
    this.#readyChats.add(chat);
    for (const waiter of [...this.#chatWaiters]) {
      if (waiter.conversationId === chat.conversation().id) waiter.resolve(chat);
    }
  }
  untrackChat(chat: BotChat & { conversation(): Conversation }): void { this.#chats.delete(chat); }

  /** The tools every bot's chat has before extensions that the operator can turn off: what a chat that isn't running
   * here is checked against. Never the ones that act on another machine (`gatewayOnlyTools`). */
  builtinBotOffer(): OfferedTool[] {
    return builtinOffer(this.codingTools, this.huiTools.filter((tool) => !this.gatewayOnlyTools.includes(tool.name)), this.botTools);
  }

  /** The live session following the conversation now; a rewind moves a session to its fork. */
  chatFor(conversationId: ConversationId): BotChat | undefined {
    for (const chat of this.#chats) if (chat.conversation().id === conversationId) return chat;
    return undefined;
  }

  /** The conversation's live session once one is open and has offered its tools; rejects once `signal` aborts. */
  whenChat(conversationId: ConversationId, signal?: AbortSignal): Promise<BotChat> {
    const open = this.chatFor(conversationId);
    if (open && this.#readyChats.has(open)) return Promise.resolve(open);
    return new Promise((resolve, reject) => {
      const stop = () => {
        this.#chatWaiters.delete(waiter);
        reject(signal?.reason instanceof Error ? signal.reason : new Error("Stopped waiting for the chat."));
      };
      const waiter = {
        conversationId,
        resolve: (chat: BotChat) => { this.#chatWaiters.delete(waiter); signal?.removeEventListener("abort", stop); resolve(chat); },
      };
      if (signal?.aborted) return stop();
      signal?.addEventListener("abort", stop, { once: true });
      this.#chatWaiters.add(waiter);
    });
  }

  /** HUI tool registrations by name, for per-conversation tool selection. */
  toolsNamed(names: readonly string[]): ToolRegistration[] {
    return (this.#tools.tools ?? []).filter((tool) => names.includes(tool.name)) as ToolRegistration[];
  }

  /** Settles once the open store schedules work. */
  get resumed(): Promise<void> { return this.#resumed.promise; }
  get models(): Models { return this.#models.view; }
  /** PI's model runtime, current at each use, for extensions' `ctx.modelRegistry`. */
  get modelRuntime(): ModelRuntime { return this.#models.view as unknown as ModelRuntime; }
  get isOpen(): boolean { return this.#harness !== undefined; }

  /** Whether the open store has work to do: queued input or a task that can
   * run. A background compaction, or a task this build cannot run, is not. */
  async busy(): Promise<boolean> {
    if (!this.#harness) return false;
    const { tasks, submissions } = await this.#harness.inspect(durableContext);
    return submissions.length > 0 || tasks.some((task) => !task.record.background && task.state.kind !== "blocked");
  }

  get codingTools(): readonly ToolRegistration[] { return CodingTools.tools ?? []; }
  get huiTools(): readonly ToolRegistration[] { return this.#tools.tools ?? []; }

  install(extension: Extension): void { this.#registry.install(extension); }
  /** Removes `extension` itself; a replacement installed under its name since stays. */
  uninstall(extension: Extension): void {
    if (this.#registry.snapshot().extension(extension.name) === extension) this.#registry.uninstall(extension);
  }
  resources(cwd: string): Promise<ResourceLoader> { return this.prompt.loader(cwd); }
  promptOptions(cwd: string, selectedTools: readonly string[], contributions: Record<string, Contribution>) {
    return this.prompt.options(cwd, selectedTools, contributions);
  }
  lastPrompt(conversation: Conversation): string { return this.prompt.lastPrompt(conversation.id); }

  /** Tracks a session's PI extensions while it is live, so its requests reach them. */
  attachExtensions(huiSessionId: string, extensions: DurableExtensions): void {
    this.#extensions.set(huiSessionId, extensions);
  }

  detachExtensions(huiSessionId: string, extensions: DurableExtensions): void {
    if (this.#extensions.get(huiSessionId) === extensions) this.#extensions.delete(huiSessionId);
  }

  #extensionsOf(conversationId: ConversationId): DurableExtensions | undefined {
    const caller = this.#callers.get(conversationId);
    return caller === undefined ? undefined : this.#extensions.get(caller);
  }

  /** Opens the store once and resumes every interrupted run in it. A close
   * still running finishes first, so the store is released before it reopens. */
  open(): Promise<Harness> {
    if (!this.#opening) {
      const closing = this.#closing;
      const opening: Promise<Harness> = (closing ? closing.catch(() => undefined).then(() => this.#open()) : this.#open())
        .catch((error: unknown) => {
          if (this.#opening === opening) this.#opening = undefined;
          throw error;
        });
      this.#opening = opening;
    }
    return this.#opening;
  }

  async #open(): Promise<Harness> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    this.#release = acquireStoreLock(join(this.dir, "harness.lock"));
    try {
      const settings = SettingsManager.create(this.agentDir, this.agentDir);
      this.#models.target = await createSessionModelRuntime(this.agentDir);
      // OptChat's hooks come before every session's PI extensions: its compaction decline is the first decision, and its
      // request is what their context handlers see. OptChat's tools and bots' tools are installed but not in the default
      // selection: only an OptChat conversation, or a bot's chat, adds them.
      const base = [CodingTools, this.#tools, this.prompt.extension, this.#identity, this.optchat.extension, this.#bots.section];
      for (const extension of [...base, this.optchat.toolsExtension, this.#bots.tools]) this.#registry.install(extension);
      const harness = await Harness.open(await openNodeSqliteStorage(join(this.dir, "harness.sqlite")), {
        models: this.#models.view,
        registry: this.#registry,
        settings: harnessSettings(settings, base),
        env: (target) => this.#env(target),
        onReport: (error) => recordDiagnosticEvent({
          area: "runtime", level: "warning", action: "durable_report",
          summary: "Durable harness reported a recoverable failure",
          detail: error instanceof Error ? error.message : String(error),
        }),
      }, durableContext);
      this.optchat.attach(harness, { follow: this.#resume });
      this.#harness = harness;
      // Unfinished generations and tool calls continue even before any browser
      // reopens their session. Without it, nothing is scheduled: the store is
      // only read and written in commits.
      if (this.#resume) void this.#resumeWhenReady(harness);
      return harness;
    } catch (error) {
      this.#release?.();
      this.#release = undefined;
      throw error;
    }
  }

  async #resumeWhenReady(harness: Harness): Promise<void> {
    try {
      const reopen = this.beforeResume;
      const conversations = reopen ? [...new Set((await harness.inspect(durableContext)).tasks.map((task) => task.record.conversationId))] : [];
      if (reopen && conversations.length) {
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([reopen(conversations), new Promise((resolve) => { timer = setTimeout(resolve, RESUME_WAIT_MS); })]).finally(() => clearTimeout(timer));
      }
    } catch (error) {
      recordDiagnosticEvent({
        area: "runtime", level: "warning", action: "durable_resume_prepare_failed",
        summary: "Durable resumed interrupted runs before their sessions reopened",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    if (this.#harness !== harness) return;
    harness.resume();
    this.#resumed.resolve();
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

  /** A hook's task runtime is also where its request takes `signal`, so the
   * signal names the HUI session in `#requestEnv`. Durable task phases share one
   * runtime per invocation: a summary request follows its `beforeCompact`. */
  async #attribute(api: HookApi): Promise<undefined> {
    const signal = (api as HookApi & { readonly signal?: AbortSignal }).signal;
    if (!signal) return undefined;
    const conversationId = api.conversationId;
    const caller = this.#callers.get(conversationId) ?? await this.#lookupCaller(conversationId).catch(() => undefined);
    if (caller) {
      this.#callers.set(conversationId, caller);
      this.#requestSessions.set(signal, caller);
    }
    this.#requestIdentities.set(signal, this.#clientSession(caller ?? `conversation:${conversationId}`));
    return undefined;
  }

  /** `before_provider_request` and `after_provider_response` of the request's session; an OptChat turn's cache marks go
   * on the payload those handlers leave. */
  #requestCallbacks(options: RequestOptions): RequestCallbacks {
    const caller = options?.signal ? this.#requestSessions.get(options.signal) : undefined;
    const callbacks = (caller === undefined ? undefined : this.#extensions.get(caller)?.requestCallbacks()) ?? {};
    const marks = options?.signal ? this.optchat.payloadHook(options.signal) : undefined;
    if (!marks) return callbacks;
    return {
      ...callbacks,
      onPayload: async (payload, model) => {
        const replaced = await callbacks.onPayload?.(payload);
        return marks(replaced === undefined ? payload : replaced, model) ?? replaced;
      },
    };
  }

  #clientSession(key: string): string {
    let id = this.#clientSessions.get(key);
    if (!id) {
      id = randomUUID();
      this.#clientSessions.set(key, id);
    }
    return id;
  }

  /** A nonblank gateway value is kept, as for PI workers; otherwise the
   * request's HUI session identity. The gateway environment never changes. */
  #requestEnv(options: RequestOptions): Record<string, string> {
    if (process.env[CLIENT_SESSION_ENV]?.trim()) return {};
    const attributed = options?.signal ? this.#requestIdentities.get(options.signal) : undefined;
    return { [CLIENT_SESSION_ENV]: attributed ?? this.#unattributedClientSession };
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

  /** Closing records no outcome: running work resumes when the store reopens.
   * It settles once the store is released. An open in progress finishes
   * first, and a close called meanwhile shares the one already running. */
  close(): Promise<void> {
    const opening = this.#opening;
    this.#opening = undefined;
    if (!opening) return this.#closing ?? Promise.resolve();
    const closing: Promise<void> = this.#close(opening).finally(() => {
      if (this.#closing === closing) this.#closing = undefined;
    });
    this.#closing = closing;
    return closing;
  }

  async #close(opening: Promise<Harness>): Promise<void> {
    const harness = await opening.catch(() => undefined);
    this.#harness = undefined;
    try {
      await harness?.close(durableContext);
      const envs = [...this.#envs.values()];
      this.#envs.clear();
      for (const env of envs) await env.cleanup(durableContext);
    } finally {
      // Its files are covered by the store lock: closed before the lock is released.
      await this.optchat.close().catch(() => undefined);
      this.#release?.();
      this.#release = undefined;
      this.#callers.clear();
      this.#resumed = deferred();
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
