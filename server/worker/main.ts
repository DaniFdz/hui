/**
 * Remote entry point.
 *
 *   main connect   bridge this process's stdio to the host daemon, starting it
 *                  first if needed. A gateway runs this through its connect
 *                  command (ssh, docker exec, …); when that command dies the
 *                  daemon and its sessions keep running.
 *   main daemon    the long-lived host itself (see host.ts).
 */
import { spawn } from "node:child_process";
import { mkdirSync, openSync, statSync, renameSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loginEnvironment, WorkerHost } from "./host.ts";
import { workerPaths } from "./paths.ts";

const paths = workerPaths();
const LOG_LIMIT = 5 * 1024 * 1024;

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

async function runDaemon(): Promise<void> {
  // The host and everything it starts (PI, npm, agent tools) see the login PATH.
  Object.assign(process.env, loginEnvironment());
  const host = new WorkerHost(paths);
  try {
    await host.listen();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    const existing = await tryConnect();
    if (existing) { existing.destroy(); return; }
    await unlink(paths.socket);
    await host.listen();
  }
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
