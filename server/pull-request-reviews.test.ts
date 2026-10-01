import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  accountEnv,
  approvalBlocker,
  approveArgs,
  approveAssessed,
  autoApproveLowRisk,
  HEAD_CHANGED,
  headArgs,
  parsePullRequestHead,
  runGh,
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

const FIXTURE = fileURLToPath(new URL("../e2e/github-cli-fixture.mjs", import.meta.url));
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";

/** The fake gh with two signed-in accounts; `other` holds pull request 3 at `head`. */
async function twoAccounts(head = HEAD) {
  const dir = await mkdtemp(join(tmpdir(), "hui-pr-approve-"));
  await writeFile(join(dir, "account"), "work-account\n");
  await writeFile(join(dir, "accounts"), "work-account\npersonal-account\n");
  await writeFile(join(dir, "search-review-requested-personal-account.json"), JSON.stringify([{ number: 3, url, headRefOid: head }]));
  const env = { ...process.env, HUI_FAKE_GH_DIR: dir, GH_TOKEN: "inherited-must-not-leak" };
  const gh = async (login: string) => {
    const accountEnvironment = await accountEnv(FIXTURE, login, env);
    return { json: async (args: readonly string[]) => JSON.parse(await runGh(FIXTURE, args, accountEnvironment)) as unknown, run: (args: readonly string[]) => runGh(FIXTURE, args, accountEnvironment) };
  };
  return { dir, gh };
}

test("an account's token reaches gh only through GH_TOKEN", async () => {
  const { dir } = await twoAccounts();
  const env = await accountEnv(FIXTURE, "personal-account", { ...process.env, HUI_FAKE_GH_DIR: dir, GH_TOKEN: "inherited" });
  assert.equal(env["GH_TOKEN"], "fake-token-personal-account");
  await assert.rejects(accountEnv(FIXTURE, "someone-else", { ...process.env, HUI_FAKE_GH_DIR: dir }), /signed_out/u);
  assert.equal(headArgs({ repository: "acme/web", number: 3 }).some((arg) => arg.includes("token")), false);
  assert.equal(approveArgs({ repository: "acme/web", number: 3 }).some((arg) => arg.includes("token")), false);
  await rm(dir, { recursive: true, force: true });
});

test("the head check reads state, head commit and direct review requests only", () => {
  assert.deepEqual(parsePullRequestHead({ state: "OPEN", headRefOid: HEAD, reviewRequests: [{ __typename: "User", login: "personal-account" }, { __typename: "Team", name: "Reviewers", slug: "reviewers" }] }), {
    open: true, headRefOid: HEAD, requested: ["personal-account"],
  });
  assert.throws(() => parsePullRequestHead({ state: "OPEN" }), /unavailable/u);
  const head = { open: true, headRefOid: HEAD, requested: ["Personal-Account"] };
  assert.equal(approvalBlocker({ headRefOid: HEAD }, "personal-account", head), undefined);
  assert.equal(approvalBlocker({ headRefOid: HEAD }, "personal-account", { ...head, open: false }), "The pull request is no longer open.");
  assert.equal(approvalBlocker({ headRefOid: HEAD }, "personal-account", { ...head, requested: [] }), "A review is no longer requested of personal-account.");
  assert.equal(approvalBlocker({ headRefOid: OTHER }, "personal-account", head), HEAD_CHANGED);
  assert.equal(approvalBlocker({}, "personal-account", head), HEAD_CHANGED, "an assessment without a recorded head never approves");
});

test("approving an assessed pull request runs as the requested account with the exact argv", async () => {
  const { dir, gh } = await twoAccounts();
  await approveAssessed({ repository: "acme/web", number: 3 }, { headRefOid: HEAD }, "personal-account", await gh("personal-account"));
  assert.deepEqual(JSON.parse(await readFile(join(dir, "pr-review-args"), "utf8")), ["pr", "review", "3", "-R", "acme/web", "--approve"]);
  assert.equal(await readFile(join(dir, "pr-review-token"), "utf8"), "fake-token-personal-account");
  await rm(dir, { recursive: true, force: true });
});

test("a manual approval refuses a pull request that changed since it was assessed", async () => {
  const { dir, gh } = await twoAccounts(OTHER);
  await assert.rejects(approveAssessed({ repository: "acme/web", number: 3 }, { headRefOid: HEAD }, "personal-account", await gh("personal-account")), { name: "ApprovalBlockedError", message: HEAD_CHANGED });
  await assert.rejects(readFile(join(dir, "pr-review-args"), "utf8"), /ENOENT/u, "gh pr review never ran");
  // The other account is not requested on it.
  await assert.rejects(approveAssessed({ repository: "acme/web", number: 3 }, { headRefOid: OTHER }, "work-account", await gh("work-account")), /no longer requested of work-account/u);
  await rm(dir, { recursive: true, force: true });
});

test("auto-approve: only a low verdict with the setting on, and only when the checks pass", async () => {
  const low = { risk: "low" as const, summary: "Docs only.", reasons: [] };
  const { dir, gh } = await twoAccounts();
  const approve = async () => approveAssessed({ repository: "acme/web", number: 3 }, { headRefOid: HEAD }, "personal-account", await gh("personal-account"));
  let calls = 0;
  const counted = async () => { calls += 1; };
  assert.deepEqual(await autoApproveLowRisk({ ...low, risk: "medium" }, true, counted), { approved: false });
  assert.deepEqual(await autoApproveLowRisk({ ...low, risk: "high" }, true, counted), { approved: false });
  assert.deepEqual(await autoApproveLowRisk(undefined, true, counted), { approved: false }, "no verdict");
  assert.deepEqual(await autoApproveLowRisk(low, false, counted), { approved: false }, "setting off");
  assert.equal(calls, 0);
  assert.deepEqual(await autoApproveLowRisk(low, true, approve), { approved: true });
  assert.equal(await readFile(join(dir, "pr-review-token"), "utf8"), "fake-token-personal-account");
  await rm(join(dir, "pr-review-args"));
  // Each failing precondition leaves the verdict with its reason and never runs gh pr review.
  const blocked = async (patch: Record<string, unknown>) => {
    await writeFile(join(dir, "search-review-requested-personal-account.json"), JSON.stringify([{ number: 3, url, headRefOid: HEAD, ...patch }]));
    return autoApproveLowRisk(low, true, approve);
  };
  assert.deepEqual(await blocked({ headRefOid: OTHER }), { approved: false, reason: `Not auto-approved: ${HEAD_CHANGED}` });
  assert.deepEqual(await blocked({ state: "CLOSED" }), { approved: false, reason: "Not auto-approved: The pull request is no longer open." });
  await writeFile(join(dir, "search-review-requested-personal-account.json"), "[]");
  await writeFile(join(dir, "search-created-personal-account.json"), JSON.stringify([{ number: 3, url, headRefOid: HEAD }]));
  assert.deepEqual(await autoApproveLowRisk(low, true, approve), { approved: false, reason: "Not auto-approved: A review is no longer requested of personal-account." });
  await assert.rejects(readFile(join(dir, "pr-review-args"), "utf8"), /ENOENT/u);
  await rm(dir, { recursive: true, force: true });
});
