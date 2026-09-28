import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHANGES_DECISION_TITLE, changesProposalFromDecision } from "../../shared/session-changes.ts";
import { changesDecisionText, CHANGES_DECISION_TITLE as EXTENSION_TITLE } from "../../server/runtimes/changes-proposal-extension.mjs";
import { changesReady, COLLAPSED_FILE_ROWS, defaultShipSelection, isChangesDecision, orderChangedFiles, parseDiffLines, proposedShipAction, shipSummary, splitDiffRows } from "./session-changes.ts";

const base = {
  available: true as const, branch: "feat/x", base: "main", isDefaultBranch: false, remote: "origin",
  unpushed: 0, behind: 0, commits: 0, files: [], totalFiles: 0, additions: 0, deletions: 0, signature: "s1",
  proposal: { commitMessage: "Add x", key: "k1" },
};
const file = (path: string, uncommitted: boolean, session = false) => ({ path, status: "modified" as const, additions: 1, deletions: 0, uncommitted, session });

describe("changesReady", () => {
  it("shows exactly while a propose_changes call waits, whatever the checkout holds", () => {
    const { proposal: _proposal, ...unproposed } = base;
    assert.equal(changesReady({ ...unproposed, files: [file("a", true)], unpushed: 2 }), false, "dirty work alone never asks");
    assert.equal(changesReady({ available: false }), false);
    assert.equal(changesReady(base), true, "a pending decision asks even with nothing left to ship");
    assert.equal(changesReady({ ...base, commits: 3, pullRequest: { number: 1, url: "u", title: "t", draft: true } }), true);
  });
});

describe("proposedShipAction", () => {
  const pr = { number: 12, url: "u", title: "t", draft: false };
  const dirty = { ...base, files: [file("a", true)] };
  const proposing = (action: "commit" | "pr" | "stack", extra: object = {}) => ({ ...dirty, proposal: { commitMessage: "m", key: action, action }, ...extra });
  it("follows the agent's action when the checkout allows it", () => {
    assert.equal(proposedShipAction(proposing("pr")), "draft_pr");
    assert.equal(proposedShipAction(proposing("commit")), "commit_push");
    assert.equal(proposedShipAction(proposing("commit", { pullRequest: pr })), "commit_push");
    assert.equal(proposedShipAction(proposing("stack", { pullRequest: pr })), "stacked_pr");
  });
  it("falls back when the action does not fit", () => {
    assert.equal(proposedShipAction(proposing("stack")), "draft_pr", "no pull request to stack on");
    assert.equal(proposedShipAction(proposing("pr", { pullRequest: pr })), "commit_push", "the branch already has one");
    assert.equal(proposedShipAction(proposing("stack", { pullRequest: pr, files: [file("a", false)] })), "commit_push", "nothing new to stack");
    assert.equal(proposedShipAction(proposing("pr", { remote: undefined })), "commit", "no remote");
    assert.equal(proposedShipAction(dirty), "draft_pr");
  });
});

describe("defaultShipSelection", () => {
  it("prefers the session's own uncommitted files", () => {
    const changes = { ...base, files: [file("a", true), file("b", true, true), file("c", false, true)] };
    assert.deepEqual(defaultShipSelection(changes), ["b"]);
    assert.deepEqual(defaultShipSelection({ ...base, files: [file("a", true), file("c", false)] }), ["a"]);
    assert.deepEqual(defaultShipSelection({ ...base, files: [file("a", true), file("c", false, true)] }), [], "after shipping its own files, unrelated work stays unselected");
  });
});

describe("changesProposalFromDecision", () => {
  const request = (placeholder: unknown, extra: object = {}) => ({ id: "req-1", method: "input", title: CHANGES_DECISION_TITLE, placeholder: typeof placeholder === "string" ? placeholder : JSON.stringify(placeholder), ...extra });
  it("reads the waiting call's arguments and keys them by the request", () => {
    const proposal = changesProposalFromDecision(request({ commitMessage: "Add hero\r\n\nWhy.", prTitle: " Add   hero ", prBody: "## Summary\n", action: "stack" }));
    assert.deepEqual(proposal, { commitMessage: "Add hero\n\nWhy.", prTitle: "Add hero", prBody: "## Summary", action: "stack", key: "req-1" });
    assert.equal(changesProposalFromDecision(request({ commitMessage: "Add", action: "rebase" }))?.action, undefined);
  });

  it("recognizes only HUI's request and needs a commit message", () => {
    assert.equal(EXTENSION_TITLE, CHANGES_DECISION_TITLE, "the extension and HUI agree on the request title");
    assert.equal(isChangesDecision(request({})), true);
    assert.equal(isChangesDecision({ id: "q", method: "select", title: CHANGES_DECISION_TITLE }), false);
    assert.equal(isChangesDecision({ id: "q", method: "input", title: "Name?" }), false);
    assert.equal(changesProposalFromDecision({ id: "q", method: "input", title: "Name?", placeholder: "{}" }), undefined);
    assert.equal(changesProposalFromDecision(request({ commitMessage: "  " })), undefined);
    assert.equal(changesProposalFromDecision(request("not json")), undefined);
    assert.equal(changesProposalFromDecision(undefined), undefined);
  });
});

