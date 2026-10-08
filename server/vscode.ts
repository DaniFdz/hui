/**
 * The VS Code view's process side: finding a compatible openvscode-server, running one shared instance for the
 * gateway, and the capabilities a browser frame trades for access to it.
 *
 * The server starts on the first open, listens on 127.0.0.1 on a free port behind a random connection token that is
 * rotated on every start, keeps its data under HUI's config directory and stops with the gateway, after an idle
 * period with no open connections, or when Settings turn it off. It runs in its own process group (openvscode-server
 * is a shell script around node, with extension hosts below it), and every stop signals the whole group. A crash is
 * reported and only an explicit open starts it again; nothing restarts it in a loop. Nothing here blocks a gateway
 * stop. Carrying HTTP and WebSocket traffic to it is vscode-proxy.ts's job; the routes live in hui.ts.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { Agent, get as httpGet } from "node:http";
import { createServer } from "node:net";
import { homedir, userInfo } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import {
  VSCODE_BASE_PATH, VSCODE_ENTER_PATH, VSCODE_OFF_REASON,
  type VscodeConnection, type VscodeErrorCode, type VscodeExecutableInfo, type VscodeState, type VscodeStatus, type VscodeTheme,
} from "../shared/vscode.ts";
import type { VscodeSettings } from "../src/lib/settings.ts";

export class VscodeError extends Error {
  status: number;
  code: VscodeErrorCode;
  constructor(message: string, status = 409, code: VscodeErrorCode = "failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ── Finding an executable ──────────────────────────────────────────────────────────────────────────────────────

export type VscodeProbe = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  isExecutable: (path: string) => Promise<boolean>;
  /** The executable's `--help` output; throws when it cannot run. */
  help: (path: string) => Promise<string>;
};

export type VscodeResolution =
  | { executable: VscodeExecutableInfo; error?: undefined }
  | { executable: null; error: string };

/** The flags HUI launches with. A server without them (code-server's `--bind-addr`/`--auth` CLI) cannot sit behind
 * HUI's proxy, so it is reported, never launched. */
export const REQUIRED_VSCODE_FLAGS = ["--server-base-path", "--connection-token-file", "--server-data-dir", "--extensions-dir"] as const;
/** Auto-detection order. code-server is tried only to say why it does not fit, or to use a build whose CLI does. */
const COMMANDS = ["openvscode-server", "code-server"] as const;

