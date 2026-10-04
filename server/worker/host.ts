/**
 * The remote worker host. One long-lived daemon per remote user runs HUI's own
 * runtime adapters (Pi Durable in-process, PI's SDK worker as a child), so a
 * conversation keeps going while no gateway is attached (a laptop asleep, a
 * gateway restart, a dropped SSH connection).
 *
 * Gateways reach it through a Unix socket that `main.ts connect` bridges to
 * the stdio of whatever command reached this machine, and drive each session
 * through the generic RuntimeSession contract (`session.*` frames). Sessions
 * are keyed by HUI session id; reopening a key reattaches to the running one,
 * whose pending questions travel in its state. Credentials and HUI agent
 * tools are served by whichever gateway is connected; credentials are kept in
 * memory until they expire, never on disk.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { chmod, lstat, mkdir, readdir, readFile, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { registerAgentToolHandler, stopAgentToolBridge } from "../agent-tools-bridge.ts";
import { DurableHost } from "../runtimes/durable-host.ts";
import { durableConversationId, startDurable } from "../runtimes/durable.ts";
import { piRuntime } from "../runtimes/pi.ts";
import type { RuntimeModel, RuntimeQueue, RuntimeQuestion, RuntimeSession, RuntimeUsage, TranscriptEntry } from "../runtimes/types.ts";
import { installBrokeredCredentials, OfflineError, setCredentialTransport } from "./credentials.ts";
import { resolveWorkingDirectory } from "../working-directories.ts";
import { attachPeer, isRecord, PROTOCOL_VERSION, type Peer } from "./protocol.ts";
import { PACKAGE_ROOT } from "./release.ts";
import { BotScheduler, type BotRecord } from "./bots.ts";
import { applySync, planSync, putSyncFiles, writeAtomic, type SyncCommit } from "./sync-apply.ts";
import type { WorkerPaths } from "./paths.ts";

/** Detached, idle sessions are stopped after this; their transcript stays on disk. */
const DETACHED_IDLE_MS = 10 * 60_000;
/** A detached worker waiting on a question keeps it this long for someone to answer. */
const DETACHED_QUESTION_MS = 24 * 60 * 60_000;
const ATTACHMENT_RETENTION_MS = 7 * 24 * 60 * 60_000;
/** A host with nothing to do exits after this, unless it owns bots. */
const HOST_IDLE_MS = 30 * 60_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** A transcript larger than this is fetched in pages instead of riding along
 * with a frame, which could exceed the frame limit or hold up other sessions. */
const TRANSCRIPT_PAGE_BYTES = 8 * 1024 * 1024;

export type HostInfo = {
  version: number;
  release: string;
  pid: number;
  hostname: string;
  platform: string;
  arch: string;
  node: string;
  home: string;
  dataDir: string;
  mirrorDir: string;
  agentDir: string;
  providersDir: string;
  releaseDir: string;
};

/** What a gateway hands over to start a PI worker; paths are already remote. */
export type RemoteLaunch = Record<string, unknown> & {
  cwd: string;
  sessionFile?: string;
  disabledSkills?: { name: string; path: string }[];
};

/** The runtime methods a gateway may call; anything else is refused. */
const CALLS = new Set(["prompt", "steer", "followUp", "abort", "setModel", "setThinking", "respondQuestion", "cancelQuestion",
  "clear", "reload", "compact", "cancelCompaction", "rewind", "continueRun", "listModels", "listCommands", "inspect", "attachmentImage"]);
/** Calls after which the gateway re-reads the whole transcript. */
const TRANSCRIPT_CALLS = new Set(["clear", "rewind", "reload", "abort", "continueRun"]);
/** Events after which the gateway re-reads the whole transcript. */
const TRANSCRIPT_EVENTS = new Set(["settled", "compaction_end"]);

/** Everything a gateway reads synchronously from a runtime, sent with each
 * reply and with every event that changed it, so its copy is never behind the
 * event it is handling. */
export type RemoteState = {
  sessionId: string;
  sessionFile?: string;
  isStreaming: boolean;
  resumesInterruptedRuns: boolean;
  model?: RuntimeModel;
  usage?: RuntimeUsage;
  thinking?: string;
  queue?: RuntimeQueue;
  questions?: readonly RuntimeQuestion[];
  /** Optional runtime methods this session offers. */
  methods: string[];
};

