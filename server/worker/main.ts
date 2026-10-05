/**
 * Remote entry point.
 *
 *   main connect   bridge this process's stdio to the host daemon, starting it
 *                  first if needed. A gateway runs this through its connect
 *                  command (ssh, docker exec, …); when that command dies the
 *                  daemon and its sessions keep running.
 *   main daemon    the long-lived host itself (see host.ts).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { workerPaths } from "./paths.ts";

const paths = workerPaths();
const LOG_LIMIT = 5 * 1024 * 1024;
const PID_FILE = join(paths.stateDir, "host.pid");
/** Stable path to the agent of the newest connection, so git in a long-lived
 * host uses the operator's forwarded SSH agent (`ssh -A`) while connected. */
const AGENT_LINK = join(dirname(paths.socket), "agent.sock");

/** A live host, not a recycled pid (a restarted container or VM). */
function hostRunning(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") return false; }
  let command: string | undefined;
  try { command = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " "); } catch {
    const ps = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    if (ps.status === 0) command = ps.stdout;
  }
  return command === undefined || /worker\/main\.[jt]s daemon/u.test(command);
}

/** One host per data directory. */
function lock(): boolean {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(PID_FILE, String(process.pid), { flag: "wx", mode: 0o600 });
      process.on("exit", () => { try { if (readFileSync(PID_FILE, "utf8") === String(process.pid)) unlinkSync(PID_FILE); } catch { /* gone */ } });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(readFileSync(PID_FILE, "utf8"));
      // ponytail: two hosts starting against one stale lock can both win; needs flock-style locking if that ever matters.
      // In a restarted container this very process may have the old pid.
      if (pid && pid !== process.pid && hostRunning(pid)) return false;
      rmSync(PID_FILE, { force: true });
    }
  }
  return false;
}

function shareAgent(): void {
  const agent = process.env["SSH_AUTH_SOCK"];
  if (!agent) return;
  try {
    mkdirSync(dirname(AGENT_LINK), { recursive: true, mode: 0o700 });
    const temporary = `${AGENT_LINK}.${process.pid}`;
    rmSync(temporary, { force: true });
    symlinkSync(agent, temporary);
    renameSync(temporary, AGENT_LINK);
  } catch { /* git falls back to the remote's own keys */ }
}

function tryConnect(): Promise<Socket | undefined> {
  return new Promise((resolve) => {
    const socket = connect(paths.socket);
    socket.once("connect", () => resolve(socket));
    socket.once("error", () => resolve(undefined));
  });
}

function startDaemon(): void {
  mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
  const log = join(paths.stateDir, "host.log");
  try { if (statSync(log).size > LOG_LIMIT) renameSync(log, `${log}.1`); } catch { /* first start */ }
  const fd = openSync(log, "a", 0o600);
  spawn(process.execPath, [fileURLToPath(import.meta.url), "daemon"], {
    cwd: paths.home, detached: true, stdio: ["ignore", fd, fd],
  }).unref();
}

async function runConnect(): Promise<void> {
  shareAgent();
  let socket = await tryConnect();
  if (!socket) {
    startDaemon();
    for (let attempt = 0; attempt < 200 && !socket; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      socket = await tryConnect();
    }
  }
  if (!socket) throw new Error("The HUI worker host did not start. See ~/.local/share/hui-worker/state/host.log.");
  // Everything before this line may be shell noise; the gateway waits for it.
  process.stdout.write(`${JSON.stringify({ t: "ready" })}\n`);
  socket.pipe(process.stdout);
  process.stdin.pipe(socket);
  socket.on("close", () => process.exit(0));
  process.stdin.on("end", () => socket.end());
}

/** The login shell's environment, so tools see the PATH the user sees over an
 * interactive SSH login rather than the minimal one of a non-login command. */
function loginEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
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

async function runDaemon(): Promise<void> {
  mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
  if (!lock()) return;
  // The first connection's SSH session ends long before this host does.
  for (const name of ["SSH_AUTH_SOCK", "SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"]) delete process.env[name];
  // The host and everything it starts (PI, npm, agent tools) see the login PATH.
  const env = loginEnvironment();
  // A profile that starts its own agent wins over the forwarded one.
  Object.assign(process.env, env, { SSH_AUTH_SOCK: env["SSH_AUTH_SOCK"] ?? AGENT_LINK });
  // HUI's and PI's configuration on this machine is the mirror of the
  // gateway's, read by the host's modules at import. Agent shells must not
  // inherit it: a `hui` or `pi` started there would open the mirror and the
  // host's store. PI workers get their agent directory explicitly.
  process.env["HUI_CONFIG_DIR"] = join(paths.mirrorDir, "hui");
  process.env["PI_CODING_AGENT_DIR"] = paths.agentDir;
  const { WorkerHost } = await import("./host.ts");
  delete process.env["HUI_CONFIG_DIR"];
  delete process.env["PI_CODING_AGENT_DIR"];
  const host = new WorkerHost(paths);
  // Holding the lock, any socket left behind is stale.
  await unlink(paths.socket).catch(() => undefined);
  await host.listen();
  const stop = () => { void host.close().finally(() => process.exit(0)); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("SIGHUP", () => undefined);
  console.error(`[${new Date().toISOString()}] HUI worker host ${host.info().release} listening (pid ${process.pid})`);
}

const mode = process.argv[2];
try {
  if (mode === "connect") await runConnect();
  else if (mode === "daemon") await runDaemon();
  else throw new Error("Usage: main connect|daemon");
} catch (error) {
  process.stderr.write(`hui worker: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
