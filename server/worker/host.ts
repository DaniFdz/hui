/**
 * The remote worker host. One long-lived daemon per remote user owns the PI SDK
 * workers running there, so a conversation keeps going while no gateway is
 * attached (a laptop asleep, a gateway restart, a dropped SSH connection).
 *
 * Gateways reach it through a Unix socket that `main.ts connect` bridges to
 * the stdio of whatever command reached this machine. Each PI worker is keyed
 * by its HUI session id; reopening a key reattaches to the running process and
 * replays the questions it is still waiting on. Credentials and HUI agent
 * tools are served by whichever gateway is connected, never stored here.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { chmod, mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentToolEnvironment, registerAgentToolHandler, stopAgentToolBridge } from "../agent-tools-bridge.ts";
import { resolveWorkingDirectory } from "../working-directories.ts";
import { attachPeer, isRecord, LineSplitter, PROTOCOL_VERSION, type Frame, type Peer } from "./protocol.ts";
import { PACKAGE_ROOT } from "./release.ts";
import { BotScheduler, type BotRecord } from "./bots.ts";
import { applySync, planSync, putSyncFiles, type SyncCommit } from "./sync-apply.ts";
import type { WorkerPaths } from "./paths.ts";

/** Detached, idle workers are stopped after this; their transcript stays on disk. */
const DETACHED_IDLE_MS = 10 * 60_000;
/** A host with nothing to do exits after this, unless it owns bots. */
const HOST_IDLE_MS = 30 * 60_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

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

type Attachment = { peer: Peer; ch: number };

type Proc = {
  key: string;
  child: ChildProcess;
  attached?: Attachment;
  streaming: boolean;
  /** Raw `extension_ui_request` lines still waiting for an answer. */
  questions: Map<string, string>;
  out: LineSplitter;
  in: LineSplitter;
  lastActive: number;
  exited: boolean;
  /** Host-originated RPC (bot runs) awaiting their response line. */
  rpc: Map<string, (response: Record<string, unknown>) => void>;
  idle: Set<() => void>;
  stderr: string;
};

type Step = { proc: Proc; id: string };

/** The login shell's environment, so tools see the PATH the user sees over an
 * interactive SSH login rather than the minimal one of a non-login command. */