type Hosted = {
  key: string;
  tool: string;
  runtime: RuntimeSession;
  /** A PI runtime started where the last one stopped mid-run: HUI recovers that
   * run, as it would locally, until this one runs again. */
  interrupted: boolean;
  peer?: Peer;
  lastActive: number;
  stop: () => void;
  /** Stamps every state and transcript sent, so the gateway can drop a reply
   * that arrives after newer events. */
  seq: number;
  /** The last state sent to `peer`; an event that leaves it alone carries none. */
  sent?: string;
  /** The transcript being fetched in pages, with the sequence it was taken at. */
  paging?: { seq: number; entries: TranscriptEntry[] };
};

/** Cached gateway credential answers; memory only, dropped at expiry. */
type Cached = { value: unknown; until: number };

function expiry(value: unknown): number {
  const expires = isRecord(value) ? value["expires"] : undefined;
  return typeof expires === "number" ? expires : Infinity;
}

export class WorkerHost {
  readonly paths: WorkerPaths;
  readonly releaseDir = PACKAGE_ROOT;
  #release = basename(PACKAGE_ROOT);
  #sessions = new Map<string, Hosted>();
  #peers = new Set<Peer>();
  /** Starts in progress, so concurrent opens and bot runs share one runtime. */
  #starting = new Map<string, Promise<Hosted>>();
  #server: Server | undefined;
  #timer: NodeJS.Timeout | undefined;
  #lastActivity = Date.now();
  #pruned = 0;
  #bots: BotScheduler;
  #durable: DurableHost;
  /** Durable conversation → HUI session, kept across host restarts. */
  #callers = new Map<string, string>();
  #callersFile: string;
  /** HUI sessions whose PI run started and has not been seen settling, kept
   * across host restarts. Any other PI run finished while nobody watched. */
  #piRuns = new Set<string>();
  #piRunsFile: string;
  /** Host state writes, one at a time so an older one never lands last. */
  #writes: Promise<void> = Promise.resolve();
  #credentials = new Map<string, Cached>();
  #modifiers = new Map<string, (current: unknown) => Promise<unknown>>();
  #nextStep = 0;

