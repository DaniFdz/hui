import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import type { GitHubTriggerEvent } from "../shared/bot-triggers.ts";
import { createGitHubFake, type FakeGitHubState } from "../e2e/github-triggers-fixture.mjs";
import { checkRunsPart, checksOutcome, ghRest, GitHubPollers, parseGhInclude, pollRepo, statusesPart, type GhRest, type GitHubEvent, type RepoCursor } from "./bot-triggers-github.ts";
import { cursorStore } from "./bot-triggers-store.ts";

const FIXTURE = fileURLToPath(new URL("../e2e/github-triggers-fixture.mjs", import.meta.url));
const REPO = "acme/widgets";
const ALL = new Set<GitHubTriggerEvent>(["pr_opened", "pr_pushed", "checks_failed", "checks_succeeded", "review_approved", "review_changes_requested", "review_commented", "comment", "mention", "pr_merged", "pr_closed"]);
const sha = (character: string) => character.repeat(40);
/** A time a little after now, as GitHub stamps what happens after a poll. */
const soon = (seconds = 2) => new Date(Date.now() + seconds * 1_000).toISOString();
const PAST = "2026-09-01T10:00:00Z";

function pull(number: number, options: { sha?: string; state?: "open" | "closed"; merged?: boolean; draft?: boolean; author?: string; labels?: string[]; base?: string; created?: string; updated?: string; body?: string } = {}) {
  return {
    number, title: `Pull request ${number}`, html_url: `https://github.com/${REPO}/pull/${number}`, state: options.state ?? "open", draft: options.draft ?? false,
    user: { login: options.author ?? "alice" }, head: { ref: `feature-${number}`, sha: options.sha ?? sha("a") }, base: { ref: options.base ?? "main" },
    labels: (options.labels ?? []).map((name) => ({ name })), created_at: options.created ?? PAST, updated_at: options.updated ?? options.created ?? PAST,
    merged_at: options.merged ? options.updated ?? soon() : null, body: options.body ?? "",
  };
}

function fakeState(): FakeGitHubState {
  return { login: "operator", repos: { [REPO]: { pulls: [pull(1, { sha: sha("a") }), pull(2, { sha: sha("b") })], reviews: {}, issueComments: [], reviewComments: [], checkRuns: {}, statuses: {} } } };
}

function inProcess(state: FakeGitHubState) {
  const fake = createGitHubFake(state);
  const gh: GhRest = async (path, etag) => fake.respond(path, etag);
  return { fake, gh, repo: state.repos[REPO]! };
}

async function poll(gh: GhRest, cursor: RepoCursor | undefined, wants: ReadonlySet<GitHubTriggerEvent> = ALL) {
  return pollRepo({ repo: REPO, cursor, wants, gh, login: "operator", now: Date.now });
}

const kinds = (events: readonly GitHubEvent[]) => events.map((event) => `${event.kind}#${event.prNumber}`);

async function tempDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hui-check-triggers-gh-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("gh's --include output parses into status, headers and body, a 304 included", () => {
  const ok = parseGhInclude("HTTP/1.1 200 OK\nEtag: W/\"abc\"\r\nX-Poll-Interval: 60\r\n\r\n[1,2]");
  assert.deepEqual(ok, { status: 200, headers: { etag: "W/\"abc\"", "x-poll-interval": "60" }, body: "[1,2]" });
  const notModified = parseGhInclude("HTTP/1.1 304 Not Modified\nEtag: \"abc\"\r\nX-Ratelimit-Remaining: 4977\r\n\r\n");
  assert.equal(notModified?.status, 304);
  assert.equal(notModified?.headers["x-ratelimit-remaining"], "4977");
  assert.equal(notModified?.body, "");
  assert.equal(parseGhInclude("gh: not logged in"), undefined);
});

