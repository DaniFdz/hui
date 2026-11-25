/** Remote worker layout. Everything HUI writes on a remote lives under one
 * per-user data directory; the remote user's own files are never touched. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolvePiAgentDir } from "../pi/paths.ts";

export type WorkerPaths = {
  home: string;
  dataDir: string;
  stateDir: string;
  socket: string;
  /** Mirror of the gateway user's PI resources: `agent/` is its PI agent
   * directory, `home/` and `root/` hold other files by local path. */
  mirrorDir: string;
  agentDir: string;
  providersDir: string;
  attachmentsDir: string;
  /** The remote user's own PI login, used when no gateway is connected. */
  fallbackAgentDir: string;
};

/** The gateway's `~/.agents/skills` where the sync keeps it (`sync.ts` mirrors it under `home/`), once it is there.
 * PI finds a user-agents skills dir under the home it runs with, and on this host that is the host user's own home.
 * Nothing until that directory exists is load-bearing: the absence is part of Durable's loader cache key (`loader` in
 * `durable-prompt.ts`), so the sync that first brings it builds a fresh loader rather than a stale one. */
export function mirroredUserSkillPaths(paths: Pick<WorkerPaths, "mirrorDir">): string[] {
  const dir = join(paths.mirrorDir, "home", ".agents", "skills");
  return existsSync(dir) ? [dir] : [];
}

export function workerPaths(env: NodeJS.ProcessEnv = process.env, home = env["HOME"] || homedir()): WorkerPaths {
  const dataDir = join(env["XDG_DATA_HOME"] || join(home, ".local", "share"), "hui-worker");
  const stateDir = join(dataDir, "state");
  const mirrorDir = join(dataDir, "mirror");
  // Unix socket paths are limited to about 104 bytes; a deep data directory
  // gets a short, per-directory one instead (created 0700 by the host).
  const preferred = join(stateDir, "host.sock");
  const socket = Buffer.byteLength(preferred) <= 100 ? preferred
    : join("/tmp", `hui-worker-${createHash("sha256").update(stateDir).digest("hex").slice(0, 16)}`, "host.sock");
  return {
    home,
    dataDir,
    stateDir,
    socket,
    mirrorDir,
    agentDir: join(mirrorDir, "agent"),
    providersDir: join(mirrorDir, "hui", "providers"),
    attachmentsDir: join(dataDir, "attachments"),
    fallbackAgentDir: resolvePiAgentDir(env, home),
  };
}
