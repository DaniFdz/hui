/** The background gateway's lifecycle as seen from the CLI: start it detached, report its status, stop it and tail its
 * log. Every action is checked against the recorded state file and the gateway's authenticated control endpoint; a PID
 * alone never authorizes a signal, and the gateway itself rechecks which active work a stop would interrupt. */
import { execFile, spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { GatewayOptions } from "../server/gateway.ts";
import { LOG_FILE, processAlive, readState, removeState, type GatewayState } from "./state.ts";

/** `resumableSessions` counts the active sessions a restart does not interrupt
 * (Pi Durable runs); the rest of `activeSessions` blocks an ordinary stop. */
export type GatewayStatus = { status: "running" | "stopped" | "unresponsive"; pid?: number; version?: string; url?: string; activeSessions?: number; resumableSessions?: number; activeTerminals?: number; startedAt?: string };
type ControlStatus = { instance: string; pid: number; version: string; url: string; activeSessions: number; resumableSessions?: number; activeTerminals?: number };

const execFileAsync = promisify(execFile);

const count = (value: unknown) => value === undefined || Number.isInteger(value) && (value as number) >= 0;

/** Active sessions an ordinary stop refuses. A gateway that predates
 * `resumableSessions` has every active session count. */
export function blockingSessions(status: Pick<GatewayStatus, "activeSessions" | "resumableSessions">): number {
  return Math.max(0, (status.activeSessions ?? 0) - (status.resumableSessions ?? 0));
}

export async function controlRequest(state: GatewayState, path: string, method = "GET"): Promise<ControlStatus> {
  const response = await fetch(new URL(path, state.controlUrl), {
    method, headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(3_000), redirect: "error",
  });
  const body = await response.json() as ControlStatus & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Gateway control returned HTTP ${response.status}.`);
  if (body.instance !== state.instance || method === "GET" && (body.pid !== state.pid || body.version !== state.version || !Number.isInteger(body.activeSessions) || !count(body.resumableSessions) || (body.resumableSessions ?? 0) > body.activeSessions || !count(body.activeTerminals))) {
    throw new Error("Gateway identity did not match its state file. Nothing was stopped.");
  }
  return body;
}

export async function gatewayStatus(): Promise<GatewayStatus> {
  const state = await readState();
  if (!state) return { status: "stopped" };
  try {
    const reply = await controlRequest(state, "status");
    return { status: "running", pid: state.pid, version: reply.version, url: reply.url, activeSessions: reply.activeSessions, resumableSessions: reply.resumableSessions ?? 0, activeTerminals: reply.activeTerminals ?? 0, startedAt: state.startedAt };
  } catch {
    return { status: processAlive(state.pid) ? "unresponsive" : "stopped", pid: state.pid, version: state.version, url: state.url };
  }
}

/** Called under the lifecycle lock. A PID alone never authorizes a signal. */
export async function startGateway(options: GatewayOptions): Promise<GatewayStatus> {
  const existing = await gatewayStatus();
  if (existing.status === "running") return existing;
  if (existing.status === "unresponsive") throw new Error("Recorded gateway is alive but cannot be authenticated. Inspect its logs/process; refusing to start a duplicate.");
  const stale = await readState();
  if (stale) await removeState(stale.instance);
  const log = await open(LOG_FILE, "a", 0o600);
  const child = spawn(process.execPath, [join(options.packageRoot, "build/cli/gateway-run.js")], {
    cwd: options.packageRoot, detached: true, stdio: ["ignore", log.fd, log.fd, "ipc"], env: process.env,
  });
  await log.close();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Gateway startup timed out. See ${LOG_FILE}.`)); }, 20_000);
    const fail = (error: Error) => { clearTimeout(timer); reject(error); };
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`Gateway exited during startup (${code}). See ${LOG_FILE}.`)));
    child.once("message", (raw: unknown) => {
      clearTimeout(timer);
      const message = raw as { ready?: boolean; error?: string };
      if (message.ready) resolve(); else reject(new Error(message.error ?? "Gateway startup failed."));
    });
    child.send(options, (error) => { if (error) fail(error); });
  });
  child.unref();
  const result = await gatewayStatus();
  if (result.status !== "running") throw new Error(`Gateway failed its readiness check. See ${LOG_FILE}.`);
  return result;
}

/** How long a forced stop waits before it escalates, and how long it waits for the last signal to land. */
const TERM_GRACE_MS = 3_000;
const KILL_GRACE_MS = 2_000;

/** Whether the recorded PID still runs the recorded gateway. A wedged gateway cannot prove its identity over its
 * control endpoint, and a PID alone never authorizes a signal, so the command line has to name this installation's
 * `gateway-run.js`. */
async function runsRecordedGateway(state: GatewayState): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(state.pid), "-o", "command="]);
    return stdout.includes(join(state.packageRoot, "build/cli/gateway-run.js"));
  } catch {
    return false;
  }
}

/** Ends a gateway that cannot stop itself: SIGTERM, then SIGKILL. */
async function terminateGateway(state: GatewayState): Promise<void> {
  const signal = (name: NodeJS.Signals) => {
    try { process.kill(state.pid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  };
  const exited = async (budget: number) => {
    for (const deadline = Date.now() + budget; Date.now() < deadline;) {
      if (!processAlive(state.pid)) return true;
      await delay(50);
    }
    return !processAlive(state.pid);
  };
  signal("SIGTERM");
  if (!(await exited(TERM_GRACE_MS))) {
    signal("SIGKILL");
    if (!(await exited(KILL_GRACE_MS))) throw new Error(`Gateway pid ${state.pid} did not exit after SIGKILL.`);
  }
  await removeState(state.instance);
}

export async function stopGateway(force = false): Promise<GatewayState | undefined> {
  const state = await readState();
  if (!state) return undefined;
  const status = await gatewayStatus();
  if (status.status === "stopped") { await removeState(state.instance); return undefined; }
  if (status.status !== "running") {
    if (!force) throw new Error("Gateway identity/health could not be verified. Refusing to signal a recorded PID. Retry with --force if the process is wedged.");
    if (!(await runsRecordedGateway(state))) throw new Error(`Gateway identity/health could not be verified. Refusing to signal a recorded PID: ${state.pid} is not this installation's gateway.`);
    await terminateGateway(state);
    return state;
  }
  await controlRequest(state, force ? "stop?force=1" : "stop", "POST");
  // Poll an observable ownership edge, not a guessed shutdown duration.
  const deadline = Date.now() + 10_000;
  while ((await readState())?.instance === state.instance || processAlive(state.pid)) {
    if (Date.now() >= deadline) {
      if (!force) throw new Error("Gateway did not finish shutting down. No replacement was started.");
      if (!(await runsRecordedGateway(state))) throw new Error(`Gateway did not finish shutting down. Refusing to signal a recorded PID: ${state.pid} is not this installation's gateway.`);
      await terminateGateway(state);
      return state;
    }
    await delay(50);
  }
  return state;
}

export async function gatewayLogs(lines: number): Promise<string> {
  try {
    const file = await open(LOG_FILE, "r");
    try {
      const { size } = await file.stat();
      const buffer = Buffer.alloc(Math.min(size, 64 * 1024));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      return buffer.subarray(0, bytesRead).toString("utf8").split("\n").slice(-lines - 1).join("\n");
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "No gateway log yet.\n";
    throw error;
  }
}