test("ghRest runs gh with an argument array and reads 200, a conditional 304 (gh exits 1) and 404 through a fake gh", async (t) => {
  const dir = await tempDir(t);
  await writeFile(join(dir, "github.json"), JSON.stringify(fakeState()));
  const gh = ghRest(FIXTURE, { ...process.env, HUI_FAKE_GH_DIR: dir });
  const path = `repos/${REPO}/pulls?state=all&sort=updated&direction=desc&per_page=30`;
  const first = await gh(path);
  assert.equal(first.status, 200);
  assert.ok(Array.isArray(first.body) && first.body.length === 2);
  const etag = first.headers["etag"];
  assert.match(etag ?? "", /^W\/"[0-9a-f]{40}"$/u);
  const again = await gh(path, etag);
  assert.equal(again.status, 304, "an unchanged answer is a 304");
  assert.equal(again.body, undefined);
  assert.equal((await gh("repos/acme/missing/pulls")).status, 404);
  // An ETag that could smuggle a header is never sent.
  assert.equal((await gh(path, "W/\"x\"\r\nX-Evil: 1")).status, 200);
  const log = (await readFile(join(dir, "requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { status: number; etag: string | null });
  assert.deepEqual(log.map((entry) => entry.status), [200, 304, 404, 200]);
  assert.equal(log[3]!.etag, null);
});

test("the first poll is a silent baseline; then pull requests opening, pushing, merging and closing are events, and an unchanged repo costs only 304s", async () => {
  const state = fakeState();
  const { gh, fake, repo } = inProcess(state);
  const first = await poll(gh, undefined);
  assert.deepEqual(first.events, [], "the baseline records where the repo stands");
  assert.deepEqual(Object.keys(first.cursor.prs).sort(), ["1", "2"]);
  repo.pulls = [
    pull(1, { sha: sha("c"), updated: soon() }),
    pull(2, { sha: sha("b"), state: "closed", merged: true, updated: soon() }),
    pull(3, { sha: sha("d"), created: soon(), author: "bob", labels: ["ci"] }),
    pull(4, { sha: sha("e"), created: soon(), state: "open" }),
  ];
  const second = await poll(gh, first.cursor);
  assert.deepEqual(kinds(second.events).sort(), ["pr_merged#2", "pr_opened#3", "pr_opened#4", "pr_pushed#1"]);
  const opened = second.events.find((event) => event.prNumber === 3)!;
  assert.equal(opened.pr?.author, "bob");
  assert.deepEqual(opened.pr?.labels, ["ci"]);
  assert.match(opened.summary, /#3 opened by bob in acme\/widgets/u);
  assert.match(opened.details, /https:\/\/github\.com\/acme\/widgets\/pull\/3/u);
  repo.pulls = repo.pulls.map((each) => (each["number"] === 4 ? { ...each, state: "closed", updated_at: soon(3) } : each));
  const third = await poll(gh, second.cursor);
  assert.deepEqual(kinds(third.events), ["pr_closed#4"], "closed without merging");
  fake.log.length = 0;
  const quiet = await poll(gh, third.cursor);
  assert.deepEqual(quiet.events, []);
  assert.ok(quiet.stats.requests > 0);
  assert.equal(quiet.stats.notModified, quiet.stats.requests, "every request was answered 304: none counted against the rate limit");
  assert.ok(fake.log.every((entry) => entry.status === 304 && entry.etag), "each one carried If-None-Match");
});

test("reviews, comments and mentions are events; the operator's own comments and reviews never are", async () => {
  const state = fakeState();
  const { gh, repo } = inProcess(state);
  const wants = new Set<GitHubTriggerEvent>(["review_approved", "review_changes_requested", "comment", "mention"]);
  const base = await poll(gh, undefined, wants);
  assert.deepEqual(base.events, []);
  repo.pulls = [pull(1, { sha: sha("a"), updated: soon() }), pull(2, { sha: sha("b") })];
  repo.reviews = {
    "1": [
      { id: 11, user: { login: "bob" }, state: "APPROVED", body: "Looks good", submitted_at: soon(), html_url: "https://github.com/acme/widgets/pull/1#pullrequestreview-11" },
      { id: 12, user: { login: "operator" }, state: "CHANGES_REQUESTED", body: "mine", submitted_at: soon() },
    ],
  };
  repo.issueComments = [
    { id: 101, html_url: "https://github.com/acme/widgets/pull/1#issuecomment-101", body: "Hey @operator, can you look?", user: { login: "carol" }, created_at: soon() },
    { id: 102, html_url: "https://github.com/acme/widgets/pull/1#issuecomment-102", body: "my own note", user: { login: "operator" }, created_at: soon() },
    { id: 103, html_url: "https://github.com/acme/widgets/issues/9#issuecomment-103", body: "an issue, not a PR", user: { login: "erin" }, created_at: soon() },
  ];
  repo.reviewComments = [
    { id: 201, html_url: "https://github.com/acme/widgets/pull/2#discussion_r201", pull_request_url: "https://api.github.com/repos/acme/widgets/pulls/2", path: "src/a.ts", body: "nit", user: { login: "dave" }, created_at: soon() },
  ];
  const next = await poll(gh, base.cursor, wants);
  assert.deepEqual(kinds(next.events), ["review_approved#1", "comment#1", "comment#2"]);
  const mention = next.events.find((event) => event.actor === "carol")!;
  assert.deepEqual(mention.also, ["mention"], "a comment that mentions the operator counts as a mention");
  assert.match(mention.summary, /@carol mentioned you on #1/u);
  assert.match(mention.details, /> Hey @operator, can you look\?/u);
  assert.match(next.events.find((event) => event.actor === "dave")!.summary, /on #2 on src\/a\.ts/u);
  const again = await poll(gh, next.cursor, wants);
  assert.deepEqual(again.events, [], "nothing fires twice");
});

test("checks: running and then failing is an event once per commit; checks already finished at the first look are not", async () => {
  const state = fakeState();
  const { gh, repo } = inProcess(state);
  repo.checkRuns = { [sha("a")]: [{ name: "build", status: "completed", conclusion: "success" }] };
  const wants = new Set<GitHubTriggerEvent>(["checks_failed", "checks_succeeded"]);
  const base = await poll(gh, undefined, wants);
  assert.deepEqual(base.events, [], "finished before HUI looked: not news");
  repo.pulls = [pull(1, { sha: sha("f"), updated: soon() }), pull(2, { sha: sha("b") })];
  repo.checkRuns[sha("f")] = [{ name: "build", status: "in_progress", conclusion: null }, { name: "lint", status: "completed", conclusion: "success" }];
  const running = await poll(gh, base.cursor, wants);
  assert.deepEqual(running.events, [], "a push alone is not wanted, and the checks still run");
  assert.equal(running.cursor.prs["1"]?.checks?.state, "pending");
  repo.checkRuns[sha("f")] = [{ name: "build", status: "completed", conclusion: "failure" }, { name: "lint", status: "completed", conclusion: "success" }];
  repo.statuses = { [sha("f")]: [{ context: "ci/legacy", state: "error" }] };
  const failed = await poll(gh, running.cursor, wants);
  assert.deepEqual(kinds(failed.events), ["checks_failed#1"]);
  assert.match(failed.events[0]!.details, /failed: build, ci\/legacy; 1 passed/u);
  const later = await poll(gh, failed.cursor, wants);
  assert.deepEqual(later.events, [], "once per commit");
  assert.deepEqual(checksOutcome(checkRunsPart({ check_runs: [] }), statusesPart({ statuses: [] })).state, "none");
});

test("only the kinds the repo's triggers want come out", async () => {
  const state = fakeState();
  const { gh, repo } = inProcess(state);
  const wants = new Set<GitHubTriggerEvent>(["pr_merged"]);
  const base = await poll(gh, undefined, wants);
  repo.pulls = [...repo.pulls!, pull(5, { created: soon() })];
  const next = await poll(gh, base.cursor, wants);
  assert.deepEqual(next.events, [], "an opened pull request nobody asked for");
});

test("a 403 with Retry-After pauses polling and keeps the cursor; X-Poll-Interval lengthens the interval", async () => {
  const state = fakeState();
  const { gh } = inProcess(state);
  const base = await poll(gh, undefined);
  state.rateLimited = { retryAfter: 120 };
  const before = Date.now();
  const limited = await poll(gh, base.cursor);
  assert.equal(limited.error?.status, 403);
  assert.ok(limited.retryAt !== undefined && limited.retryAt >= before + 119_000, "waits as long as GitHub says");
  assert.deepEqual(limited.cursor.etags, base.cursor.etags, "nothing moved");
  assert.deepEqual(limited.events, []);
  delete state.rateLimited;
  state.pollInterval = 90;
  const slower = await poll(gh, base.cursor);
  assert.equal(slower.pollInterval, 90);
  assert.equal(slower.error, undefined);
});

test("one poller per repo for every trigger; cursors persist, so a restart never fires twice and its first poll is a catch-up", async (t) => {
  const dir = await tempDir(t);
  const state = fakeState();
  const { gh, repo } = inProcess(state);
  const file = join(dir, "cursors.json");
  const seen: GitHubEvent[] = [];
  const make = () => new GitHubPollers({ gh, cursors: cursorStore(file), onEvents: (events) => { seen.push(...events); }, intervalMs: 3_600_000, firstDelayMs: 3_600_000 });
  const wanted = new Map([[REPO, new Set<GitHubTriggerEvent>(["pr_opened"])]]);
  const pollers = make();
  t.after(() => pollers.stop());
  await pollers.sync(wanted);
  // Two triggers on the same repo are one entry of the map, and one poller.
  assert.deepEqual(pollers.repos, [REPO]);
  await pollers.pollNow(REPO);
  assert.equal(seen.length, 0, "the first poll is a silent baseline");
  repo.pulls = [...repo.pulls!, pull(5, { created: soon() })];
  await pollers.pollNow(REPO);
  assert.deepEqual(kinds(seen), ["pr_opened#5"]);
  assert.equal(seen[0]!.catchUp, undefined, "found while watching");
  assert.ok(pollers.status(REPO)!.requests >= 2);
  pollers.stop();

  const restarted = make();
  t.after(() => restarted.stop());
  await restarted.sync(wanted);
  await restarted.pollNow(REPO);
  assert.deepEqual(kinds(seen), ["pr_opened#5"], "a restart never fires the same event again");
  assert.equal(restarted.status(REPO)!.notModified, restarted.status(REPO)!.requests, "and its polls were all 304s");
  restarted.stop();

  repo.pulls = [...repo.pulls!, pull(6, { created: soon(4) })];
  const later = make();
  t.after(() => later.stop());
  await later.sync(wanted);
  await later.pollNow(REPO);
  assert.deepEqual(kinds(seen), ["pr_opened#5", "pr_opened#6"]);
  assert.equal(seen[1]!.catchUp, true, "what happened while HUI was away is a catch-up");
  await later.sync(new Map());
  assert.deepEqual(later.repos, []);
  const saved = JSON.parse(await readFile(file, "utf8")) as { repos: Record<string, unknown> };
  assert.deepEqual(saved.repos, {}, "a repo no trigger watches forgets its cursor: watching it again starts with a baseline");
});
