import assert from "node:assert/strict";
import test from "node:test";

import type { WorktreeRow } from "../../shared/worktrees.ts";
import { isMergedCleanupCandidate } from "../../shared/worktrees.ts";
import { formatBytes } from "../lib/worktrees.ts";
import { matchingWorktrees } from "./worktrees.ts";

function row(overrides: Partial<WorktreeRow>): WorktreeRow {
  return {
    repository: "/repo", path: "/wt", displayPath: "/wt", branch: "hui/topic", head: "abc", detached: false,
    managed: true, sessions: [], pullRequests: [], dirty: false, bytes: 1024,
    merged: false, risks: [], ...overrides,
  };
}

test("worktree filters combine scope and free text across branch, session and PR", () => {
  const rows = [
    row({ path: "/a", branch: "hui/merged", merged: true, pullRequests: [{ repository: "o/r", number: 7, url: "https://github.com/o/r/pull/7", state: "merged", title: "Fix drawer" }] }),
    row({ path: "/b", branch: "external", managed: false, risks: ["external"] }),
    row({ path: "/c", branch: "hui/busy", sessions: [{ id: "s", title: "Draft PR signals", archived: false }] }),
  ];
  assert.deepEqual(matchingWorktrees(rows, "", "hui").map((r) => r.path), ["/a", "/c"]);
  assert.deepEqual(matchingWorktrees(rows, "", "merged").map((r) => r.path), ["/a"]);
  assert.deepEqual(matchingWorktrees(rows, "drawer", "all").map((r) => r.path), ["/a"]);
  assert.deepEqual(matchingWorktrees(rows, "signals", "all").map((r) => r.path), ["/c"]);
});

test("merged cleanup requires confirmed clean state, no running session and no risk", () => {
  assert.equal(isMergedCleanupCandidate(row({ merged: true })), true);
  assert.equal(isMergedCleanupCandidate(row({ merged: true, dirty: true })), false);
  const { dirty: _dirty, ...unknownDirty } = row({ merged: true });
  assert.equal(isMergedCleanupCandidate(unknownDirty), false);
  assert.equal(isMergedCleanupCandidate(row({ merged: true, sessions: [{ id: "s", title: "t", archived: true }] })), true);
  assert.equal(isMergedCleanupCandidate(row({ merged: true, risks: ["locked"] })), false);
  assert.equal(isMergedCleanupCandidate(row({ merged: true, risks: ["running"] })), false);
  assert.equal(isMergedCleanupCandidate(row({ merged: true, managed: false })), false);
});

test("sizes use binary units and an em dash when unknown", () => {
  assert.equal(formatBytes(undefined), "—");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KiB");
  assert.equal(formatBytes(1.5 * 1024 ** 3), "1.5 GiB");
});

test("removal results name the branch and explain failures in plain words", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./worktrees.ts", import.meta.url), "utf8");
  assert.match(source, /Couldn't remove/u);
  assert.match(source, /result\.label/u);
  assert.match(source, /onDismissResults/u);
});

test("worktree hover text uses HUI tooltips, never native titles", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./worktrees.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\stitle=/u);
  assert.match(source, /worktree-path__text" data-hui-tooltip=\$\{row\.path\}/u);
  const shell = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  assert.match(shell, /installTooltips\(\)/u);
});

test("any worktree can be removed manually, with its risks spelled out in a modal", async () => {
  const { riskAcknowledged } = await import("../../shared/worktrees.ts");
  assert.equal(riskAcknowledged("dirty", ["unknown"]), true);
  assert.equal(riskAcknowledged("dirty", ["external"]), false);
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./worktrees.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /worktree-blocked|removable/u);
  assert.match(source, /class="hui-modal-dialog worktree-remove-dialog"/u);
  assert.match(source, /Delete worktree and changes/u);
});
