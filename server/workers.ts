/**
 * Remote workers: other machines this gateway runs PI on.
 *
 * A worker is a name and a connect command — any argv prefix that yields a
 * stdio pipe to a POSIX shell there (`ssh devbox`, `docker exec -i box`,
 * `kubectl exec -i pod --`). Through it HUI installs its own worker release,
 * starts the durable host (worker/host.ts), mirrors the user's PI resources and
 * then multiplexes every remote session over that one connection. The gateway
 * answers the host's credential and agent tool requests; nothing secret is
 * written on the remote.
 *
 *   ~/.config/hui/workers.json
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { CONFIG_DIR } from "./paths.ts";
import { resolvePiAgentDir } from "./pi-paths.ts";
import { credentialStore, ProviderAccounts, type CredentialStore } from "./provider-accounts.ts";
import { PROVIDERS_DIR, readProviderSelections } from "./runtimes/hui-models.ts";
import { attachPeer, isRecord, PROTOCOL_VERSION, type Frame, type Peer } from "./worker/protocol.ts";
import { BROKERED_PROVIDER_FILE } from "./worker/credentials.ts";
import { isBotShape } from "./worker/bots.ts";
import { writeAtomic, type SyncResult } from "./worker/sync-apply.ts";
import { enabledBundledSkillPaths, isBundledSkillPreference } from "./bundled-skills.ts";
import { readHuiSettings } from "./hui-settings.ts";
import { BootstrapError, connectScript, markers, nodeInstallScript, probeScript, releaseInstallScript, runScript } from "./worker/bootstrap.ts";
import { remoteReleasePath, workerRelease, type WorkerRelease } from "./worker/release.ts";
import { buildSyncPlan, mirrorPath } from "./worker/sync.ts";
import { RemoteChild } from "./worker/remote-child.ts";
import type { HostInfo, RemoteLaunch } from "./worker/host.ts";
import { formatCommand, parseCommand, type BotInput, type WorkerBot, type WorkerInput, type WorkerView } from "../shared/workers.ts";
import { invokeAgentTool } from "./agent-tools-bridge.ts";
import { readRegistry } from "./sessions.ts";

export const WORKERS_FILE = join(CONFIG_DIR, "workers.json");
const MAX_WORKERS = 32;
const SYNC_BATCH_BYTES = 8 * 1024 * 1024;
/** A session start re-checks the mirror at most this often. */
const SYNC_INTERVAL_MS = 30_000;
const RECONNECT_MS = [30_000, 60_000, 300_000];

export type WorkerConfig = {
  id: string;
  name: string;
  command: string[];
  extraPaths: string[];
  /** Kept connected while the gateway runs, so bots can use its credentials. */
  keepConnected?: boolean;
  createdAt: string;
  updatedAt: string;
};

export class WorkerInputError extends Error {}
export class WorkerNotFoundError extends Error {}

function normalizeInput(value: unknown, existing?: WorkerConfig): Omit<WorkerConfig, "id" | "createdAt" | "updatedAt"> {
  if (!isRecord(value)) throw new WorkerInputError("A worker is required.");
  const name = typeof value["name"] === "string" ? value["name"].trim() : existing?.name ?? "";
  if (!name || name.length > 60) throw new WorkerInputError("Worker name must be 1 to 60 characters.");
  let command = existing?.command ?? [];
  if (value["command"] !== undefined) {
    if (typeof value["command"] !== "string") throw new WorkerInputError("Connect command must be text.");
    try { command = parseCommand(value["command"]); } catch (error) { throw new WorkerInputError((error as Error).message); }
  }
  if (!command.length || command.length > 64 || command.some((word) => word.length > 1024 || word.includes("\0"))) {
    throw new WorkerInputError("Connect command is required, for example: ssh devbox");
  }
  let extraPaths = existing?.extraPaths ?? [];
  if (value["extraPaths"] !== undefined) {
    if (!Array.isArray(value["extraPaths"]) || value["extraPaths"].length > 50 || !value["extraPaths"].every((path) => typeof path === "string" && path.trim() && path.length <= 4096)) {
      throw new WorkerInputError("Extra paths must be up to 50 local paths.");
    }
    extraPaths = (value["extraPaths"] as string[]).map((path) => path.trim());
  }
  return { name, command, extraPaths, ...(existing?.keepConnected ? { keepConnected: true } : {}) };
}

