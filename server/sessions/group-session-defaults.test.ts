/**
 * What a group lends a chief's new session: its stored directory, machine, Git mode and base ref beat the chief's
 * arguments and the caller's context, and an argument fills in what the group leaves unset.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { groupSessionDefaults } from "./group-session-defaults.ts";

const caller = { cwd: "/caller/checkout", worker: "caller-worker" };

test("a group's stored defaults beat the chief's choices and the caller's context", () => {
  assert.deepEqual(groupSessionDefaults({
    group: { cwd: "/project/checkout", workspaceMode: "worktree", baseRef: "release/1.0", worker: "devbox" },
    caller,
    requested: {
      cwd: "/somewhere/else",
      worker: { kind: "worker", worker: "other-worker" },
      worktree: false,
      baseRef: "main",
    },
  }), { cwd: "/project/checkout", worker: "devbox", worktree: true, baseRef: "release/1.0" });
});

test("a group's Branch environment wins over a chief asking for a worktree", () => {
  assert.deepEqual(groupSessionDefaults({
    group: { cwd: "/project/checkout", workspaceMode: "branch" },
    caller,
    requested: { worktree: true },
  }), { cwd: "/project/checkout", worker: "caller-worker", worktree: false });
});

test("a chief fills in every field the group leaves unset", () => {
  assert.deepEqual(groupSessionDefaults({
    group: {},
    caller,
    requested: {
      cwd: "/another/checkout",
      worker: { kind: "worker", worker: "fast-worker" },
      worktree: true,
      baseRef: "main",
    },
  }), { cwd: "/another/checkout", worker: "fast-worker", worktree: true, baseRef: "main" });
});

test("naming local keeps the session on this machine, not the caller's worker", () => {
  assert.deepEqual(groupSessionDefaults({
    group: { cwd: "/project/checkout" },
    caller,
    requested: { worker: { kind: "local" } },
  }), { cwd: "/project/checkout", worktree: false });
});

test("without a group the caller's context stays the fallback", () => {
  assert.deepEqual(groupSessionDefaults({ caller }), {
    cwd: "/caller/checkout",
    worker: "caller-worker",
    worktree: false,
  });
});

test("a group's Git defaults need its own directory to describe", () => {
  assert.deepEqual(groupSessionDefaults({
    group: { workspaceMode: "worktree", baseRef: "release/1.0" },
    caller,
    requested: { cwd: "/another/checkout" },
  }), { cwd: "/another/checkout", worker: "caller-worker", worktree: false });
});
