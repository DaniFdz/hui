import assert from "node:assert/strict";
import test from "node:test";

import { launchNamesWorktree, worktreeProgressLabel } from "./worktree-progress.ts";

test("worktree progress names the naming step before the Git phases", () => {
  assert.equal(worktreeProgressLabel({ phase: "naming" }), "Naming worktree");
  assert.equal(worktreeProgressLabel({ phase: "preparing" }), "Preparing Git worktree");
  assert.equal(worktreeProgressLabel({ phase: "checkout", percent: 40 }), "Checking out files");
  assert.equal(worktreeProgressLabel({ phase: "filtering" }), "Running checkout filters");
  assert.equal(worktreeProgressLabel({ phase: "finalizing" }), "Finalizing Git worktree");
  assert.equal(worktreeProgressLabel(undefined), "Preparing Git worktree");
});

test("only a worktree launch without a branch name but with a prompt is named first", () => {
  assert.equal(launchNamesWorktree({ worktree: true, prompt: "Fix login" }), true);
  assert.equal(launchNamesWorktree({ worktree: true, branchName: "mine", prompt: "Fix login" }), false);
  assert.equal(launchNamesWorktree({ worktree: true, branchName: "  ", prompt: "Fix login" }), true);
  assert.equal(launchNamesWorktree({ worktree: true }), false, "no prompt means an instant title-based name");
  assert.equal(launchNamesWorktree({ worktree: false, prompt: "Fix login" }), false);
});