export async function readWorkers(): Promise<WorkerConfig[]> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(WORKERS_FILE, "utf8")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("The worker list could not be read.");
  }
  const list = isRecord(raw) && Array.isArray(raw["workers"]) ? raw["workers"] : [];
  return list.filter((item): item is WorkerConfig => isRecord(item) && typeof item["id"] === "string" && typeof item["name"] === "string"
    && Array.isArray(item["command"]) && item["command"].every((word) => typeof word === "string")).map((item) => ({
    ...item, extraPaths: Array.isArray(item.extraPaths) ? item.extraPaths.filter((path) => typeof path === "string") : [],
  }));
}

function writeWorkers(workers: readonly WorkerConfig[]): Promise<void> {
  return writeAtomic(WORKERS_FILE, `${JSON.stringify({ version: 1, workers }, null, 2)}\n`, 0o600);
}

/** Gateway-side store for a name the host may ask about; nothing else. */
function gatewayStore(name: unknown): CredentialStore {
  if (name === "pi") return credentialStore(join(resolvePiAgentDir(), "auth.json"));
  if (typeof name === "string" && name.startsWith("hui:")) {
    const rel = name.slice(4);
    if (BROKERED_PROVIDER_FILE.test(rel)) return credentialStore(join(PROVIDERS_DIR, ...rel.split("/")));
  }
  throw new Error("Unknown credential store.");
}

type SyncState = NonNullable<WorkerView["sync"]> & { pluginIds: Map<string, string> };

/** Bots end up as registry records; a malformed one must never get there. */
function validBots(value: unknown): WorkerBot[] {
  return Array.isArray(value) ? value.filter(isBotShape) : [];
}

/** HUI's skill and plugin choices, applied to remote sessions as to local ones. */
async function sessionSettings() {
  const settings = await readHuiSettings();
  return {
    disabledSkills: settings.disabledSkills.filter((entry) => !isBundledSkillPreference(entry)),
    bundledSkillPaths: enabledBundledSkillPaths(settings.disabledSkills),
    disabledPluginIds: settings.disabledPlugins.map((plugin) => plugin.id),
  };
}

class WorkerConnection {
  readonly worker: WorkerConfig;
  host!: HostInfo;
  release!: WorkerRelease;
  #peer!: Peer;
  #transport!: ChildProcessWithoutNullStreams;
  #stderr = "";
  #channels = new Map<number, RemoteChild>();
  #next = 0;
  #onPhase: (phase: string) => void;
  #onBots: (bots: WorkerBot[]) => void;
  #sync: SyncState | undefined;
  #syncedAt = 0;
  #syncing: Promise<SyncState> | undefined;
  bots: WorkerBot[] | undefined;

  constructor(worker: WorkerConfig, onPhase: (phase: string) => void, onBots: (bots: WorkerBot[]) => void) {
    this.worker = worker;
    this.#onPhase = onPhase;
    this.#onBots = onBots;
  }

  get closed(): boolean {
    return !this.#peer || this.#peer.closed;
  }

  get sync(): SyncState | undefined {
    return this.#sync;
  }

  onClose(listener: (reason: string) => void): void {
    this.#peer.onClose(listener);
  }

