import assert from "node:assert/strict";
import test from "node:test";

import type { WorktreeRow } from "../../shared/worktrees.ts";
import { isMergedCleanupCandidate } from "../../shared/worktrees.ts";
import { formatBytes } from "../lib/worktrees.ts";
import { matchingWorktrees, renderWorktreesPage, type WorktreesPageProps } from "./worktrees.ts";

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

test("merged cleanup requires confirmed clean state, no active session and no risk", () => {
  assert.equal(isMergedCleanupCandidate(row({ merged: true })), true);
  assert.equal(isMergedCleanupCandidate(row({ merged: true, dirty: true })), false);
  const { dirty: _dirty, ...unknownDirty } = row({ merged: true });
  assert.equal(isMergedCleanupCandidate(unknownDirty), false);
  assert.equal(isMergedCleanupCandidate(row({ merged: true, sessions: [{ id: "s", title: "t", archived: true }] })), true);
  assert.equal(isMergedCleanupCandidate(row({ merged: true, sessions: [{ id: "s", title: "t", archived: false }] })), false);
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

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + text(template.values[i])).join("");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

test("a removal in progress keeps the page usable and says which worktree runs and which wait", () => {
  const rows = [
    row({ path: "/a", branch: "hui/big", bytes: 3 * 1024 ** 3, removal: "removing", merged: true }),
    row({ path: "/b", branch: "hui/next", merged: true }),
    row({ path: "/c", branch: "hui/other", merged: true }),
  ];
  const page = text(renderWorktreesPage({
    inventory: { worktrees: rows, diagnostics: [], pending: true },
    loading: false, error: "", query: "", filter: "all", confirm: "", results: [],
    removing: new Set(["/a", "/b"]),
  } as unknown as WorktreesPageProps)).replace(/\s+/gu, " ");
  assert.match(page, /role="status"> <span class="session-run-spinner"[^>]*><\/span> <span>Removing <span class="mono">hui\/big<\/span> \(3\.0 GiB\)… 1 more queued\./u);
  assert.match(page, /data-removal=removing> <span class="session-run-spinner"[^>]*><\/span><span class="sr-only">Removing…<\/span>/u);
  assert.match(page, /data-removal=queued> Queued/u);
  // Only the untouched row keeps its remove button, and cleanup offers only it.
  assert.deepEqual(page.match(/aria-label=Remove \S+/gu), ["aria-label=Remove hui/other"]);
  assert.match(page, /Clean up merged \(1\)/u);
});