  constructor(paths: WorkerPaths) {
    this.paths = paths;
    this.#callersFile = join(paths.stateDir, "conversations.json");
    this.#piRunsFile = join(paths.stateDir, "pi-runs.json");
    this.#bots = new BotScheduler({
      file: join(this.paths.stateDir, "bots.json"),
      launchFile: join(this.paths.stateDir, "launch.json"),
      run: (bot, launch, signal) => this.#runBot(bot, launch, signal),
      onChange: (bots) => { for (const peer of this.#peers) peer.send({ t: "bots", bots }); },
    });
    this.#durable = new DurableHost({
      dir: join(paths.stateDir, "durable"),
      agentDir: paths.agentDir,
      invokeTool: ({ callerSessionId, action, params }) => this.#gatewayTool(callerSessionId, action, params),
      lookupCaller: async (conversationId) => this.#callers.get(String(conversationId)),
    });
  }

  info(): HostInfo {
    return {
      version: PROTOCOL_VERSION, release: this.#release, pid: process.pid, hostname: hostname(),
      platform: process.platform, arch: process.arch, node: process.version, home: this.paths.home,
      dataDir: this.paths.dataDir, mirrorDir: this.paths.mirrorDir, agentDir: this.paths.agentDir,
      providersDir: this.paths.providersDir, releaseDir: this.releaseDir,
    };
  }

  async listen(): Promise<void> {
    await mkdir(this.paths.stateDir, { recursive: true, mode: 0o700 });
    await chmod(this.paths.stateDir, 0o700);
    const socketDir = dirname(this.paths.socket);
    if (socketDir !== this.paths.stateDir) {
      await mkdir(socketDir, { recursive: true, mode: 0o700 });
      const info = await lstat(socketDir);
      // A shared /tmp directory must be ours alone.
      if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error(`Refusing to use ${socketDir}: it is not private to this user.`);
    }
    // HUI agent tools of a PI worker started here reach a connected gateway.
    registerAgentToolHandler(({ callerSessionId, action, params }) => this.#gatewayTool(callerSessionId, action, params));
    installBrokeredCredentials({ agentDir: this.paths.agentDir, providersDir: this.paths.providersDir, fallbackAuth: join(this.paths.fallbackAgentDir, "auth.json") });
    setCredentialTransport((op, store, providerId, modify) => this.#credential(op, store, providerId, modify as ((current: unknown) => Promise<unknown>) | undefined));
    await this.#bots.load();
    await this.#pruneAttachments();
    try {
      const saved = JSON.parse(await readFile(this.#callersFile, "utf8")) as unknown;
      if (isRecord(saved)) for (const [id, key] of Object.entries(saved)) if (typeof key === "string") this.#callers.set(id, key);
    } catch { /* none yet */ }
    try {
      const saved = JSON.parse(await readFile(this.#piRunsFile, "utf8")) as unknown;
      if (Array.isArray(saved)) for (const key of saved) if (typeof key === "string") this.#piRuns.add(key);
    } catch { /* none yet */ }
    // The host lock (main.ts) already makes this the store's only owner; a
    // store lock left by a killed host may name a pid reused since.
    await rm(join(this.#durable.dir, "harness.lock"), { force: true });
    // Durable runs interrupted by a host restart continue now, with nobody watching.
    if (existsSync(join(this.#durable.dir, "harness.sqlite"))) {
      await this.#durable.open().catch((error: unknown) => console.error(`Durable store did not open: ${error instanceof Error ? error.message : String(error)}`));
    }
    this.#server = createServer((socket) => this.#accept(socket));
    await new Promise<void>((resolveListen, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(this.paths.socket, () => { this.#server!.off("error", reject); resolveListen(); });
    });
    await chmod(this.paths.socket, 0o600);
    await writeFile(join(this.paths.stateDir, "release"), this.#release);
    this.#timer = setInterval(() => this.#sweep(), 30_000);
    this.#timer.unref();
    this.#bots.start();
  }

  async close(): Promise<void> {
    clearInterval(this.#timer);
    this.#bots.stop();
    for (const hosted of [...this.#sessions.values()]) this.#stop(hosted);
    for (const peer of this.#peers) peer.close("Remote worker host stopped.");
    stopAgentToolBridge();
    setCredentialTransport(undefined);
    // Running Durable work is recorded, not lost: it resumes on the next start.
    await this.#durable.close().catch(() => undefined);
    await new Promise<void>((done) => this.#server ? this.#server.close(() => done()) : done());
    await unlink(this.paths.socket).catch(() => undefined);
  }

  /** Another gateway still connected, a bot run or a PI run that cannot
   * resume blocks an upgrade; Durable work resumes in the new host. */
  busy(): boolean {
    return this.#peers.size > 1 || this.#bots.running() || [...this.#sessions.values()].some((hosted) => hosted.tool !== "durable"
      && (hosted.runtime.isStreaming || (hosted.runtime.pendingQuestions?.().length ?? 0) > 0));
  }

  #accept(socket: Socket): void {
    const peer = attachPeer(socket, socket);
    peer.keepAlive();
    this.#peers.add(peer);
    this.#touch();
    peer.onClose(() => {
      this.#peers.delete(peer);
      for (const hosted of this.#sessions.values()) if (hosted.peer === peer) hosted.peer = undefined;
      socket.destroy();
    });
    peer.handle("hello", () => this.info());
    peer.handle("session.start", (params) => this.#start(peer, params));
    peer.handle("session.call", (params) => this.#call(params));
    peer.handle("session.transcript", (params) => this.#transcriptPage(params));
    peer.handle("session.dispose", (params) => {
      const hosted = this.#sessions.get(String(params["key"] ?? ""));
      if (hosted && hosted.peer === peer) this.#stop(hosted);
      return { ok: true };
    });
    peer.handle("put-file", (params) => this.#putFile(params));
    peer.handle("get-file", (params) => this.#getFile(params));
    peer.handle("sync-plan", (params) => planSync(this.paths, params["entries"]));
    peer.handle("sync-put", (params) => putSyncFiles(this.paths, params["files"]));
    peer.handle("sync-commit", (params) => applySync(this.paths, params as unknown as SyncCommit).then(async (result) => {
      if (isRecord(params["launch"])) await this.#bots.setLaunch(params["launch"]);
      if (this.#durable.isOpen) await this.#durable.refreshModels().catch(() => undefined);
      return result;
    }));
    peer.handle("credential-step", async (params) => {
      const modify = this.#modifiers.get(String(params["step"] ?? ""));
      if (!modify) throw new Error("That credential update is no longer pending.");
      const next = await modify(params["current"]);
      return next === undefined ? {} : { next };
    });
    peer.handle("forget", (params) => {
      // A deleted HUI session: stop its runtime even if no gateway is attached.
      for (const key of Array.isArray(params["keys"]) ? params["keys"] : []) {
        const hosted = typeof key === "string" ? this.#sessions.get(key) : undefined;
        if (hosted) this.#stop(hosted);
      }
      return { ok: true };
    });
    peer.handle("bots-list", () => this.#bots.list());
    peer.handle("bots-save", (params) => this.#bots.save(params["bot"]));
    peer.handle("bots-delete", (params) => this.#bots.remove(String(params["key"] ?? "")));
    peer.handle("bots-run", (params) => this.#bots.runNow(String(params["key"] ?? "")));
    peer.handle("shutdown", () => {
      if (this.busy()) return { stopping: false };
      setImmediate(() => { void this.close().finally(() => process.exit(0)); });
      return { stopping: true };
    });
  }

  /** Starts or reattaches the runtime for one HUI session. */
  async #start(peer: Peer, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const key = typeof params["key"] === "string" ? params["key"] : "";
    const tool = params["tool"];
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(key) || (tool !== "pi" && tool !== "durable") || !isRecord(params["launch"])) throw new Error("Invalid remote session request.");
    const { hosted, reused } = await this.#hostedFor(key, tool, () => this.#bots.launchFor(key, params["launch"] as RemoteLaunch));
    // The gateway may have gone while the runtime started; leave it running.
    if (peer.closed) throw new Error("The gateway disconnected.");
    // A second gateway (or a reconnect) takes over; the old view ends.
    if (hosted.peer && hosted.peer !== peer) hosted.peer.send({ t: "session.exit", key, message: "This session was opened from another HUI." });
    hosted.peer = peer;
    this.#touch(hosted);
    return { reused, ...this.#snapshot(hosted, true), ...this.#transcript(hosted) };
  }

  async #hostedFor(key: string, tool: string, launch: () => RemoteLaunch): Promise<{ hosted: Hosted; reused: boolean }> {
    const starting = this.#starting.get(key);
    if (starting) return { hosted: await starting, reused: true };
    const current = this.#sessions.get(key);
    if (current) return { hosted: current, reused: true };
    const start = this.#launch(key, tool, launch()).finally(() => this.#starting.delete(key));
    this.#starting.set(key, start);
    return { hosted: await start, reused: false };
  }

  async #launch(key: string, tool: string, launch: RemoteLaunch): Promise<Hosted> {
    const cwd = resolveWorkingDirectory(launch.cwd, this.paths.home);
    const info = await stat(cwd).catch(() => undefined);
    if (!info?.isDirectory()) throw new Error(`No such directory on the remote: ${cwd}`);
    const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const options = {
      cwd, huiSessionId: key,
      ...(typeof launch["sessionFile"] === "string" ? { sessionFile: launch["sessionFile"] } : {}),
      ...(typeof launch["model"] === "string" ? { model: launch["model"] } : {}),
      ...(typeof launch["thinking"] === "string" ? { thinking: launch["thinking"] } : {}),
      ...(typeof launch["title"] === "string" ? { title: launch["title"] } : {}),
    };
    const runtime: RuntimeSession = tool === "durable" ? await startDurable(options, this.#durable) : await piRuntime.start({
      ...options,
      ...(Array.isArray(launch["appendSystemPrompt"]) ? { appendSystemPrompt: strings(launch["appendSystemPrompt"]) } : {}),
      hostLaunch: {
        disabledSkills: launch.disabledSkills ?? [],
        bundledSkillPaths: strings(launch["bundledSkillPaths"]),
        disabledPluginIds: strings(launch["disabledPluginIds"]),
        // The managed browser runs on the gateway machine.
        browserTool: false,
        fallbackAuth: join(this.paths.fallbackAgentDir, "auth.json"),
      },
    });
    try {
      const conversation = durableConversationId(runtime.sessionFile);
      if (conversation !== undefined && this.#callers.get(String(conversation)) !== key) {
        this.#callers.set(String(conversation), key);
        await this.#write(this.#callersFile, () => JSON.stringify(Object.fromEntries(this.#callers)));
      }
    } catch (error) {
      runtime.dispose();
      throw error;
    }
    const hosted: Hosted = { key, tool, runtime, lastActive: Date.now(), stop: () => undefined, seq: 0, interrupted: tool === "pi" && this.#piRuns.has(key) };
    const unsubscribe = runtime.subscribe((event) => {
      this.#touch(hosted);
      this.#trackRun(hosted, event.type === "settled");
      if (!hosted.peer) return;
      const transcript = TRANSCRIPT_EVENTS.has(event.type);
      hosted.peer.send({ t: "session.event", key, event, ...this.#snapshot(hosted, transcript), ...(transcript ? this.#transcript(hosted) : {}) });
    });
    const unsubscribeExit = runtime.onExit?.(() => {
      hosted.peer?.send({ t: "session.exit", key, message: "The session's runtime stopped on the remote." });
      this.#stop(hosted);
    });
    hosted.stop = () => { unsubscribe(); unsubscribeExit?.(); runtime.dispose(); };
    this.#sessions.set(key, hosted);
    if (this.#bots.has(key) && runtime.sessionFile) await this.#bots.rememberSessionFile(key, runtime.sessionFile);
    return hosted;
  }

  /** Records whether a PI run is in progress; Durable keeps its own record. */
  #trackRun(hosted: Hosted, settled = false): void {
    if (hosted.tool !== "pi") return;
    if (hosted.runtime.isStreaming) hosted.interrupted = false;
    const running = hosted.runtime.isStreaming || (this.#piRuns.has(hosted.key) && !settled);
    if (running === this.#piRuns.has(hosted.key)) return;
    if (running) this.#piRuns.add(hosted.key);
    else this.#piRuns.delete(hosted.key);
    this.#write(this.#piRunsFile, () => JSON.stringify([...this.#piRuns])).catch((error: unknown) => console.error(`Could not record PI runs: ${error instanceof Error ? error.message : String(error)}`));
  }

  /** Writes a host state file atomically, after any write already queued, with
   * the data current when its turn comes. */
  #write(file: string, data: () => string): Promise<void> {
    const write = this.#writes.catch(() => undefined).then(() => writeAtomic(file, `${data()}\n`, 0o600));
    this.#writes = write;
    return write;
  }

  #state(hosted: Hosted): RemoteState {
    const runtime = hosted.runtime;
    const model = runtime.currentModel?.();
    const usage = runtime.currentUsage?.();
    const thinking = runtime.currentThinking?.();
    return {
      sessionId: runtime.sessionId,
      ...(runtime.sessionFile ? { sessionFile: runtime.sessionFile } : {}),
      isStreaming: runtime.isStreaming,
      resumesInterruptedRuns: runtime.resumesInterruptedRuns === true || !hosted.interrupted,
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {}),
      ...(thinking ? { thinking } : {}),
      ...(runtime.pendingQueue ? { queue: runtime.pendingQueue() } : {}),
      ...(runtime.pendingQuestions ? { questions: runtime.pendingQuestions() } : {}),
      methods: [...CALLS].filter((name) => typeof (runtime as unknown as Record<string, unknown>)[name] === "function"),
    };
  }

  /** The state stamped with the next sequence; nothing when `force` is unset
   * and it has not changed since it was last sent. */
  #snapshot(hosted: Hosted, force: boolean): { state: RemoteState; seq: number } | Record<string, never> {
    const state = this.#state(hosted);
    const json = JSON.stringify(state);
    if (!force && json === hosted.sent) return {};
    hosted.sent = json;
    return { state, seq: ++hosted.seq };
  }

  /** Sent with a stamped snapshot; a large one is fetched in pages instead. */
  #transcript(hosted: Hosted): { transcript: TranscriptEntry[] } | { transcriptPaged: true } {
    const transcript = hosted.runtime.transcript();
    return JSON.stringify(transcript).length <= TRANSCRIPT_PAGE_BYTES ? { transcript } : { transcriptPaged: true };
  }

  /** One page of the transcript; offset 0 takes a fresh snapshot to page through. */
  #transcriptPage(params: Record<string, unknown>): { entries: TranscriptEntry[]; total: number; seq: number } {
    const hosted = this.#sessions.get(String(params["key"] ?? ""));
    if (!hosted) throw new Error("That session is not running on this worker.");
    const offset = typeof params["offset"] === "number" ? params["offset"] : 0;
    if (offset === 0) hosted.paging = { seq: ++hosted.seq, entries: hosted.runtime.transcript() };
    if (!hosted.paging) throw new Error("Read the transcript from its start.");
    const entries: TranscriptEntry[] = [];
    let size = 0;
    for (const entry of hosted.paging.entries.slice(offset)) {
      size += JSON.stringify(entry).length;
      if (entries.length && size > TRANSCRIPT_PAGE_BYTES) break;
      entries.push(entry);
    }
    const page = { entries, total: hosted.paging.entries.length, seq: hosted.paging.seq };
    if (offset + entries.length >= page.total) hosted.paging = undefined;
    return page;
  }

  async #call(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const hosted = this.#sessions.get(String(params["key"] ?? ""));
    const method = String(params["method"] ?? "");
    if (!hosted) throw new Error("That session is not running on this worker.");
    const fn = (hosted.runtime as unknown as Record<string, unknown>)[method];
    if (!CALLS.has(method) || typeof fn !== "function") throw new Error(`The session cannot ${method}.`);
    this.#touch(hosted);
    const args = Array.isArray(params["args"]) ? params["args"] : [];
    let result = await (fn as (...values: unknown[]) => unknown).apply(hosted.runtime, args);
    this.#trackRun(hosted);
    if (method === "attachmentImage" && isRecord(result) && Buffer.isBuffer(result["data"])) result = { mimeType: result["mimeType"], data: result["data"].toString("base64") };
    return {
      ...(result === undefined ? {} : { result }), ...this.#snapshot(hosted, true),
      ...(TRANSCRIPT_CALLS.has(method) ? this.#transcript(hosted) : {}),
    };
  }

  /** The gateway preferred for a session: its own, else any connected one. */
  #gateway(key?: string): Peer | undefined {
    const own = key ? this.#sessions.get(key)?.peer : undefined;
    if (own && !own.closed) return own;
    for (const peer of this.#peers) if (!peer.closed) return peer;
    return undefined;
  }

  /** HUI tools act on the gateway; without one they fail at once, never replayed. */
  #gatewayTool(key: string, action: string, params: Record<string, unknown>): Promise<unknown> {
    const peer = this.#gateway(key);
    if (!peer) return Promise.reject(new Error("HUI is not connected to this worker right now; its tools are unavailable until it reconnects."));
    return peer.request("bridge", { key, action, params }, 170_000);
  }

  /** Gateway credentials, cached in memory until they expire so runs keep
   * going while it is away; never written here. */
  async #credential(op: string, store: string, providerId: string | undefined, modify?: (current: unknown) => Promise<unknown>): Promise<unknown> {
    const readKey = `read\0${store}\0${providerId ?? ""}`;
    const cacheKey = op === "list" ? `list\0${store}` : readKey;
    const peer = this.#gateway();
    if (peer) {
      const step = modify ? `s${++this.#nextStep}` : undefined;
      if (step) this.#modifiers.set(step, modify!);
      try {
        const result = await peer.request("credential", { op, store, ...(providerId ? { providerId } : {}), ...(step ? { step } : {}) }, 120_000);
        if (op === "read" || op === "modify") {
          if (result) this.#credentials.set(readKey, { value: result, until: expiry(result) });
          else this.#credentials.delete(readKey);
        } else if (op === "list") this.#credentials.set(cacheKey, { value: result, until: Infinity });
        else if (op === "delete") {
          this.#credentials.delete(readKey);
          this.#credentials.delete(`list\0${store}`);
        }
        return result;
      } catch (error) {
        // A gateway that left mid-request is treated as already gone.
        if (!peer.closed) throw error;
      } finally {
        if (step) this.#modifiers.delete(step);
      }
    }
    const cached = op === "read" || op === "list" ? this.#credentials.get(cacheKey) : undefined;
    if (cached && cached.until > Date.now()) return cached.value;
    if (cached) this.#credentials.delete(cacheKey);
    throw new OfflineError("HUI is not connected.");
  }

  async #pruneAttachments(): Promise<void> {
    this.#pruned = Date.now();
    const cutoff = Date.now() - ATTACHMENT_RETENTION_MS;
    for (const entry of await readdir(this.paths.attachmentsDir).catch(() => [] as string[])) {
      const dir = join(this.paths.attachmentsDir, entry);
      const info = await stat(dir).catch(() => undefined);
      if (info && info.mtimeMs < cutoff) await rm(dir, { recursive: true, force: true });
    }
  }

  /** Uploaded prompt attachments, under a random directory like the gateway's. */
  async #putFile(params: Record<string, unknown>): Promise<{ path: string }> {
    const name = typeof params["name"] === "string" ? params["name"] : "";
    if (!name || name.length > 128 || /[\\/\p{Cc}]/u.test(name) || name === "." || name === "..") throw new Error("Invalid attachment name.");
    if (typeof params["data"] !== "string") throw new Error("Attachment data is missing.");
    const dir = join(this.paths.attachmentsDir, randomUUID());
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, name);
    await writeFile(path, Buffer.from(params["data"], "base64"), { mode: 0o600 });
    return { path };
  }

  async #getFile(params: Record<string, unknown>): Promise<{ path: string; data: string }> {
    if (typeof params["path"] !== "string") throw new Error("A remote path is required.");
    const base = typeof params["cwd"] === "string" ? resolveWorkingDirectory(params["cwd"], this.paths.home) : this.paths.home;
    const raw = params["path"];
    const path = await realpath(isAbsolute(raw) || raw.startsWith("~") ? resolveWorkingDirectory(raw, this.paths.home) : resolve(base, raw));
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Not a file on the remote: ${path}`);
    if (info.size > MAX_FILE_BYTES) throw new Error(`${basename(path)} is larger than 100 MB.`);
    return { path, data: (await readFile(path)).toString("base64") };
  }

  /** One scheduled bot turn through the runtime layer: start (or reuse) its
   * session, prompt, wait for it to settle. */
  async #runBot(bot: BotRecord, launch: RemoteLaunch, signal: AbortSignal): Promise<{ sessionFile?: string; summary?: string }> {
    const existing = this.#sessions.get(bot.key);
    if (existing && (existing.runtime.isStreaming || existing.runtime.pendingQuestions?.().length)) throw new Error("The bot is busy.");
    // Bots stay on PI until Durable takes a bot's standing instructions.
    const { hosted } = await this.#hostedFor(bot.key, "pi", () => launch);
    const runtime = hosted.runtime;
    let failure: string | undefined;
    const settled = new Promise<void>((done) => {
      const stopExit = runtime.onExit?.(() => { failure ??= "The bot's runtime exited."; stopExit?.(); done(); });
      const stop = runtime.subscribe((event) => {
        if (event.type === "error") failure = event.message;
        if (event.type === "settled" || event.type === "error") { stop(); stopExit?.(); done(); }
      });
    });
    await runtime.prompt(bot.prompt);
    const onAbort = () => { void runtime.abort?.().catch(() => undefined); };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await settled;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (failure) throw new Error(failure);
    const last = runtime.transcript().filter((entry) => entry.kind === "message" && entry.role === "assistant").at(-1);
    const summary = (last?.kind === "message" ? last.text : "").slice(0, 500);
    const sessionFile = runtime.sessionFile;
    // Nobody is watching: free the runtime, the transcript is on disk.
    if (!hosted.peer) this.#stop(hosted);
    return { ...(sessionFile ? { sessionFile } : {}), ...(summary ? { summary } : {}) };
  }

  #stop(hosted: Hosted): void {
    if (this.#sessions.get(hosted.key) !== hosted) return;
    this.#sessions.delete(hosted.key);
    hosted.stop();
  }

  #touch(hosted?: Hosted): void {
    this.#lastActivity = Date.now();
    if (hosted) hosted.lastActive = this.#lastActivity;
  }

  #sweep(): void {
    const now = Date.now();
    for (const hosted of this.#sessions.values()) {
      // A Durable run carries on in the store without a hosted view.
      if (hosted.peer || (hosted.runtime.isStreaming && hosted.tool !== "durable")) continue;
      const waiting = (hosted.runtime.pendingQuestions?.().length ?? 0) > 0;
      if (now - hosted.lastActive > (waiting ? DETACHED_QUESTION_MS : DETACHED_IDLE_MS)) this.#stop(hosted);
    }
    if (now - this.#pruned > 24 * 60 * 60_000) void this.#pruneAttachments();
    // An open Durable store may be running resumed work nobody watches.
    if (!this.#sessions.size && !this.#peers.size && !this.#bots.active() && !this.#durable.isOpen && now - this.#lastActivity > HOST_IDLE_MS) {
      void this.close().finally(() => process.exit(0));
    }
  }
}