describe("changesDecisionText", () => {
  it("tells the agent what the operator decided", () => {
    const shipped = changesDecisionText(JSON.stringify({ outcome: "shipped", summary: "Committed abc1234 “Add”, pushed, opened draft pull request #42.", result: { pullRequest: { number: 42, url: "https://github.com/acme/web/pull/42" } } }));
    assert.match(shipped, /shipped the change .*#42\. https:\/\/github\.com\/acme\/web\/pull\/42 Do not commit, push or open a pull request for it again/u);
    assert.equal(changesDecisionText(JSON.stringify({ outcome: "failed", summary: "push rejected", instructions: "HUI tried … then push the branch." })), "HUI tried … then push the branch.");
    assert.match(changesDecisionText(JSON.stringify({ outcome: "iterate" })), /keep iterating .*Stop and wait for their next message/u);
    assert.match(changesDecisionText(JSON.stringify({ outcome: "replied" })), /wrote to you instead/u);
    assert.match(changesDecisionText(undefined), /dismissed without a decision/u);
    assert.match(changesDecisionText("garbage"), /dismissed without a decision/u);
  });
});

describe("orderChangedFiles", () => {
  it("lists session-written uncommitted files first, committed files last, stably", () => {
    const files = [file("z-own", true, true), file("a-committed", false, true), file("b-other", true), file("c-own", true, true), file("a-other", true)];
    assert.deepEqual(orderChangedFiles(files).map((item) => item.path), ["c-own", "z-own", "a-other", "b-other", "a-committed"]);
    assert.equal(files[0]!.path, "z-own", "input is not mutated");
    assert.equal(COLLAPSED_FILE_ROWS, 2.5);
  });
});

describe("parseDiffLines", () => {
  it("classifies header, hunks and lines", () => {
    const lines = parseDiffLines("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n\\ No newline at end of file\n");
    assert.deepEqual(lines.map((line) => line.kind), ["meta", "meta", "meta", "hunk", "context", "del", "add", "meta"]);
  });
});

describe("splitDiffRows", () => {
  it("pairs deletions with the following additions and numbers both sides", () => {
    const rows = splitDiffRows(parseDiffLines("--- a/x\n+++ b/x\n@@ -3,4 +3,4 @@ fn\n keep\n-old one\n-old two\n+new one\n tail\n+appended\n"));
    assert.deepEqual(rows, [
      { kind: "hunk", text: "@@ -3,4 +3,4 @@ fn" },
      { kind: "line", left: { number: 3, text: "keep", kind: "context" }, right: { number: 3, text: "keep", kind: "context" } },
      { kind: "line", left: { number: 4, text: "old one", kind: "del" }, right: { number: 4, text: "new one", kind: "add" } },
      { kind: "line", left: { number: 5, text: "old two", kind: "del" } },
      { kind: "line", left: { number: 6, text: "tail", kind: "context" }, right: { number: 5, text: "tail", kind: "context" } },
      { kind: "line", right: { number: 6, text: "appended", kind: "add" } },
    ]);
  });

  it("numbers a new file from 1 on the right only", () => {
    const rows = splitDiffRows(parseDiffLines("@@ -0,0 +1,2 @@\n+a\n+b\n"));
    assert.deepEqual(rows.slice(1), [
      { kind: "line", right: { number: 1, text: "a", kind: "add" } },
      { kind: "line", right: { number: 2, text: "b", kind: "add" } },
    ]);
  });
});

describe("shipSummary", () => {
  it("describes each completed step", () => {
    assert.equal(shipSummary({ createdBranch: "feature/hero", commit: { sha: "abcdef123", subject: "Add hero" }, pushed: true, pullRequest: { number: 42, url: "u" } }),
      "Created feature/hero, committed abcdef1 “Add hero”, pushed, opened draft pull request #42.");
    assert.equal(shipSummary({ stackedOn: { branch: "feat/base", number: 7, pushed: true }, createdBranch: "feature/next", commit: { sha: "abcdef123", subject: "Next" }, pushed: true, pullRequest: { number: 8, url: "u" } }),
      "Pushed feat/base, created feature/next, committed abcdef1 “Next”, pushed, opened draft pull request #8 stacked on #7.");
    assert.equal(shipSummary({}), "Nothing to do.");
  });
});
