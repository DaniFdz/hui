/**
 * A subagent's own checkout: the sessions layer creates a Git worktree off the caller's directory, with HUI's branch
 * prefix, and hands the spawn its cwd and a rollback. The repo is a real temporary Git checkout; HUI's configuration is
 * temporary too, so the worktree lands outside the developer's state.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

import type { AgentRuntime } from "../runtimes/types.ts";
import type { SessionRecord } from "../sessions/sessions.ts";

const home = await mkdtemp(join(tmpdir(), "hui-subagent-worktree-"));
process.env["HOME"] = home;
process.env["XDG_CONFIG_HOME"] = join(home, "config");
const { LiveSessions } = await import("../sessions/live-sessions.ts");
const { DEFAULT_SETTINGS } = await import("../hui-settings.ts");
const { CONFIG_DIR } = await import("../paths.ts");

function record(id: string, patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id, title: id, group: "Work", cwd: home, tool: "durable",
    createdAt: "2026-11-06T00:00:00.000Z", updatedAt: "2026-11-06T00:00:00.000Z", source: "hui",
    ...patch,
  };
}

function manager(): InstanceType<typeof LiveSessions> {
  return new LiveSessions(
    { id: "durable", start: async () => { throw new Error("not started"); } } as unknown as AgentRuntime,
    async (mutate: (current: readonly SessionRecord[]) => readonly SessionRecord[]) => [...mutate([])],
    async () => DEFAULT_SETTINGS,
  );
}

test("a subagent's worktree comes off the caller's checkout and rolls back cleanly", async () => {
  const repo = join(home, "repo");
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "hui@example.invalid");
  git("config", "user.name", "HUI Test");
  await writeFile(join(repo, "README.md"), "# Fixture\n");
  git("add", "README.md");
  git("commit", "-q", "-m", "fixture");

  const sessions = manager();
  const created = await sessions.subagentWorktree(record("caller", { cwd: repo }), "Worker task");
  assert.match(created.branch, new RegExp(`^${DEFAULT_SETTINGS.branchPrefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
  assert.ok(created.cwd.startsWith(join(CONFIG_DIR, "worktrees")), "the worktree lives under HUI's configuration");
  assert.equal(execFileSync("git", ["-C", created.cwd, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim(), created.branch);
  await writeFile(join(created.cwd, "new.txt"), "work\n");
  assert.equal(await readFile(join(created.cwd, "new.txt"), "utf8"), "work\n");

  await created.rollback();
  const branches = execFileSync("git", ["-C", repo, "branch", "--list", created.branch], { encoding: "utf8" }).trim();
  assert.equal(branches, "", "the branch goes with the worktree");
});

test("a caller that is not a Git checkout is refused before any child exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-subagent-plain-"));
  await assert.rejects(() => manager().subagentWorktree(record("caller", { cwd: directory }), "Worker task"), /Git repository/u);
  await rm(directory, { recursive: true, force: true });
});

afterAll(() => rm(home, { recursive: true, force: true }));