export function loginEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const shell = base["SHELL"] || "/bin/sh";
  const result = spawnSync(shell, ["-lc", "env -0"], { env: base, timeout: 10_000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const env: NodeJS.ProcessEnv = { ...base };
  if (result.status === 0 && result.stdout) {
    for (const entry of result.stdout.split("\0")) {
      const index = entry.indexOf("=");
      if (index > 0) env[entry.slice(0, index)] = entry.slice(index + 1);
    }
  }
  // PI installs packages with npm; the Node HUI runs on (possibly the one it
  // installed) must be found first.
  const bin = dirname(process.execPath);
  if (!(env["PATH"] ?? "").split(":").includes(bin)) env["PATH"] = `${bin}:${env["PATH"] ?? "/usr/bin:/bin"}`;
  return env;
}

export class WorkerHost {
  readonly paths: WorkerPaths;
  readonly releaseDir = PACKAGE_ROOT;
  #release = basename(PACKAGE_ROOT);
  #workerEntry = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../runtimes/pi-sdk-worker.ts" : "../runtimes/pi-sdk-worker.js", import.meta.url));
  #procs = new Map<string, Proc>();
  #peers = new Set<Peer>();
  #steps = new Map<string, Step>();
  #stepResults = new Map<string, (message: Record<string, unknown>) => void>();
  #nextStep = 0;
  #server: Server | undefined;
  #timer: NodeJS.Timeout | undefined;
  #lastActivity = Date.now();
  #bots: BotScheduler;

  constructor(paths: WorkerPaths) {
    this.paths = paths;
    this.#bots = new BotScheduler({
      file: join(this.paths.stateDir, "bots.json"),
      launchFile: join(this.paths.stateDir, "launch.json"),
      run: (bot, launch, signal) => this.#runBot(bot, launch, signal),
      onChange: (bots) => { for (const peer of this.#peers) peer.send({ t: "bots", bots }); },
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
      const info = await stat(socketDir);
      // A shared /tmp directory must be ours alone.
      if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error(`Refusing to use ${socketDir}: it is not private to this user.`);
    }
    // HUI agent tools reach the gateway this session's PI worker belongs to.
    registerAgentToolHandler(async ({ callerSessionId, action, params }) => {
      const peer = this.#gateway(this.#procs.get(callerSessionId));
      if (!peer) throw new Error("HUI is not connected to this worker right now.");
      return peer.request("bridge", { key: callerSessionId, action, params }, 170_000);
    });
    await this.#bots.load();
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
    for (const proc of this.#procs.values()) proc.child.kill();
    for (const peer of this.#peers) peer.close("Remote worker host stopped.");
    stopAgentToolBridge();
    await new Promise<void>((done) => this.#server ? this.#server.close(() => done()) : done());
    await unlink(this.paths.socket).catch(() => undefined);
  }

  /** Busy work blocks an upgrade; an idle host may be replaced. */
  busy(): boolean {
    return this.#bots.running() || [...this.#procs.values()].some((proc) => proc.streaming || proc.questions.size > 0);
  }

  #accept(socket: Socket): void {
    const peer = attachPeer(socket, socket);
    this.#peers.add(peer);
    this.#touch();
    peer.onClose(() => {
      this.#peers.delete(peer);
      for (const proc of this.#procs.values()) if (proc.attached?.peer === peer) proc.attached = undefined;
      socket.destroy();
    });
    peer.handle("hello", () => this.info());
    peer.handle("open", (params) => this.#open(peer, params));
    peer.handle("put-file", (params) => this.#putFile(params));
    peer.handle("get-file", (params) => this.#getFile(params));
    peer.handle("sync-plan", (params) => planSync(this.paths, params["entries"]));
    peer.handle("sync-put", (params) => putSyncFiles(this.paths, params["files"]));
    peer.handle("sync-commit", (params) => applySync(this.paths, params as unknown as SyncCommit).then(async (result) => {
      if (isRecord(params["launch"])) await this.#bots.setLaunch(params["launch"]);
      return result;
    }));
    peer.handle("credential-step", (params) => this.#credentialStep(params));
    peer.handle("bots-list", () => this.#bots.list());
    peer.handle("bots-save", (params) => this.#bots.save(params["bot"]));
    peer.handle("bots-delete", (params) => this.#bots.remove(String(params["key"] ?? "")));
    peer.handle("bots-run", (params) => this.#bots.runNow(String(params["key"] ?? "")));
    peer.handle("shutdown", () => {
      if (this.busy()) return { stopping: false };
      setImmediate(() => { void this.close().finally(() => process.exit(0)); });
      return { stopping: true };
    });
    peer.onFrame((frame) => this.#frame(peer, frame));
  }

  #frame(peer: Peer, frame: Frame): void {
    const proc = this.#byChannel(peer, frame["ch"]);
    if (!proc) return;
    this.#touch(proc);
    if (frame.t === "in" && typeof frame["d"] === "string") {
      for (const line of proc.in.push(frame["d"])) {
        try {
          const command = JSON.parse(line) as Record<string, unknown>;
          if (command["type"] === "extension_ui_response" && typeof command["id"] === "string") proc.questions.delete(command["id"]);
        } catch { /* PI reports malformed input itself. */ }
      }
      proc.child.stdin?.write(frame["d"]);
    } else if (frame.t === "ipc" && isRecord(frame["m"]) && proc.child.connected) {
      proc.child.send(frame["m"]);
    } else if (frame.t === "detach") {
      proc.attached = undefined;
    } else if (frame.t === "kill") {
      proc.attached = undefined;
      proc.child.kill();
    }
  }

  #byChannel(peer: Peer, ch: unknown): Proc | undefined {
    for (const proc of this.#procs.values()) if (proc.attached?.peer === peer && proc.attached.ch === ch) return proc;
    return undefined;
  }

  async #open(peer: Peer, params: Record<string, unknown>): Promise<{ pid: number | undefined; reused: boolean }> {
    const key = typeof params["key"] === "string" ? params["key"] : "";
    const ch = params["ch"];
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(key) || typeof ch !== "number" || !isRecord(params["launch"])) throw new Error("Invalid remote session request.");
    let proc = this.#procs.get(key);
    const reused = Boolean(proc && !proc.exited);
    if (proc && !proc.exited) {
      // A second gateway (or a reconnect) takes over; the old view ends.
      if (proc.attached && proc.attached.peer !== peer) proc.attached.peer.send({ t: "exit", ch: proc.attached.ch, message: "This session was opened from another HUI." });
    } else {
      proc = await this.#spawn(key, this.#bots.launchFor(key, params["launch"] as RemoteLaunch));
      if (this.#bots.has(key)) {
        const spawned = proc;
        // A bot's first conversation may start from a gateway; later scheduled
        // runs must continue that transcript rather than fork a new one.
        void this.#rpc(spawned, { type: "get_state" }).then((state) => {
          const file = isRecord(state["data"]) ? state["data"]["sessionFile"] : undefined;
          if (typeof file === "string") return this.#bots.rememberSessionFile(key, file);
        }).catch(() => undefined);
      }
    }
    proc.attached = { peer, ch };
    this.#touch(proc);
    // Replayed after the reply is queued, so the gateway already owns the channel.
    const pending = [...proc.questions.values()];
    if (pending.length) setImmediate(() => peer.send({ t: "out", ch, d: pending.map((line) => `${line}\n`).join("") }));
    return { pid: proc.child.pid, reused };
  }

  async #spawn(key: string, launch: RemoteLaunch): Promise<Proc> {
    const cwd = resolveWorkingDirectory(launch.cwd, this.paths.home);
    const info = await stat(cwd).catch(() => undefined);
    if (!info?.isDirectory()) throw new Error(`No such directory on the remote: ${cwd}`);
    const { disabledSkills, ...rest } = launch;
    const bridge = await agentToolEnvironment(key);
    const child = spawn(process.execPath, [this.#workerEntry], {
      cwd, stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        ...bridge,
        PI_CODING_AGENT_DIR: this.paths.agentDir,
        PI_CLIENT_SESSION_ID: randomUUID(),
        HUI_PROVIDERS_DIR: this.paths.providersDir,
        HUI_WORKER_BROKER: "1",
        HUI_WORKER_FALLBACK_AUTH: join(this.paths.fallbackAgentDir, "auth.json"),
        HUI_DISABLED_SKILLS: JSON.stringify(disabledSkills ?? []),
        HUI_PI_WORKER_LAUNCH: JSON.stringify({ ...rest, cwd, agentDir: this.paths.agentDir }),
      },
    });
    const proc: Proc = {
      key, child, streaming: false, questions: new Map(), out: new LineSplitter(), in: new LineSplitter(),
      lastActive: Date.now(), exited: false, rpc: new Map(), idle: new Set(), stderr: "",
    };
    this.#procs.set(key, proc);
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => this.#stdout(proc, chunk));
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      proc.stderr = (proc.stderr + chunk).slice(-8192);
      if (proc.attached) proc.attached.peer.send({ t: "err", ch: proc.attached.ch, d: chunk });
    });
    child.stdin!.on("error", () => undefined);
    child.on("message", (message: unknown) => this.#ipc(proc, message));
    child.on("error", (error) => this.#exited(proc, null, null, error.message));
    child.on("exit", (code, signal) => this.#exited(proc, code, signal));
    return proc;
  }

  #stdout(proc: Proc, chunk: string): void {
    this.#touch(proc);
    const forward: string[] = [];
    for (const line of proc.out.push(chunk)) {
      let event: Record<string, unknown> | undefined;
      try { event = JSON.parse(line) as Record<string, unknown>; } catch { /* forwarded as-is */ }
      if (event?.["type"] === "response" && typeof event["id"] === "string" && proc.rpc.has(event["id"])) {
        proc.rpc.get(event["id"])!(event);
        proc.rpc.delete(event["id"]);
        continue;
      }
      if (event?.["type"] === "agent_start") proc.streaming = true;
      if (event?.["type"] === "agent_end") {
        proc.streaming = false;
        for (const listener of proc.idle) listener();
        proc.idle.clear();
      }
      if (event?.["type"] === "extension_ui_request" && typeof event["id"] === "string" && DIALOG_METHODS.has(String(event["method"]))) {
        proc.questions.set(event["id"], line);
      }
      forward.push(line);
    }
    if (forward.length && proc.attached) proc.attached.peer.send({ t: "out", ch: proc.attached.ch, d: `${forward.join("\n")}\n` });
  }

  #exited(proc: Proc, code: number | null, signal: NodeJS.Signals | null, message?: string): void {
    if (proc.exited) return;
    proc.exited = true;
    proc.streaming = false;
    for (const listener of proc.idle) listener();
    proc.idle.clear();
    for (const resolveRpc of proc.rpc.values()) resolveRpc({ success: false, error: message ?? "pi exited" });
    proc.rpc.clear();
    if (this.#procs.get(proc.key) === proc) this.#procs.delete(proc.key);
    if (proc.attached) proc.attached.peer.send({ t: "exit", ch: proc.attached.ch, code, signal, ...(message ? { message } : {}) });
    proc.attached = undefined;
  }

  /** PI worker side channel: credential brokering stays here, inspection
   * answers belong to the attached gateway. */
  #ipc(proc: Proc, message: unknown): void {
    if (!isRecord(message)) return;
    if (message["type"] === "credential" && typeof message["id"] === "string") {
      void this.#credential(proc, message);
      return;
    }
    if (message["type"] === "credential-step-result" && typeof message["step"] === "string") {
      this.#stepResults.get(message["step"])?.(message);
      return;
    }
    if (proc.attached) proc.attached.peer.send({ t: "ipc", ch: proc.attached.ch, m: message });
  }

  /** The gateway preferred for a process: its own, else any connected one. */
  #gateway(proc?: Proc): Peer | undefined {
    if (proc?.attached && !proc.attached.peer.closed) return proc.attached.peer;
    for (const peer of this.#peers) if (!peer.closed) return peer;
    return undefined;
  }

  async #credential(proc: Proc, message: Record<string, unknown>): Promise<void> {
    const reply = (body: Record<string, unknown>) => {
      if (proc.child.connected) proc.child.send({ version: 1, type: "credential-result", id: message["id"], ...body });
    };
    const peer = this.#gateway(proc);
    if (!peer) { reply({ ok: false, offline: true }); return; }
    const step = `s${++this.#nextStep}`;
    this.#steps.set(step, { proc, id: String(message["id"]) });
    try {
      const result = await peer.request("credential", {
        op: message["op"], store: message["store"], providerId: message["providerId"], step,
      }, 120_000);
      reply({ ok: true, result });
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : "Credential request failed." });
    } finally {
      this.#steps.delete(step);
    }
  }

  /** Runs a `modify` callback in the PI worker while the gateway holds its lock. */
  #credentialStep(params: Record<string, unknown>): Promise<unknown> {
    const name = typeof params["step"] === "string" ? params["step"] : "";
    const step = this.#steps.get(name);
    if (!step || !step.proc.child.connected) return Promise.reject(new Error("That credential update is no longer pending."));
    return new Promise((resolveStep, reject) => {
      const timer = setTimeout(() => { this.#stepResults.delete(name); reject(new Error("Credential update timed out on the remote.")); }, 60_000);
      this.#stepResults.set(name, (message) => {
        clearTimeout(timer);
        this.#stepResults.delete(name);
        if (message["ok"] === true) resolveStep({ next: message["next"] });
        else reject(new Error(typeof message["error"] === "string" ? message["error"] : "Credential update failed."));
      });
      step.proc.child.send({ version: 1, type: "credential-step", id: step.id, step: name, current: params["current"] });
    });
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

  /** One scheduled bot turn: start (or reuse) its worker, prompt, wait to settle. */
  async #runBot(bot: BotRecord, launch: RemoteLaunch, signal: AbortSignal): Promise<{ sessionFile?: string; summary?: string }> {
    let proc = this.#procs.get(bot.key);
    if (proc && !proc.exited && (proc.streaming || proc.questions.size)) throw new Error("The bot is busy.");
    if (!proc || proc.exited) proc = await this.#spawn(bot.key, launch);
    const target = proc;
    const rpc = (command: Record<string, unknown>) => this.#rpc(target, command);
    const settled = new Promise<void>((done) => target.idle.add(done));
    const accepted = await rpc({ type: "prompt", message: bot.prompt });
    if (accepted["success"] === false) throw new Error(String(accepted["error"] ?? "PI rejected the bot prompt."));
    const onAbort = () => { void rpc({ type: "abort" }).catch(() => undefined); };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await settled;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (target.exited) throw new Error(target.stderr.trim().split("\n").at(-1) || "The bot's PI worker exited.");
    const state = await rpc({ type: "get_state" }).catch(() => ({} as Record<string, unknown>));
    const data = isRecord(state["data"]) ? state["data"] : {};
    const messages = await rpc({ type: "get_messages" }).catch(() => ({} as Record<string, unknown>));
    const list = isRecord(messages["data"]) && Array.isArray(messages["data"]["messages"]) ? messages["data"]["messages"] : [];
    const last = [...list].reverse().find((message) => isRecord(message) && message["role"] === "assistant") as Record<string, unknown> | undefined;
    const summary = Array.isArray(last?.["content"])
      ? (last["content"] as unknown[]).filter((part): part is { type: string; text: string } => isRecord(part) && part["type"] === "text" && typeof part["text"] === "string").map((part) => part.text).join("").slice(0, 500)
      : undefined;
    // Nobody is watching: free the process, the transcript is on disk.
    if (!target.attached) target.child.kill();
    return { ...(typeof data["sessionFile"] === "string" ? { sessionFile: data["sessionFile"] } : {}), ...(summary ? { summary } : {}) };
  }

  /** Host-originated PI RPC; its response is consumed here, never forwarded. */
  #rpc(proc: Proc, command: Record<string, unknown>, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    return new Promise((done, reject) => {
      const id = `hui-host-${randomUUID()}`;
      const timer = setTimeout(() => { proc.rpc.delete(id); reject(new Error("The PI worker did not answer.")); }, timeoutMs);
      proc.rpc.set(id, (response) => { clearTimeout(timer); done(response); });
      proc.child.stdin!.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  #touch(proc?: Proc): void {
    this.#lastActivity = Date.now();
    if (proc) proc.lastActive = this.#lastActivity;
  }

  #sweep(): void {
    const now = Date.now();
    for (const proc of this.#procs.values()) {
      if (!proc.attached && !proc.streaming && !proc.questions.size && !proc.rpc.size && now - proc.lastActive > DETACHED_IDLE_MS) proc.child.kill();
    }
    if (!this.#procs.size && !this.#peers.size && !this.#bots.active() && now - this.#lastActivity > HOST_IDLE_MS) {
      void this.close().finally(() => process.exit(0));
    }
  }
}
