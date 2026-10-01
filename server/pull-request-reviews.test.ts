import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  approveArgs,
  assessmentPrompt,
  pullRequestAssessment,
  removeTemporaryFiles,
  riskVerdictFromTranscript,
  staleTemporarySessions,
  temporaryCleanupPaths,
  temporaryReview,
} from "./pull-request-reviews.ts";
import type { SessionRecord } from "./sessions.ts";

const url = "https://github.com/acme/web/pull/3";
const record = (id: string, patch: Partial<SessionRecord> = {}): SessionRecord => ({
  id, title: id, group: "", cwd: "/tmp", tool: "pi", createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z", ...patch,
});
const call = (args: unknown, failed = false) => ({ kind: "tool", name: "report_pr_risk", args, ...(failed ? { failed } : {}) });
const low = { risk: "low", summary: "Docs only.", reasons: ["README"] };
const high = { risk: "high", summary: "Rewrites auth.", reasons: ["Token handling"] };

test("the first prompt is read-only, uses -R and ends with report_pr_risk", () => {
  const prompt = assessmentPrompt({ repository: "acme/web", number: 3, url }, "scratch");
  for (const command of ["gh pr view 3 -R acme/web", "gh pr diff 3 -R acme/web", "gh pr checks 3 -R acme/web"]) assert.ok(prompt.includes(command), command);
  assert.match(prompt, /Do not modify files, commit, push, comment on, review or approve/u);
  assert.match(prompt, /report_pr_risk/u);
  assert.match(assessmentPrompt({ repository: "acme/web", number: 3, url }, "checkout"), /do not check out the pull request branch/u);
});

test("the latest valid, successful report_pr_risk call wins", () => {
  assert.equal(riskVerdictFromTranscript([]), undefined);
  assert.deepEqual(riskVerdictFromTranscript([call(low), call(high)]), high);
  assert.deepEqual(riskVerdictFromTranscript([call(low), call({ risk: "severe" }), call(high, true)]), low);
  assert.deepEqual(riskVerdictFromTranscript([call(low), { kind: "tool", name: "progress_card", args: {} }]), low);
});

test("row state: verdict, assessing while the runtime works, otherwise no verdict", () => {
  const review = record("review");
  assert.deepEqual(pullRequestAssessment(review, "idle", [call(low)]), { sessionId: "review", state: "verdict", verdict: low });
  for (const status of ["starting", "running", "waiting"] as const) assert.equal(pullRequestAssessment(review, status, []).state, "assessing");
  for (const status of ["idle", "error"] as const) assert.equal(pullRequestAssessment(review, status, []).state, "no_verdict");
});

test("finds the temporary review of a pull request, case-insensitively", () => {
  const records = [record("normal"), record("review", { temporary: { kind: "pr-review", pullRequestUrl: url } })];
  assert.equal(temporaryReview(records, url.toUpperCase().replace("HTTPS://GITHUB.COM", "https://github.com"))?.id, "review");
  assert.equal(temporaryReview(records, "https://github.com/acme/web/pull/4"), undefined);
});

test("cleanup deletes only the transcript and scratch directory the record names", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-pr-review-cleanup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "pr-reviews");
  const scratch = join(root, "a");
  await mkdir(join(scratch, "nested"), { recursive: true });
  await mkdir(join(root, "b"));
  await mkdir(join(dir, "sessions"));
  const transcript = join(dir, "sessions", "review.jsonl");
  await writeFile(transcript, "{}\n");
  await writeFile(join(dir, "sessions", "other.jsonl"), "{}\n");
  const review = record("review", { piSessionFile: transcript, temporary: { kind: "pr-review", pullRequestUrl: url, scratchDir: scratch } });
  assert.deepEqual(temporaryCleanupPaths(review, root), [transcript, scratch]);
  // Nothing outside the scratch root, the root itself or a normal session.
  assert.deepEqual(temporaryCleanupPaths(record("x", { temporary: { kind: "pr-review", pullRequestUrl: url, scratchDir: dir } }), root), []);
  assert.deepEqual(temporaryCleanupPaths(record("x", { temporary: { kind: "pr-review", pullRequestUrl: url, scratchDir: root } }), root), []);
  assert.deepEqual(temporaryCleanupPaths(record("x", { temporary: { kind: "pr-review", pullRequestUrl: url, scratchDir: join(root, "a", "..", "..") } }), root), []);
  assert.deepEqual(temporaryCleanupPaths(record("normal", { piSessionFile: transcript }), root), []);
  assert.deepEqual(temporaryCleanupPaths(record("x", { piSessionFile: join(dir, "sessions"), temporary: { kind: "pr-review", pullRequestUrl: url } }), root), []);

  await removeTemporaryFiles(review, root);
  assert.deepEqual(await readdir(root), ["b"]);
  assert.deepEqual(await readdir(join(dir, "sessions")), ["other.jsonl"]);
});

test("temporary reviews older than a day are stale; normal sessions never are", () => {
  const now = Date.parse("2026-10-02T00:00:00.000Z");
  const temporary = { kind: "pr-review", pullRequestUrl: url } as const;
  const records = [
    record("old", { temporary, createdAt: "2026-09-30T23:59:59.000Z" }),
    record("fresh", { temporary, createdAt: "2026-10-01T12:00:00.000Z" }),
    record("broken", { temporary, createdAt: "" }),
    record("normal", { createdAt: "2020-01-01T00:00:00.000Z" }),
  ];
  assert.deepEqual(staleTemporarySessions(records, now).map((item) => item.id), ["old", "broken"]);
});

test("approve is exactly gh pr review <n> -R owner/repo --approve", () => {
  assert.deepEqual(approveArgs({ repository: "acme/web", number: 3 }), ["pr", "review", "3", "-R", "acme/web", "--approve"]);
});
