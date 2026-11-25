import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { effectiveGatewayName, inspectWorkspaces, parseWorktreePorcelain, readGatewayHealth } from "./control-surfaces.ts";
import { DEFAULT_SETTINGS, HUI_SETTINGS_FILE, readHuiSettings, writeHuiSettings } from "./hui-settings.ts";
import { CONFIG_DIR } from "./paths.ts";
import type { SessionRecord } from "./sessions/sessions.ts";

function session(id: string, cwd: string): SessionRecord {
  return {
    id,
    cwd,
    title: id,
    group: "tests",
    tool: "pi",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("parses git worktree porcelain without inventing fields", () => {
  assert.deepEqual(
    parseWorktreePorcelain(
      "worktree /repo\nHEAD abcdef\nbranch refs/heads/main\n\nworktree /repo-wt\nHEAD 123456\ndetached\n",
    ),
    [
      { path: "/repo", head: "abcdef", branch: "main", bare: false, detached: false },
      { path: "/repo-wt", head: "123456", branch: "", bare: false, detached: true },
    ],
  );
});

test("NUL porcelain preserves worktree paths containing newlines", () => {
  assert.equal(
    parseWorktreePorcelain("worktree /repo/line\nbreak\0HEAD abcdef\0branch refs/heads/topic\0\0")[0]?.path,
    "/repo/line\nbreak",
  );
});

test("inspects only registered workspaces and rejects escaping memory symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "hui-inspection-"));
  const workspace = join(root, "workspace");
  const outside = join(root, "outside.md");
  await mkdir(join(workspace, "memory"), { recursive: true });
  await writeFile(join(workspace, "AGENTS.md"), "instructions\n");
  await writeFile(join(workspace, "memory", "2026-01-01.md"), "memory\n");
  await writeFile(outside, "private\n");
  await symlink(outside, join(workspace, "memory", "escape.md"));

  const calls: string[][] = [];
  const result = await inspectWorkspaces(
    [session("one", workspace)],
    async (_file, args) => {
      calls.push([...args]);
      if (args.includes("rev-parse")) return { stdout: `${workspace}\n`, stderr: "" };
      return {
        stdout: `worktree ${workspace}\nHEAD abcdef\nbranch refs/heads/main\n`,
        stderr: "",
      };
    },
    root,
  );

  assert.deepEqual(result.memory.map((item) => item.relativePath), ["AGENTS.md", "memory/2026-01-01.md"]);
  assert.equal(result.memory.some((item) => item.path === outside), false);
  assert.equal(result.worktrees[0]?.sessionIds[0], "one");
  assert.equal(calls.some((args) => args.includes("worktree")), true);
});

test("associates a session whose cwd goes through a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "hui-linked-workspace-"));
  const workspace = join(root, "workspace");
  const linked = join(root, "linked");
  await mkdir(workspace);
  await symlink(workspace, linked);
  const result = await inspectWorkspaces(
    [session("one", linked)],
    async (_file, args) =>
      args.includes("rev-parse")
        ? { stdout: `${workspace}\n`, stderr: "" }
        : { stdout: `worktree ${workspace}\nHEAD abcdef\nbranch refs/heads/main\n`, stderr: "" },
    root,
  );
  assert.deepEqual(result.worktrees[0]?.sessionIds, ["one"]);
});

test("never inventories OpenClaw-owned memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "hui-openclaw-memory-"));
  const workspace = join(root, ".openclaw", "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "MEMORY.md"), "must stay excluded\n");
  const result = await inspectWorkspaces(
    [session("one", workspace)],
    async () => {
      throw new Error("not a repository");
    },
    root,
  );
  assert.deepEqual(result.memory, []);
  assert.match(result.diagnostics[0] ?? "", /OpenClaw-owned memory was excluded/u);
});

test("OpenClaw-owned memory stays excluded when ~/.openclaw is a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "hui-openclaw-link-"));
  const home = join(root, "home");
  const target = join(root, "openclaw-data");
  const workspace = join(target, "workspace");
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await symlink(target, join(home, ".openclaw"));
  await writeFile(join(workspace, "MEMORY.md"), "must stay excluded\n");

  const result = await inspectWorkspaces(
    [session("one", workspace)],
    async () => {
      throw new Error("not a repository");
    },
    home,
  );

  assert.deepEqual(result.memory, []);
  assert.match(result.diagnostics[0] ?? "", /OpenClaw-owned memory was excluded/u);
});

test("a gateway reports its saved name, or this machine's hostname when it has none", async () => {
  await mkdir(CONFIG_DIR, { recursive: true });
  await rm(HUI_SETTINGS_FILE, { force: true });
  assert.equal((await readGatewayHealth("build-box")).name, "build-box", "empty falls back to the hostname");
  assert.equal(effectiveGatewayName("", ""), "HUI", "a machine that reports no hostname still names itself");
  assert.equal(effectiveGatewayName("  ", "build-box"), "build-box");
  assert.equal(effectiveGatewayName(" Studio Mac ", "build-box"), "Studio Mac", "the saved name wins");

  await writeHuiSettings({ name: "Studio Mac" });
  assert.equal((await readGatewayHealth("build-box")).name, "Studio Mac", "the same health payload carries it");
  assert.equal(DEFAULT_SETTINGS.name, "", "the setting itself is never filled in with the fallback");
  assert.equal((await readHuiSettings()).name, "Studio Mac", "and the saved file keeps what the operator typed");

  await rm(HUI_SETTINGS_FILE, { force: true });
  assert.equal((await readGatewayHealth("build-box")).name, "build-box", "removing the name restores the fallback");
});