  async open(allowUpgrade = true): Promise<void> {
    const command = this.worker.command;
    this.release = await workerRelease();
    this.#onPhase("Checking the remote");
    const probe = markers((await runScript(command, probeScript(this.release), 90_000)).stdout);
    let node = probe["NODE"];
    if (!node) {
      this.#onPhase("Installing Node.js on the remote");
      node = markers((await runScript(command, nodeInstallScript(process.version), 600_000)).stdout)["NODE"];
      if (!node) throw new BootstrapError("Node.js could not be installed on the remote.");
    }
    if (probe["RELEASE"] !== "ready") {
      this.#onPhase("Installing the HUI worker on the remote");
      await runScript(command, releaseInstallScript(this.release, node), 900_000);
    }
    this.#onPhase("Starting the worker host");
    await this.#connect(node);
    // The host may ask for credentials as soon as it sees this connection.
    this.#peer.handle("credential", (params) => this.#credential(params));
    this.#peer.handle("bridge", (params) => this.#bridge(params));
    this.#peer.onFrame((frame) => this.#frame(frame));
    this.#peer.keepAlive();
    const hello = await this.#peer.request<HostInfo>("hello");
    if (hello.release !== this.release.id || hello.version !== PROTOCOL_VERSION) {
      // An older host is replaced once it is idle; a busy one keeps serving
      // its sessions if it still speaks this protocol.
      const { stopping } = await this.#peer.request<{ stopping: boolean }>("shutdown");
      if (stopping) {
        await new Promise<void>((resolve) => this.#peer.onClose(() => resolve()));
        this.#transport.kill();
        if (allowUpgrade) return this.open(false);
        throw new BootstrapError("The remote worker host restarted twice in a row; try connecting again.");
      }
      if (hello.version !== PROTOCOL_VERSION) throw new BootstrapError("The remote is running an incompatible HUI worker that is still busy. Try again when its sessions finish.");
    }
    this.host = hello;
    this.bots = validBots(await this.#peer.request<unknown>("bots-list"));
    this.#onBots(this.bots);
    this.#onPhase("Syncing your PI configuration");
    // A failed sync is reported, not fatal: sessions already running there
    // must stay reachable.
    await this.syncNow().catch(() => undefined);
  }

  #connect(node: string): Promise<void> {
    const command = this.worker.command;
    const transport = spawn(command[0]!, [...command.slice(1), "sh", "-s"], { stdio: ["pipe", "pipe", "pipe"] });
    this.#transport = transport;
    transport.stderr.setEncoding("utf8").on("data", (chunk: string) => { this.#stderr = (this.#stderr + chunk).slice(-8192); });
    transport.stdin.on("error", () => undefined);
    return new Promise((resolve, reject) => {
      let ready = false;
      const fail = (message: string) => {
        if (ready) return;
        ready = true;
        clearTimeout(timer);
        transport.kill();
        reject(new BootstrapError(message, this.#stderr));
      };
      const timer = setTimeout(() => fail("The worker host did not start in time."), 60_000);
      const peer = attachPeer(transport.stdout, transport.stdin, (line) => {
        if (ready) return false;
        if (line === JSON.stringify({ t: "ready" })) {
          ready = true;
          clearTimeout(timer);
          resolve();
        }
        return true;
      });
      this.#peer = peer;
      transport.on("error", (error) => fail(`Could not run ${command[0]}: ${error.message}`));
      transport.on("exit", (code, signal) => {
        fail(`${command[0]} exited with code ${code} before the worker host started.`);
        peer.close(`${command[0]} exited${signal ? ` after ${signal}` : ` with code ${code}`}`);
      });
      peer.onClose((reason) => {
        for (const channel of this.#channels.values()) channel.lost(`Lost the connection to ${this.worker.name} (${reason.replace(/\.$/u, "")}).`);
        this.#channels.clear();
        transport.kill();
      });
      transport.stdin.write(connectScript(this.release, node));
    });
  }

  close(): void {
    this.#peer?.close(`Disconnected from ${this.worker.name}.`);
    this.#transport?.kill();
  }

  request<T>(op: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    return this.#peer.request<T>(op, params, timeoutMs);
  }

  /** Sync if the mirror may be stale; concurrent callers share one run. */
  async ensureSynced(): Promise<void> {
    if (Date.now() - this.#syncedAt < SYNC_INTERVAL_MS) return;
    await this.syncNow();
  }

  syncNow(): Promise<SyncState> {
    this.#syncing ??= this.#runSync().catch((error: unknown) => {
      // Kept visible in Settings; the next session start tries again.
      this.#sync = {
        ...(this.#sync ?? { files: 0, uploaded: 0, deleted: 0, installed: [], skipped: [], pluginIds: new Map() }),
        at: new Date().toISOString(), errors: [`Sync failed: ${error instanceof Error ? error.message : String(error)}`],
      };
      throw error;
    }).finally(() => { this.#syncing = undefined; });
    return this.#syncing;
  }

  async #runSync(): Promise<SyncState> {
    const providerFiles: Record<string, string> = {};
    if (Object.keys(await readProviderSelections()).length) {
      providerFiles["models.json"] = await readFile(join(PROVIDERS_DIR, "models.json"), "utf8");
      // Defaults made explicit: the remote cannot look at local auth files.
      providerFiles["accounts.json"] = `${JSON.stringify(await new ProviderAccounts(PROVIDERS_DIR).all(), null, 2)}\n`;
    }
    const agentDir = resolvePiAgentDir();
    const plan = await buildSyncPlan({ agentDir, home: homedir(), remoteMirror: this.host.mirrorDir, extraPaths: this.worker.extraPaths, providerFiles });
    const entries = plan.files.map(({ path, hash, mode, size }) => ({ path, hash, mode, size }));
    const { need } = await this.#peer.request<{ need: string[] }>("sync-plan", { entries }, 120_000);
    const wanted = new Set(need);
    let batch: { path: string; mode: number; data: string }[] = [];
    let bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      await this.#peer.request("sync-put", { files: batch }, 300_000);
      batch = [];
      bytes = 0;
    };
    for (const file of plan.files) {
      if (!wanted.has(file.path)) continue;
      const data = file.content ?? await readFile(file.local!).catch(() => undefined);
      if (!data) continue;
      if (bytes + data.byteLength > SYNC_BATCH_BYTES) await flush();
      batch.push({ path: file.path, mode: file.mode, data: data.toString("base64") });
      bytes += data.byteLength;
    }
    await flush();
    const result = await this.#peer.request<SyncResult>("sync-commit", {
      entries, packageRoots: plan.packageRoots,
      // What a bot needs to start while no gateway is connected.
      launch: await this.#launchDefaults(plan.pluginIds),
    }, 1_800_000);
    this.#sync = {
      at: new Date().toISOString(), files: result.files, uploaded: wanted.size, deleted: result.deleted,
      installed: result.installed, skipped: plan.skipped, errors: result.errors, pluginIds: plan.pluginIds,
    };
    this.#syncedAt = Date.now();
    return this.#sync;
  }

  async #launchDefaults(pluginIds: Map<string, string>): Promise<Record<string, unknown>> {
    const settings = await sessionSettings();
    const source = { agentDir: resolvePiAgentDir(), home: homedir() };
    return {
      disabledPluginIds: settings.disabledPluginIds.map((id) => pluginIds.get(id) ?? id),
      bundledSkillPaths: settings.bundledSkillPaths.flatMap((path) => remoteReleasePath(this.release, this.host.releaseDir, path) ?? []),
      // The managed browser runs on the gateway machine; remote sessions
      // cannot hand it their files yet.
      browserTool: false,
      disabledSkills: settings.disabledSkills.map((skill) => ({ name: skill.name, path: `${this.host.mirrorDir}/${mirrorPath(skill.path, source)}` })),
    };
  }

  async openChannel(key: string, options: { cwd: string; sessionFile?: string; model?: string; thinking?: string }): Promise<RemoteChild> {
    const ch = ++this.#next;
    const launch: RemoteLaunch = {
      ...await this.#launchDefaults(this.#sync?.pluginIds ?? new Map()), cwd: options.cwd,
      ...(options.sessionFile ? { sessionFile: options.sessionFile } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.thinking ? { thinking: options.thinking } : {}),
    };
    // Registered before the request: output can arrive in the same chunk as
    // the reply, before the awaiting code below resumes.
    const child = new RemoteChild(this.#peer, ch, () => this.#channels.delete(ch));
    this.#channels.set(ch, child);
    try {
      const opened = await this.#peer.request<{ reused: boolean }>("open", { ch, key, launch }, 60_000);
      child.reused = opened.reused;
      return child;
    } catch (error) {
      this.#channels.delete(ch);
      throw error;
    }
  }

  #frame(frame: Frame): void {
    if (frame.t === "bots") {
      this.bots = validBots(frame["bots"]);
      this.#onBots(this.bots);
      return;
    }
    const channel = typeof frame["ch"] === "number" ? this.#channels.get(frame["ch"]) : undefined;
    channel?.receive(frame);
  }

  async #credential(params: Record<string, unknown>): Promise<unknown> {
    const store = gatewayStore(params["store"]);
    const providerId = typeof params["providerId"] === "string" ? params["providerId"] : "";
    switch (params["op"]) {
      case "read": return (await store.read(providerId)) ?? null;
      case "list": return store.list();
      case "modify": {
        // PI's refresh callback runs remotely while this side holds the lock.
        // A remote may refresh what exists; it cannot log in or swap kinds.
        const result = await store.modify(providerId, async (current) => {
          if (!current) throw new Error("Sign in on the HUI machine first; a remote worker cannot add credentials.");
          const step = await this.#peer.request<{ next?: unknown }>("credential-step", { step: params["step"], current }, 90_000);
          const next = step.next as typeof current | undefined;
          if (next !== undefined && (!isRecord(next) || next["type"] !== current.type)) throw new Error("A remote worker may only refresh an existing credential.");
          return next;
        });
        return result ?? null;
      }
      default: throw new Error("Unknown credential operation.");
    }
  }