/** A server's banner is its first non-empty line, "OpenVSCode Server 1.109.5". */
export function parseVscodeHelp(path: string, help: string): { name: string; version: string } | { error: string } {
  const banner = help.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "";
  const match = /^(.*?)\s+v?(\d+\.\d+\.\d+[\w.+-]*)\b/u.exec(banner);
  const name = match?.[1]?.trim() || banner || "This program";
  const missing = REQUIRED_VSCODE_FLAGS.filter((flag) => !help.includes(flag));
  if (missing.length > 0) {
    return { error: `${name}${match ? ` ${match[2]}` : ""} at ${path} cannot run behind HUI: it has no ${missing.join(", ")}. Install openvscode-server.` };
  }
  return { name, version: match?.[2] ?? "unknown version" };
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** One `--help` run per executable version: Settings and every launcher poll the status. */
const helpCache = new Map<string, Promise<string>>();
async function cachedHelp(path: string): Promise<string> {
  const info = await stat(path);
  const key = `${path}\0${info.mtimeMs}\0${info.size}`;
  let pending = helpCache.get(key);
  if (!pending) {
    pending = promisify(execFile)(path, ["--help"], { timeout: 20_000, maxBuffer: 1024 * 1024, env: vscodeEnvironment(process.env) })
      .then(({ stdout, stderr }) => `${stdout}\n${stderr}`);
    pending.catch(() => helpCache.delete(key));
    if (helpCache.size > 16) helpCache.clear();
    helpCache.set(key, pending);
  }
  return pending;
}

export function defaultVscodeProbe(): VscodeProbe {
  return { platform: process.platform, env: process.env, home: homedir(), isExecutable: isExecutableFile, help: cachedHelp };
}

/** PATH first, then the places a package manager puts binaries that a launchd or systemd PATH often lacks. */
export function vscodeSearchPath(probe: Pick<VscodeProbe, "env" | "home">): string[] {
  let user = probe.env["USER"] ?? "";
  if (!user) { try { user = userInfo().username; } catch { user = ""; } }
  const directories = [
    ...(probe.env["PATH"] ?? "").split(delimiter),
    "/opt/homebrew/bin", "/usr/local/bin",
    join(probe.home, ".nix-profile", "bin"),
    ...(user ? [`/etc/profiles/per-user/${user}/bin`] : []),
    "/run/current-system/sw/bin", "/nix/var/nix/profiles/default/bin",
  ];
  return [...new Set(directories.filter((directory) => directory && isAbsolute(directory)))];
}

export async function resolveVscodeExecutable(configured: string, probe: VscodeProbe = defaultVscodeProbe()): Promise<VscodeResolution> {
  const inspect = async (path: string, source: VscodeExecutableInfo["source"]): Promise<VscodeResolution> => {
    let help: string;
    try { help = await probe.help(path); } catch (error) {
      return { executable: null, error: `${path} did not run: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
    }
    const parsed = parseVscodeHelp(path, help);
    return "error" in parsed ? { executable: null, error: parsed.error } : { executable: { path, ...parsed, source } };
  };
  const raw = configured.trim();
  if (raw) {
    const path = raw === "~" || raw.startsWith("~/") ? join(probe.home, raw.slice(2)) : raw;
    if (!isAbsolute(path)) return { executable: null, error: "The VS Code executable must be an absolute path." };
    if (!(await probe.isExecutable(path))) return { executable: null, error: `No executable was found at ${path}.` };
    return inspect(path, "configured");
  }
  const rejected: string[] = [];
  for (const command of COMMANDS) {
    for (const directory of vscodeSearchPath(probe)) {
      const path = join(directory, command);
      if (!(await probe.isExecutable(path))) continue;
      const resolution = await inspect(path, "detected");
      if (resolution.executable) return resolution;
      rejected.push(resolution.error);
      break;
    }
  }
  return {
    executable: null,
    error: rejected.length > 0
      ? `No compatible VS Code server was found. ${rejected.join(" ")}`
      : "openvscode-server was not found on PATH. Install it, or set its path in Settings → Tools → VS Code.",
  };
}

// ── Running it ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The gateway's environment without what belongs to it: agent bridge credentials and a parent VS Code's hooks. */
export function vscodeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined && !key.startsWith("HUI_AGENT_") && !key.startsWith("VSCODE_")));
}

export function vscodeLaunchArguments(options: { port: number; tokenFile: string; dir: string }): string[] {
  return [
    "--host", "127.0.0.1",
    "--port", String(options.port),
    "--connection-token-file", options.tokenFile,
    "--server-base-path", VSCODE_BASE_PATH,
    "--server-data-dir", join(options.dir, "server-data"),
    "--user-data-dir", join(options.dir, "user-data"),
    "--extensions-dir", join(options.dir, "extensions"),
    "--accept-server-license-terms",
    "--telemetry-level", "off",
  ];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("No free port.")));
    });
  });
}

/** Loopback requests never go through an ambient HTTP proxy. */
export const vscodeAgent = new Agent({ keepAlive: true, maxSockets: 64 });

function probeVersion(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = httpGet({ host: "127.0.0.1", port, path: `${VSCODE_BASE_PATH}/version`, agent: vscodeAgent, timeout: 1_000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(false));
  });
}

/** Signals a server's whole process group; on Windows, which has none, just the process. */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch { /* already gone */ }
}

function groupAlive(pid: number): boolean {
  if (process.platform === "win32") return false;
  try { process.kill(-pid, 0); return true; } catch { return false; }
}

/** Process groups of servers this gateway runs, signalled if the gateway exits without stopping them. */
const liveGroups = new Set<ChildProcess>();
let exitHookInstalled = false;
function trackGroup(child: ChildProcess) {
  liveGroups.add(child);
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => { for (const group of liveGroups) signalGroup(group, "SIGTERM"); });
}

type Running = {
  child: ChildProcess;
  port: number;
  token: string;
  instance: number;
  startedAt: string;
  configured: string;
  stopping: boolean;
  exited: Promise<void>;
  output: string[];
};

type Ticket = { folder: string; theme?: VscodeTheme; expires: number };
type CookieSession = { theme?: VscodeTheme; expires: number };

export type VscodeServiceOptions = {
  /** HUI's VS Code directory: server data, extensions, the token file and the pid file. */
  dir: string;
  settings: () => Promise<VscodeSettings>;
  probe?: VscodeProbe;
  /** Stop after this long without a connection; 15 minutes by default. */
  idleMs?: number;
  readyTimeoutMs?: number;
  ticketMs?: number;
  /** A frame's cookie stays valid this long after its last request. */
  sessionMs?: number;
  env?: () => NodeJS.ProcessEnv;
  now?: () => number;
};

const MAX_TICKETS = 64;
const MAX_SESSIONS = 32;
const OUTPUT_LINES = 20;

function lastLines(output: readonly string[]): string {
  return output.join("").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(-3).join(" · ");
}

function exitDescription(code: number | null, signal: NodeJS.Signals | null): string {
  return signal ? signal : `exit code ${code ?? "unknown"}`;
}

export class VscodeService {
  readonly dir: string;
  readonly idleMs: number;
  #options: VscodeServiceOptions;
  #probe: VscodeProbe;
  #running: Running | undefined;
  #starting: Promise<Running> | undefined;
  #state: Exclude<VscodeState, "off" | "unavailable"> = "stopped";
  #lastError = "";
  #instance = 0;
  #connections = 0;
  #idle: ReturnType<typeof setTimeout> | undefined;
  #enabled: boolean | undefined;
  #reaped = false;
  #disposed = false;
  readonly #tickets = new Map<string, Ticket>();
  readonly #sessions = new Map<string, CookieSession>();

  constructor(options: VscodeServiceOptions) {
    this.#options = options;
    this.dir = options.dir;
    this.idleMs = options.idleMs ?? 15 * 60_000;
    this.#probe = options.probe ?? defaultVscodeProbe();
  }

  #now(): number { return this.#options.now?.() ?? Date.now(); }

  get tokenFile(): string { return join(this.dir, "connection-token"); }
  get #pidFile(): string { return join(this.dir, "server.json"); }

  async status(): Promise<VscodeStatus> {
    const settings = await this.#options.settings();
    this.#enabled = settings.enabled;
    const resolution = await resolveVscodeExecutable(settings.executable, this.#probe);
    const running = this.#running;
    const state: VscodeState = !settings.enabled ? "off" : running || this.#starting ? this.#state : resolution.executable ? this.#state : "unavailable";
    return {
      enabled: settings.enabled,
      configuredExecutable: settings.executable,
      executable: resolution.executable,
      executableError: resolution.error ?? "",
      state,
      instance: this.#instance,
      ...(running?.child.pid ? { pid: running.child.pid } : {}),
      ...(running ? { startedAt: running.startedAt } : {}),
      lastError: this.#lastError,
      connections: this.#connections,
      idleMinutes: Math.round(this.idleMs / 60_000),
      dataDir: this.dir,
    };
  }

  /** The running server, if there is one. The proxy uses only this: a frame's requests never start VS Code, so a
   * crashed server is not restarted by its own reconnecting workbench. */
  current(): { port: number; token: string; instance: number } | undefined {
    const running = this.#running;
    return running && !running.stopping ? running : undefined;
  }

  /** The running server, started now if it is not. Concurrent callers share one start. */
  async ensure(): Promise<{ port: number; token: string; instance: number }> {
    if (this.#disposed) throw new VscodeError("The gateway is stopping.", 503, "failed");
    const settings = await this.#options.settings();
    this.#enabled = settings.enabled;
    if (!settings.enabled) throw new VscodeError(VSCODE_OFF_REASON, 409, "disabled");
    const running = this.#running;
    if (running && !running.stopping) return running;
    this.#starting ??= this.#start(settings).finally(() => { this.#starting = undefined; });
    return this.#starting;
  }

  async #start(settings: VscodeSettings): Promise<Running> {
    if (this.#running) await this.#running.exited;
    const resolution = await resolveVscodeExecutable(settings.executable, this.#probe);
    if (!resolution.executable) throw new VscodeError(resolution.error, 409, "not-found");
    const executable = resolution.executable;
    this.#state = "starting";
    this.#lastError = "";
    try {
      await this.#reapStale();
      for (const sub of ["server-data", "user-data", "extensions"]) await mkdir(join(this.dir, sub), { recursive: true, mode: 0o700 });
      await chmod(this.dir, 0o700);
      const token = randomBytes(32).toString("base64url");
      await writeFile(this.tokenFile, token, { mode: 0o600 });
      await chmod(this.tokenFile, 0o600);
      const port = await freePort();
      const child = spawn(executable.path, vscodeLaunchArguments({ port, tokenFile: this.tokenFile, dir: this.dir }), {
        env: vscodeEnvironment(this.#options.env?.() ?? process.env),
        stdio: ["ignore", "pipe", "pipe"],
        // Its own process group, so a stop reaches node and the extension hosts behind the launcher script.
        detached: process.platform !== "win32",
      });
      trackGroup(child);
      // stdout is VS Code's routine log; only stderr explains a failure.
      const output: string[] = [];
      child.stdout?.resume();
      child.stderr?.on("data", (chunk: Buffer) => { output.push(chunk.toString("utf8")); if (output.length > OUTPUT_LINES) output.shift(); });
      const exited = new Promise<void>((resolve) => child.once("exit", () => {
        // The launcher script is gone; whatever is left of its group follows it.
        void this.#reapGroup(child).finally(() => { liveGroups.delete(child); resolve(); });
      }));
      const running: Running = {
        child, port, token, instance: ++this.#instance, startedAt: new Date(this.#now()).toISOString(),
        configured: settings.executable, stopping: false, exited, output,
      };
      let spawnError: Error | undefined;
      child.once("error", (error) => { spawnError = error; });
      const deadline = Date.now() + (this.#options.readyTimeoutMs ?? 60_000);
      for (;;) {
        if (spawnError) throw new VscodeError(`${executable.name} could not be started: ${spawnError.message}`, 502);
        if (child.exitCode !== null || child.signalCode !== null) {
          const detail = lastLines(output);
          throw new VscodeError(`${executable.name} exited while starting (${exitDescription(child.exitCode, child.signalCode)})${detail ? `: ${detail}` : "."}`, 502);
        }
        if (await probeVersion(port)) break;
        if (Date.now() > deadline) {
          signalGroup(child, "SIGKILL");
          throw new VscodeError(`${executable.name} did not answer on 127.0.0.1:${port} within ${Math.round((this.#options.readyTimeoutMs ?? 60_000) / 1000)} seconds.`, 502);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (this.#disposed) { signalGroup(child, "SIGTERM"); throw new VscodeError("The gateway is stopping.", 503); }
      this.#running = running;
      this.#state = "running";
      child.once("exit", (code, signal) => this.#exited(running, code, signal));
      void writeFile(this.#pidFile, JSON.stringify({ pid: child.pid, dataDir: join(this.dir, "server-data") }), { mode: 0o600 }).catch(() => undefined);
      this.#scheduleIdle();
      return running;
    } catch (error) {
      this.#state = "failed";
      this.#lastError = error instanceof Error ? error.message : String(error);
      throw error instanceof VscodeError ? error : new VscodeError(this.#lastError, 502);
    }
  }

  #exited(running: Running, code: number | null, signal: NodeJS.Signals | null) {
    if (this.#running !== running) return;
    this.#running = undefined;
    this.#clearIdle();
    if (running.stopping) {
      this.#state = "stopped";
    } else {
      this.#state = "failed";
      const detail = lastLines(running.output);
      this.#lastError = `VS Code exited unexpectedly (${exitDescription(code, signal)})${detail ? `: ${detail}` : "."}`;
    }
    void rm(this.#pidFile, { force: true }).catch(() => undefined);
  }

  /** Gives the rest of a group a moment to finish after its leader exits, then kills what remains. */
  async #reapGroup(child: ChildProcess) {
    const pid = child.pid;
    if (!pid || !groupAlive(pid)) return;
    signalGroup(child, "SIGTERM");
    const deadline = Date.now() + 3_000;
    while (groupAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    if (groupAlive(pid)) signalGroup(child, "SIGKILL");
  }

  /** A server a killed gateway left behind is stopped before a new one starts: its recorded process group, but only
   * when a member of that group still names this data directory. */
  async #reapStale() {
    if (this.#reaped) return;
    this.#reaped = true;
    let record: { pid?: unknown; dataDir?: unknown };
    try { record = JSON.parse(await readFile(this.#pidFile, "utf8")) as typeof record; } catch { return; }
    const pid = typeof record.pid === "number" ? record.pid : 0;
    const dataDir = typeof record.dataDir === "string" ? record.dataDir : "";
    await rm(this.#pidFile, { force: true }).catch(() => undefined);
    if (!pid || !dataDir || pid === process.pid || process.platform === "win32" || !groupAlive(pid)) return;
    let listing = "";
    try { listing = (await promisify(execFile)("ps", ["-axo", "pgid=,command="], { timeout: 5_000, maxBuffer: 8 * 1024 * 1024 })).stdout; } catch { return; }
    const owned = listing.split("\n").some((line) => {
      const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
      return match?.[1] === String(pid) && (match[2] ?? "").includes(dataDir);
    });
    if (owned) { try { process.kill(-pid, "SIGTERM"); } catch { /* already gone */ } }
  }

  /** A proxied request or socket holds the server open; the release starts the idle countdown once none is left. */
  acquire(): () => void {
    this.#connections++;
    this.#clearIdle();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#connections--;
      this.#scheduleIdle();
    };
  }

  #clearIdle() {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = undefined;
  }

  #scheduleIdle() {
    this.#clearIdle();
    if (this.#connections > 0 || !this.#running) return;
    this.#idle = setTimeout(() => { this.#idle = undefined; if (this.#connections === 0) void this.stop(); }, this.idleMs);
    this.#idle.unref();
  }

  async connect(folder: string, theme: VscodeTheme | undefined): Promise<VscodeConnection> {
    const server = await this.ensure();
    const now = this.#now();
    for (const [key, ticket] of this.#tickets) if (ticket.expires <= now) this.#tickets.delete(key);
    if (this.#tickets.size >= MAX_TICKETS) throw new VscodeError("Too many pending VS Code connections.", 429, "busy");
    const ticket = randomBytes(32).toString("base64url");
    this.#tickets.set(ticket, { folder, ...(theme ? { theme } : {}), expires: now + (this.#options.ticketMs ?? 30_000) });
    const home = this.#probe.home;
    const label = folder === home ? "~" : folder.startsWith(`${home}/`) ? `~${folder.slice(home.length)}` : folder;
    return { url: `${VSCODE_ENTER_PATH}?ticket=${ticket}`, folder, label, instance: server.instance };
  }

  /** Trades a ticket, once, for a cookie secret. */
  enter(ticket: string): { secret: string; folder: string } | undefined {
    const entry = this.#tickets.get(ticket);
    this.#tickets.delete(ticket);
    const now = this.#now();
    if (!entry || entry.expires <= now || this.#enabled === false) return undefined;
    for (const [key, session] of this.#sessions) if (session.expires <= now) this.#sessions.delete(key);
    while (this.#sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.#sessions].sort(([, a], [, b]) => a.expires - b.expires)[0];
      if (!oldest) break;
      this.#sessions.delete(oldest[0]);
    }
    const secret = randomBytes(32).toString("base64url");
    this.#sessions.set(secret, { ...(entry.theme ? { theme: entry.theme } : {}), expires: now + (this.#options.sessionMs ?? 12 * 60 * 60_000) });
    return { secret, folder: entry.folder };
  }

  /** The cookie session one of these secrets names, refreshed; undefined when none is valid. */
  session(secrets: readonly string[]): CookieSession | undefined {
    const now = this.#now();
    for (const secret of secrets) {
      const session = this.#sessions.get(secret);
      if (!session) continue;
      if (session.expires <= now) { this.#sessions.delete(secret); continue; }
      session.expires = now + (this.#options.sessionMs ?? 12 * 60 * 60_000);
      return session;
    }
    return undefined;
  }

  /** Turning the view off withdraws every capability and stops the server; a new executable applies to the next start. */
  async applySettings(next: VscodeSettings): Promise<void> {
    this.#enabled = next.enabled;
    if (!next.enabled) {
      this.#tickets.clear();
      this.#sessions.clear();
      await this.stop();
    } else if (this.#running && this.#running.configured !== next.executable) {
      await this.stop();
    }
  }

  async stop(): Promise<void> {
    if (this.#starting) await this.#starting.catch(() => undefined);
    const running = this.#running;
    this.#clearIdle();
    if (!running) {
      if (this.#state !== "failed") this.#state = "stopped";
      return;
    }
    running.stopping = true;
    signalGroup(running.child, "SIGTERM");
    const killed = setTimeout(() => signalGroup(running.child, "SIGKILL"), 5_000);
    killed.unref();
    await running.exited;
    clearTimeout(killed);
  }

  /** With the gateway: signals the server and returns at once, so a stop or restart never waits for it. */
  dispose(): void {
    this.#disposed = true;
    this.#clearIdle();
    this.#tickets.clear();
    this.#sessions.clear();
    const running = this.#running;
    if (!running) return;
    running.stopping = true;
    signalGroup(running.child, "SIGTERM");
    setTimeout(() => signalGroup(running.child, "SIGKILL"), 2_000).unref();
  }
}