  async #bridge(params: Record<string, unknown>): Promise<unknown> {
    const key = typeof params["key"] === "string" ? params["key"] : "";
    const action = typeof params["action"] === "string" ? params["action"] : "";
    const toolParams = isRecord(params["params"]) ? params["params"] : {};
    const caller = (await readRegistry()).find((record) => record.id === key && record.worker === this.worker.id);
    if (!action || !caller) throw new Error("That conversation does not run on this worker.");
    if (action === "terminal" || action === "browser") throw new Error(`The ${action} tool is not available to sessions on a remote worker yet.`);
    if (action !== "present_media") return invokeAgentTool({ callerSessionId: key, action, params: toolParams });
    // Media lives on the remote: copy it here, then present it as usual.
    const paths = Array.isArray(toolParams["paths"]) ? toolParams["paths"].filter((path): path is string => typeof path === "string").slice(0, 8) : [];
    const dir = await mkdtemp(join(tmpdir(), "hui-remote-media-"));
    try {
      const local: string[] = [];
      for (const [index, path] of paths.entries()) {
        const file = await this.#peer.request<{ path: string; data: string }>("get-file", { path, cwd: caller.cwd }, 300_000);
        const target = join(dir, String(index), basename(file.path));
        await mkdir(join(dir, String(index)));
        await writeFile(target, Buffer.from(file.data, "base64"));
        local.push(target);
      }
      return await invokeAgentTool({ callerSessionId: key, action, params: { ...toolParams, paths: local } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export class WorkerService {
  #connections = new Map<string, WorkerConnection>();
  #connecting = new Map<string, Promise<WorkerConnection>>();
  #status = new Map<string, { state: WorkerView["state"]; phase?: string; error?: string }>();
  #reconnect = new Map<string, { timer: NodeJS.Timeout; attempt: number }>();
  #listeners = new Set<() => void>();
  #stopped = false;
  /** Bumped by disconnect, so a connect still in progress is discarded. */
  #generation = new Map<string, number>();
  #names = new Map<string, string>();

  async #read(): Promise<WorkerConfig[]> {
    const list = await readWorkers();
    this.#names = new Map(list.map((worker) => [worker.id, worker.name]));
    return list;
  }

  /** Last known display name, for session views; refreshed on every read. */
  nameOf(id: string): string | undefined {
    return this.#names.get(id);
  }

  #botListeners = new Set<(workerId: string, bots: WorkerBot[]) => void>();

  /** The host reported its bots (on connect and after every change). */
  onBots(listener: (workerId: string, bots: WorkerBot[]) => void): () => void {
    this.#botListeners.add(listener);
    return () => this.#botListeners.delete(listener);
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }

  async list(): Promise<WorkerView[]> {
    return (await this.#read()).map((worker) => this.#view(worker));
  }

  async get(id: string): Promise<WorkerConfig> {
    const worker = (await this.#read()).find((item) => item.id === id);
    if (!worker) throw new WorkerNotFoundError("That worker no longer exists.");
    return worker;
  }

  #view(worker: WorkerConfig): WorkerView {
    const connection = this.#connections.get(worker.id);
    const status = this.#status.get(worker.id) ?? { state: "disconnected" as const };
    const sync = connection?.sync;
    return {
      id: worker.id, name: worker.name, command: formatCommand(worker.command), extraPaths: worker.extraPaths,
      state: connection && !connection.closed ? "connected" : status.state,
      ...(status.phase && status.state === "connecting" ? { phase: status.phase } : {}),
      ...(status.error && status.state === "error" ? { error: status.error } : {}),
      ...(connection?.host ? { host: {
        hostname: connection.host.hostname, platform: connection.host.platform, arch: connection.host.arch,
        node: connection.host.node, home: connection.host.home, release: connection.host.release,
      } } : {}),
      ...(sync ? { sync: (({ pluginIds: _ids, ...view }) => view)(sync) } : {}),
      ...(connection?.bots ? { bots: connection.bots } : {}),
    };
  }

  async create(input: WorkerInput): Promise<WorkerView> {
    const workers = await this.#read();
    if (workers.length >= MAX_WORKERS) throw new WorkerInputError(`HUI holds at most ${MAX_WORKERS} workers.`);
    const now = new Date().toISOString();
    const worker: WorkerConfig = { id: randomUUID(), ...normalizeInput(input), createdAt: now, updatedAt: now };
    await writeWorkers([...workers, worker]);
    this.#changed();
    return this.#view(worker);
  }

  async update(id: string, input: Partial<WorkerInput>): Promise<WorkerView> {
    const workers = await this.#read();
    const existing = workers.find((item) => item.id === id);
    if (!existing) throw new WorkerNotFoundError("That worker no longer exists.");
    const worker = { ...existing, ...normalizeInput(input, existing), updatedAt: new Date().toISOString() };
    await writeWorkers(workers.map((item) => item.id === id ? worker : item));
    // A new command applies to the next connection.
    if (worker.command.join("\0") !== existing.command.join("\0")) this.disconnect(id);
    this.#changed();
    return this.#view(worker);
  }

  async remove(id: string): Promise<void> {
    const workers = await this.#read();
    if (!workers.some((item) => item.id === id)) throw new WorkerNotFoundError("That worker no longer exists.");
    this.disconnect(id);
    await writeWorkers(workers.filter((item) => item.id !== id));
    this.#status.delete(id);
    this.#changed();
  }

  async #setKeepConnected(id: string, keep: boolean): Promise<void> {
    const workers = await this.#read();
    const worker = workers.find((item) => item.id === id);
    if (!worker || Boolean(worker.keepConnected) === keep) return;
    const { keepConnected: _keep, ...rest } = worker;
    await writeWorkers(workers.map((item) => item.id === id ? { ...rest, ...(keep ? { keepConnected: true } : {}) } : item));
  }

  /** The live connection, opening (and if needed installing) it first. */
  connect(id: string): Promise<WorkerConnection> {
    const current = this.#connections.get(id);
    if (current && !current.closed) return Promise.resolve(current);
    const pending = this.#connecting.get(id);
    if (pending) return pending;
    const generation = this.#generation.get(id) ?? 0;
    const attempt = (async () => {
      const worker = await this.get(id);
      this.#status.set(id, { state: "connecting", phase: "Connecting" });
      this.#changed();
      const connection = new WorkerConnection(worker, (phase) => {
        this.#status.set(id, { state: "connecting", phase });
        this.#changed();
      }, (bots) => {
        for (const listener of this.#botListeners) listener(id, bots);
        this.#changed();
      });
      try {
        await connection.open();
      } catch (error) {
        connection.close();
        const output = error instanceof BootstrapError && error.output.trim() ? ` ${error.output.trim().split("\n").slice(-3).join(" ")}` : "";
        this.#status.set(id, { state: "error", error: `${error instanceof Error ? error.message : String(error)}${output}`.slice(0, 2000) });
        this.#changed();
        throw error;
      }
      if ((this.#generation.get(id) ?? 0) !== generation) {
        connection.close();
        throw new Error(`${worker.name} was disconnected while connecting.`);
      }
      this.#connections.set(id, connection);
      this.#status.set(id, { state: "connected" });
      this.#reconnect.delete(id);
      connection.onClose((reason) => {
        if (this.#connections.get(id) !== connection) return;
        this.#connections.delete(id);
        this.#status.set(id, { state: "error", error: reason });
        this.#changed();
        this.#scheduleReconnect(id);
      });
      void this.#setKeepConnected(id, Boolean(connection.bots?.length));
      this.#changed();
      return connection;
    })().finally(() => this.#connecting.delete(id));
    this.#connecting.set(id, attempt);
    return attempt;
  }

  /** Workers with bots stay connected so their runs can use credentials. */
  #scheduleReconnect(id: string, attempt = 0): void {
    if (this.#stopped || this.#reconnect.has(id)) return;
    void this.#read().then((workers) => {
      if (this.#stopped || this.#reconnect.has(id) || !workers.find((item) => item.id === id)?.keepConnected) return;
      const timer = setTimeout(() => {
        this.#reconnect.delete(id);
        this.connect(id).catch(() => this.#scheduleReconnect(id, attempt + 1));
      }, RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)]);
      timer.unref();
      this.#reconnect.set(id, { timer, attempt });
    }).catch(() => undefined);
  }

  /** Called once at gateway start. */
  async connectKept(): Promise<void> {
    for (const worker of await this.#read().catch(() => [] as WorkerConfig[])) {
      if (worker.keepConnected) this.connect(worker.id).catch(() => this.#scheduleReconnect(worker.id, 1));
    }
  }

  disconnect(id: string): void {
    this.#generation.set(id, (this.#generation.get(id) ?? 0) + 1);
    const timer = this.#reconnect.get(id);
    if (timer) clearTimeout(timer.timer);
    this.#reconnect.delete(id);
    const connection = this.#connections.get(id);
    this.#connections.delete(id);
    connection?.close();
    this.#status.set(id, { state: "disconnected" });
  }

  /** Gateway shutdown: remote sessions keep running and are reattached later. */
  disconnectAll(): void {
    this.#stopped = true;
    for (const id of [...this.#connections.keys(), ...this.#reconnect.keys()]) this.disconnect(id);
  }

  async sync(id: string): Promise<WorkerView> {
    const connection = await this.connect(id);
    await connection.syncNow();
    this.#changed();
    return this.#view(connection.worker);
  }

  /** Starts (or reattaches to) a PI worker for one HUI session. */
  async open(id: string, key: string, options: { cwd: string; sessionFile?: string; model?: string; thinking?: string }): Promise<RemoteChild> {
    const connection = await this.connect(id);
    // Reported in Settings; never a reason to refuse a running session.
    await connection.ensureSynced().catch(() => undefined);
    return connection.openChannel(key, options);
  }

  /** Deleted sessions: stop their remote processes, attached or not. */
  async forget(id: string, keys: readonly string[]): Promise<void> {
    const connection = this.#connections.get(id);
    if (connection && !connection.closed && keys.length) await connection.request("forget", { keys: [...keys] });
  }

  async putFile(id: string, name: string, data: Buffer): Promise<string> {
    const connection = await this.connect(id);
    return (await connection.request<{ path: string }>("put-file", { name, data: data.toString("base64") }, 300_000)).path;
  }

  async saveBot(id: string, key: string, input: BotInput): Promise<WorkerBot> {
    const connection = await this.connect(id);
    const bot = await connection.request<WorkerBot>("bots-save", { bot: { ...input, key } });
    void this.#setKeepConnected(id, true);
    return bot;
  }

  async deleteBot(id: string, key: string): Promise<boolean> {
    const connection = await this.connect(id);
    const result = await connection.request<{ removed: boolean }>("bots-delete", { key });
    return result.removed;
  }

  async runBot(id: string, key: string): Promise<string> {
    const connection = await this.connect(id);
    return (await connection.request<{ runId: string }>("bots-run", { key })).runId;
  }
}

export const workers = new WorkerService();
