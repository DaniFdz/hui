/**
 * GitHub triggers' source (HUI-18): one poller per repo, shared by every trigger that names it, reading the repo
 * through the operator's GitHub CLI (`gh api`), as previews and badges do (`github-previews.ts`).
 *
 * Per-repo listing, not the notifications API (SPEC.md, "Triggers wake bots on GitHub, session and webhook events"):
 * notifications only cover the threads the operator watches or takes part in, under their GitHub settings, carry a
 * sticky reason rather than the event (a thread stays `mention` after the first one), and need a request per thread
 * for what happened anyway. A repo's pull requests, sorted by their last update, answer most of it in one
 * conditional request: opened, pushed, merged and closed come from comparing each pull request with the cursor; its
 * comments come from two repo-wide lists; reviews from the pull requests that moved; checks from the head commits
 * whose checks are still running.
 *
 * Every request is conditional on the ETag of the last answer (`If-None-Match`), so a poll that finds nothing new is
 * answered 304, which does not count against the rate limit. `X-Poll-Interval` lengthens the interval, `Retry-After`
 * and an exhausted rate limit pause the poller, and errors back off. The cursor (ETags, each pull request's last state,
 * the newest comment ids) is saved before any event goes out, so a restart never fires one twice, and a repo's first
 * poll only records where it stands: a silent baseline.
 */
import { execFile } from "node:child_process";

import { GITHUB_TRIGGER_EVENTS, type GitHubTriggerEvent } from "../shared/bot-triggers.ts";
import type { CursorState, JsonStateFile } from "./bot-triggers-store.ts";
import { GH_ENV } from "./github.ts";
import { classifyGhFailure, GitHubApiError } from "./github-previews.ts";

/** How often a repo is polled unless GitHub asks for longer (`X-Poll-Interval`). */
export const DEFAULT_POLL_MS = 60_000;
/** The longest a failing poller waits before it tries again. */
const MAX_BACKOFF_MS = 15 * 60_000;
/** A repo GitHub answers 404 for (gone, or the account can't see it) is asked again after this long. */
const NOT_FOUND_RETRY_MS = 15 * 60_000;
/** Below this many requests left, a poller waits for the rate limit's reset. */
const RATE_FLOOR = 50;
/** Pull requests one list reads: the most recently updated. */
const PULLS_PER_PAGE = 30;
const COMMENTS_PER_PAGE = 50;
/** Pull requests whose reviews, or whose checks, one poll reads. */
const REVIEWS_PER_POLL = 10;
const CHECKS_PER_POLL = 10;
/** Pull requests a comment names that the cursor doesn't know, read in one poll. */
const LOOKUPS_PER_POLL = 10;
/** Pull requests a cursor remembers. */
const MAX_SNAPSHOTS = 200;
/** Checks still running after this long stop being watched. */
const CHECKS_WATCH_MS = 6 * 3_600_000;
/** A pushed commit without any check after this long has none. */
const CHECKS_START_MS = 10 * 60_000;
const DETAILS_QUOTE = 600;

const MENTION: GitHubTriggerEvent[] = ["mention"];
const REVIEW_EVENTS: ReadonlySet<GitHubTriggerEvent> = new Set(["review_approved", "review_changes_requested", "review_commented", "mention"]);
const COMMENT_EVENTS: ReadonlySet<GitHubTriggerEvent> = new Set(["comment", "mention"]);
const CHECK_EVENTS: ReadonlySet<GitHubTriggerEvent> = new Set(["checks_failed", "checks_succeeded"]);

/* ── gh ─────────────────────────────────────────────────────────────── */

export type GhResponse = { status: number; headers: Readonly<Record<string, string>>; body: unknown };
/** One GitHub REST `GET` through gh; conditional (`If-None-Match`) when `etag` is given. */
export type GhRest = (path: string, etag?: string) => Promise<GhResponse>;

/** An ETag as GitHub sends it: weak or strong, quoted, printable. Anything else is never sent back. */
const ETAG = /^(?:W\/)?"[\x21\x23-\x7e]{1,200}"$/u;

/**
 * `gh api --include` output: the status line, the headers (names lowercased), then the body. gh prints them for every
 * status, a 304 included (for which it exits 1 with `gh: HTTP 304`).
 */
export function parseGhInclude(stdout: string): { status: number; headers: Record<string, string>; body: string } | undefined {
  const start = /^HTTP\/[\d.]+ (\d{3})[^\n]*\n/u.exec(stdout);
  if (!start) return undefined;
  const rest = stdout.slice(start[0].length);
  const end = /\r?\n\r?\n/u.exec(rest);
  const head = end ? rest.slice(0, end.index) : rest;
  const headers: Record<string, string> = {};
  for (const line of head.split(/\r?\n/u)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status: Number(start[1]), headers, body: end ? rest.slice(end.index + end[0].length) : "" };
}

/** `gh api --include`, run with argument arrays (never a shell), as `ghApi` runs it. */
export function ghRest(command = "gh", env: NodeJS.ProcessEnv = process.env): GhRest {
  const childEnv = { ...env, ...GH_ENV };
  return (path, etag) => new Promise((resolve, reject) => {
    const args = ["api", "--include", "-H", "Accept: application/vnd.github+json", ...(etag && ETAG.test(etag) ? ["-H", `If-None-Match: ${etag}`] : []), path];
    execFile(command, args, { env: childEnv, timeout: 20_000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      const included = parseGhInclude(typeof stdout === "string" ? stdout : "");
      if (!included) {
        reject(new GitHubApiError(error ? classifyGhFailure({ code: error.code, stderr }) : "unavailable"));
        return;
      }
      let body: unknown;
      if (included.body.trim()) {
        try {
          body = JSON.parse(included.body);
        } catch {
          // A success must be JSON; an error's body is only read for its message.
          if (included.status >= 200 && included.status < 300) {
            reject(new GitHubApiError("unavailable"));
            return;
          }
        }
      }
      resolve({ status: included.status, headers: included.headers, body });
    });
  });
}

/* ── cursor ─────────────────────────────────────────────────────────── */

export type ChecksState = "pending" | "success" | "failure" | "none";

export type PrSnapshot = {
  number: number;
  title: string;
  url: string;
  author: string;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  base: string;
  head: string;
  sha: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  /** It moved since its reviews were last read. */
  stale?: true;
  /** Review ids seen; absent until its reviews are first read. */
  reviews?: number[];
  /** Its head commit's checks: `pending` until they finish, then what they came to, once per commit; each endpoint's
   * last answer, so a 304 from one of them still combines with the other. */
  checks?: { sha: string; state: ChecksState; since: string; runs?: ChecksPart; statuses?: ChecksPart };
};

/** What one checks endpoint (check runs, or commit statuses) said about a commit. */
export type ChecksPart = { pending: boolean; failed: string[]; passed: number; seen: number };

export type RepoCursor = {
  /** The first poll, GitHub's clock. */
  baselineAt: string;
  /** The previous poll of the pull requests, GitHub's clock: a pull request created since is new. */
  polledAt: string;
  etags: Record<string, string>;
  prs: Record<string, PrSnapshot>;
  /** Newest comment ids seen; absent until comments are first read, which only records them. */
  issueComments?: number;
  reviewComments?: number;
  /** Since when reviews are watched: a pull request's first read of its reviews reports those submitted after it. */
  reviewsSince?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const text = (value: unknown, max = 300): string => (typeof value === "string" ? value.slice(0, max) : "");
const whole = (value: unknown): number | undefined => (Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined);
const iso = (value: unknown): string | undefined => (typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined);

function parseSnapshot(raw: unknown): PrSnapshot | undefined {
  if (!isRecord(raw)) return undefined;
  const number = whole(raw["number"]);
  const createdAt = iso(raw["createdAt"]);
  const updatedAt = iso(raw["updatedAt"]);
  if (!number || !createdAt || !updatedAt || (raw["state"] !== "open" && raw["state"] !== "closed")) return undefined;
  const stored = isRecord(raw["checks"]) ? raw["checks"] : undefined;
  const runs = parsePart(stored?.["runs"]);
  const statuses = parsePart(stored?.["statuses"]);
  const checks = stored && typeof stored["sha"] === "string" && iso(stored["since"]) && ["pending", "success", "failure", "none"].includes(stored["state"] as string)
    ? { sha: stored["sha"], state: stored["state"] as ChecksState, since: stored["since"] as string, ...(runs ? { runs } : {}), ...(statuses ? { statuses } : {}) }
    : undefined;
  return {
    number, title: text(raw["title"]), url: text(raw["url"], 500), author: text(raw["author"], 60), state: raw["state"],
    merged: raw["merged"] === true, draft: raw["draft"] === true, base: text(raw["base"], 200), head: text(raw["head"], 200),
    sha: typeof raw["sha"] === "string" && /^[0-9a-f]{40,64}$/u.test(raw["sha"]) ? raw["sha"] : "",
    labels: Array.isArray(raw["labels"]) ? raw["labels"].filter((label): label is string => typeof label === "string").slice(0, 50) : [],
    createdAt, updatedAt,
    ...(raw["stale"] === true ? { stale: true } : {}),
    ...(Array.isArray(raw["reviews"]) ? { reviews: raw["reviews"].filter((id): id is number => Number.isSafeInteger(id)).slice(-200) } : {}),
    ...(checks ? { checks } : {}),
  };
}

function parsePart(raw: unknown): ChecksPart | undefined {
  if (!isRecord(raw) || typeof raw["pending"] !== "boolean" || !Array.isArray(raw["failed"])) return undefined;
  return {
    pending: raw["pending"], failed: raw["failed"].filter((name): name is string => typeof name === "string").slice(0, 50),
    passed: whole(raw["passed"]) ?? 0, seen: whole(raw["seen"]) ?? 0,
  };
}

/** A saved cursor, or undefined when it can't be read exactly, which makes the next poll a silent baseline again. */
export function parseCursor(raw: unknown): RepoCursor | undefined {
  if (!isRecord(raw)) return undefined;
  const baselineAt = iso(raw["baselineAt"]);
  const polledAt = iso(raw["polledAt"]);
  if (!baselineAt || !polledAt || !isRecord(raw["prs"]) || !isRecord(raw["etags"])) return undefined;
  const prs: Record<string, PrSnapshot> = Object.fromEntries(Object.entries(raw["prs"]).flatMap(([key, value]): [string, PrSnapshot][] => {
    const snapshot = parseSnapshot(value);
    return snapshot && String(snapshot.number) === key ? [[key, snapshot]] : [];
  }));
  const etags: Record<string, string> = Object.fromEntries(Object.entries(raw["etags"]).filter((entry): entry is [string, string] => typeof entry[1] === "string" && ETAG.test(entry[1])));
  const issueComments = whole(raw["issueComments"]);
  const reviewComments = whole(raw["reviewComments"]);
  const reviewsSince = iso(raw["reviewsSince"]);
  return {
    baselineAt, polledAt, etags, prs,
    ...(issueComments !== undefined ? { issueComments } : {}),
    ...(reviewComments !== undefined ? { reviewComments } : {}),
    ...(reviewsSince ? { reviewsSince } : {}),
  };
}

/* ── events ─────────────────────────────────────────────────────────── */

/** The pull request an event is about, as filters read it. */
export type EventPull = Pick<PrSnapshot, "number" | "title" | "url" | "author" | "base" | "head" | "draft" | "labels" | "state" | "merged">;

export type GitHubEvent = {
  /** The repo as triggers name it, lowercased. */
  repo: string;
  kind: GitHubTriggerEvent;
  /** Kinds the same event counts as too: a comment that mentions the operator is a mention. */
  also?: GitHubTriggerEvent[];
  /** Absent: the pull request could not be read, and filters that need it don't match. */
  pr?: EventPull;
  prNumber: number;
  actor?: string;
  /** One line. */
  summary: string;
  details: string;
  at: string;
  /** Found by the first poll after the poller (re)started from a saved cursor: it happened while HUI was not watching. */
  catchUp?: true;
};

const oneLine = (value: string, max: number) => {
  const line = value.replace(/\s+/gu, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
};

/** The first lines of a text, quoted, at most `max` characters. */
function quote(body: string, max = DETAILS_QUOTE): string {
  const trimmed = body.replace(/\r\n?/gu, "\n").trim();
  const cut = trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
  return cut.split("\n").map((line) => `  > ${line}`).join("\n");
}

function prLine(repo: string, pr: EventPull | undefined, number: number): string {
  if (!pr) return `${repo}#${number}`;
  return `${repo}#${pr.number} "${oneLine(pr.title, 120)}" (by ${pr.author || "someone"}, ${pr.head || "?"} → ${pr.base || "?"}${pr.draft ? ", draft" : ""}${pr.labels.length ? `, labels: ${pr.labels.slice(0, 6).join(", ")}` : ""})`;
}

function event(repo: string, kind: GitHubTriggerEvent, pr: EventPull | undefined, number: number, summary: string, extra: readonly string[], at: string, options: { actor?: string; also?: GitHubTriggerEvent[] } = {}): GitHubEvent {
  return {
    repo, kind, prNumber: number, ...(pr ? { pr } : {}), ...(options.actor ? { actor: options.actor } : {}), ...(options.also?.length ? { also: options.also } : {}),
    summary: oneLine(summary, 160),
    details: [prLine(repo, pr, number), ...(pr?.url ? [`  ${pr.url}`] : []), ...extra].join("\n"),
    at,
  };
}

const LOGIN_CHARACTER = /[A-Za-z0-9-]/u;

/** `@login` as a whole word, any case; a plain search, so no text from GitHub ever becomes a pattern. */
export function mentions(body: string, login: string | undefined): boolean {
  if (!login) return false;
  const text = body.toLowerCase();
  const wanted = `@${login.toLowerCase()}`;
  for (let at = text.indexOf(wanted); at !== -1; at = text.indexOf(wanted, at + 1)) {
    const before = at === 0 ? "" : text[at - 1]!;
    const after = text[at + wanted.length] ?? "";
    if (!LOGIN_CHARACTER.test(before) && !LOGIN_CHARACTER.test(after)) return true;
  }
  return false;
}

/* ── one poll ───────────────────────────────────────────────────────── */

export type PollStats = { requests: number; notModified: number };

export type PollOutcome = {
  cursor: RepoCursor;
  events: GitHubEvent[];
  stats: PollStats;
  /** Seconds GitHub asked to wait between polls (`X-Poll-Interval`). */
  pollInterval?: number;
  /** Don't ask again before this time (epoch ms): `Retry-After` or an exhausted rate limit. */
  retryAt?: number;
  rateRemaining?: number;
  /** What stopped the poll early; what it read before that is in `cursor`. */
  error?: { message: string; status?: number };
};

type Gh = { get(path: string): Promise<GhResponse | undefined> };

class PollStop extends Error {}

function snapshotOf(raw: Record<string, unknown>, previous: PrSnapshot | undefined): PrSnapshot | undefined {
  const number = whole(raw["number"]);
  const createdAt = iso(raw["created_at"]);
  const updatedAt = iso(raw["updated_at"]);
  if (!number || !createdAt || !updatedAt) return undefined;
  const head = isRecord(raw["head"]) ? raw["head"] : {};
  const base = isRecord(raw["base"]) ? raw["base"] : {};
  const user = isRecord(raw["user"]) ? raw["user"] : {};
  // A commit id goes into request paths (its checks): only a real one, hex.
  const sha = typeof head["sha"] === "string" && /^[0-9a-f]{40,64}$/u.test(head["sha"]) ? head["sha"] : "";
  return {
    number, title: text(raw["title"]), url: text(raw["html_url"], 500), author: text(user["login"], 60),
    state: raw["state"] === "closed" ? "closed" : "open",
    merged: typeof raw["merged_at"] === "string" || raw["merged"] === true,
    draft: raw["draft"] === true,
    base: text(base["ref"], 200), head: text(head["ref"], 200), sha,
    labels: Array.isArray(raw["labels"]) ? raw["labels"].map((label) => text(isRecord(label) ? label["name"] : label, 100)).filter(Boolean).slice(0, 50) : [],
    createdAt, updatedAt,
    ...(previous?.stale ? { stale: true } : {}),
    ...(previous?.reviews ? { reviews: previous.reviews } : {}),
    ...(previous?.checks ? { checks: previous.checks } : {}),
  };
}

const pullOf = (snapshot: PrSnapshot): EventPull => ({
  number: snapshot.number, title: snapshot.title, url: snapshot.url, author: snapshot.author, base: snapshot.base, head: snapshot.head,
  draft: snapshot.draft, labels: snapshot.labels, state: snapshot.state, merged: snapshot.merged,
});

const later = (a: string, b: string) => Date.parse(a) >= Date.parse(b);

/** `GET …/commits/:sha/check-runs`: a run still going is pending; a failure, timeout, cancellation or required
 * action failed; anything else that completed passed. */
export function checkRunsPart(body: unknown): ChecksPart {
  const part: ChecksPart = { pending: false, failed: [], passed: 0, seen: 0 };
  for (const run of isRecord(body) && Array.isArray(body["check_runs"]) ? body["check_runs"] : []) {
    if (!isRecord(run)) continue;
    part.seen += 1;
    if (run["status"] !== "completed") part.pending = true;
    else if (["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(String(run["conclusion"]))) part.failed.push(text(run["name"], 100) || "check");
    else part.passed += 1;
  }
  return part;
}

/** `GET …/commits/:sha/status`: commit statuses, as older CI services report them. */
export function statusesPart(body: unknown): ChecksPart {
  const part: ChecksPart = { pending: false, failed: [], passed: 0, seen: 0 };
  for (const each of isRecord(body) && Array.isArray(body["statuses"]) ? body["statuses"] : []) {
    if (!isRecord(each)) continue;
    part.seen += 1;
    if (each["state"] === "pending") part.pending = true;
    else if (each["state"] === "failure" || each["state"] === "error") part.failed.push(text(each["context"], 100) || "status");
    else part.passed += 1;
  }
  return part;
}

/** Both endpoints together: pending while anything runs, none before anything reported, else failure when any failed. */
export function checksOutcome(runs: ChecksPart, statuses: ChecksPart): { state: ChecksState; failed: string[]; passed: number } {
  const failed = [...runs.failed, ...statuses.failed];
  const passed = runs.passed + statuses.passed;
  if (runs.pending || statuses.pending) return { state: "pending", failed, passed };
  if (!runs.seen && !statuses.seen) return { state: "none", failed, passed };
  return { state: failed.length ? "failure" : "success", failed, passed };
}

/**
 * One poll of one repo: what changed since `cursor` (undefined: the first poll, which only records where the repo
 * stands), and the next cursor. Only the kinds in `wants` come out as events, and only what they need is read.
 * Never throws for GitHub's answers: a failure ends the poll early with `error`, keeping what it read.
 */
export async function pollRepo(input: {
  repo: string;
  cursor: RepoCursor | undefined;
  wants: ReadonlySet<GitHubTriggerEvent>;
  gh: GhRest;
  /** The operator's login: mentions of it are mentions, and their own comments and reviews are never events. */
  login: string | undefined;
  now: () => number;
}): Promise<PollOutcome> {
  const { repo, wants, login } = input;
  const stats: PollStats = { requests: 0, notModified: 0 };
  const events: GitHubEvent[] = [];
  const outcome: Omit<PollOutcome, "cursor" | "events" | "stats"> = {};
  const nowIso = () => new Date(input.now()).toISOString();
  const previous = input.cursor;
  const cursor: RepoCursor = previous
    ? { ...previous, etags: { ...previous.etags }, prs: Object.fromEntries(Object.entries(previous.prs).map(([key, value]) => [key, { ...value }])) }
    : { baselineAt: nowIso(), polledAt: nowIso(), etags: {}, prs: {} };
  const baseline = !previous;
  const own = (actor: string) => Boolean(login) && actor.toLowerCase() === login!.toLowerCase();
  const wanted = (kinds: ReadonlySet<GitHubTriggerEvent>) => [...kinds].some((kind) => wants.has(kind));
  const emit = (item: GitHubEvent) => {
    if (wants.has(item.kind) || item.also?.some((kind) => wants.has(kind))) events.push(item);
  };

  const gh: Gh = {
    async get(path) {
      stats.requests += 1;
      let response: GhResponse;
      try {
        response = await input.gh(path, cursor.etags[path]);
      } catch (error) {
        const reason = error instanceof GitHubApiError ? error.reason : "unavailable";
        outcome.error = { message: reason === "signed_out" ? "gh is not signed in to GitHub: sign in under Settings → Integrations → GitHub."
          : reason === "cli_missing" ? "The GitHub CLI (gh) is not installed on the gateway's machine." : "GitHub could not be reached through gh." };
        throw new PollStop();
      }
      const interval = Number(response.headers["x-poll-interval"]);
      if (Number.isFinite(interval) && interval > 0) outcome.pollInterval = Math.max(outcome.pollInterval ?? 0, interval);
      const remaining = Number(response.headers["x-ratelimit-remaining"]);
      const reset = Number(response.headers["x-ratelimit-reset"]) * 1_000;
      if (Number.isFinite(remaining) && response.headers["x-ratelimit-remaining"] !== undefined) outcome.rateRemaining = remaining;
      if (response.status === 304) {
        stats.notModified += 1;
        return undefined;
      }
      const retryAfter = Number(response.headers["retry-after"]);
      if (response.status === 429 || (response.status === 403 && (Number.isFinite(retryAfter) || remaining === 0))) {
        outcome.retryAt = Number.isFinite(retryAfter) && retryAfter > 0 ? input.now() + retryAfter * 1_000 : Number.isFinite(reset) ? reset : input.now() + DEFAULT_POLL_MS;
        outcome.error = { message: "GitHub's rate limit: polling waits until it allows more requests.", status: response.status };
        throw new PollStop();
      }
      if (response.status === 401) {
        outcome.error = { message: "gh is not signed in to GitHub: sign in under Settings → Integrations → GitHub.", status: 401 };
        throw new PollStop();
      }
      if (response.status === 404) {
        outcome.error = { message: `GitHub has no ${repo}, or the gh account can't see it.`, status: 404 };
        throw new PollStop();
      }
      if (response.status < 200 || response.status >= 300) {
        const message = isRecord(response.body) && typeof response.body["message"] === "string" ? oneLine(response.body["message"], 200) : `HTTP ${response.status}`;
        outcome.error = { message: `GitHub answered ${message}.`, status: response.status };
        throw new PollStop();
      }
      if (Number.isFinite(remaining) && remaining < RATE_FLOOR && Number.isFinite(reset)) outcome.retryAt = reset;
      const etag = response.headers["etag"];
      if (etag && ETAG.test(etag)) cursor.etags[path] = etag;
      else delete cursor.etags[path];
      return response;
    },
  };

  try {
    // Pull requests: opened, pushed, merged, closed; and which moved, for their reviews.
    const pullsPath = `repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${PULLS_PER_PAGE}`;
    const pulls = await gh.get(pullsPath);
    if (pulls) {
      const serverNow = Date.parse(pulls.headers["date"] ?? "");
      const polledAt = Number.isFinite(serverNow) ? new Date(serverNow).toISOString() : nowIso();
      const list = Array.isArray(pulls.body) ? pulls.body.filter(isRecord) : [];
      for (const raw of list) {
        const before = cursor.prs[String(raw["number"])];
        const next = snapshotOf(raw, before);
        if (!next) continue;
        cursor.prs[String(next.number)] = next;
        if (baseline) continue;
        const pr = pullOf(next);
        const at = next.updatedAt;
        if (!before) {
          // Not known: new when created since the previous poll, otherwise an older pull request that moved up.
          if (!later(next.createdAt, previous!.polledAt)) {
            next.stale = true;
            continue;
          }
          emit(event(repo, "pr_opened", pr, next.number, `#${next.number} opened by ${next.author || "someone"} in ${repo}: ${next.title}`, [], next.createdAt, { actor: next.author, ...(mentions(text(raw["body"], 20_000), login) && !own(next.author) ? { also: MENTION } : {}) }));
          if (next.state === "open") next.checks = { sha: next.sha, state: "pending", since: nowIso() };
          if (next.state === "closed") emit(event(repo, next.merged ? "pr_merged" : "pr_closed", pr, next.number, `#${next.number} ${next.merged ? "merged" : "closed without merging"} in ${repo}: ${next.title}`, [], at));
          continue;
        }
        if (next.updatedAt !== before.updatedAt) next.stale = true;
        if (before.state === "open" && next.state === "closed") {
          emit(event(repo, next.merged ? "pr_merged" : "pr_closed", pr, next.number, `#${next.number} ${next.merged ? "merged" : "closed without merging"} in ${repo}: ${next.title}`, [], at));
        } else if (before.state === "closed" && next.state === "open") {
          emit(event(repo, "pr_opened", pr, next.number, `#${next.number} reopened in ${repo}: ${next.title}`, [], at, { actor: next.author }));
          next.checks = { sha: next.sha, state: "pending", since: nowIso() };
        } else if (next.state === "open" && next.sha && next.sha !== before.sha) {
          emit(event(repo, "pr_pushed", pr, next.number, `new commits on #${next.number} in ${repo}: ${next.title}`, [`  head ${next.sha.slice(0, 7)} (was ${before.sha.slice(0, 7) || "?"})`], at));
          next.checks = { sha: next.sha, state: "pending", since: nowIso() };
        }
      }
      cursor.polledAt = polledAt;
      // Remember the most recently updated, open ones first.
      const kept = Object.values(cursor.prs).sort((a, b) => (a.state === b.state ? Date.parse(b.updatedAt) - Date.parse(a.updatedAt) : a.state === "open" ? -1 : 1)).slice(0, MAX_SNAPSHOTS);
      cursor.prs = Object.fromEntries(kept.map((snapshot) => [String(snapshot.number), snapshot]));
    }

    // Reviews of the pull requests that moved; watched from `reviewsSince`.
    if (wanted(REVIEW_EVENTS)) {
      const reviewsSince = (cursor.reviewsSince ??= baseline ? cursor.baselineAt : nowIso());
      const moved = Object.values(cursor.prs).filter((snapshot) => snapshot.stale).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, REVIEWS_PER_POLL);
      for (const snapshot of moved) {
        const response = await gh.get(`repos/${repo}/pulls/${snapshot.number}/reviews?per_page=100`);
        if (response) {
          const reviews = Array.isArray(response.body) ? response.body.filter(isRecord) : [];
          const seen = new Set(snapshot.reviews ?? []);
          for (const review of reviews) {
            const id = whole(review["id"]);
            const actor = text(isRecord(review["user"]) ? review["user"]["login"] : "", 60);
            const submitted = iso(review["submitted_at"]);
            if (id === undefined || seen.has(id) || !submitted) continue;
            seen.add(id);
            const fresh = snapshot.reviews ? true : later(submitted, reviewsSince);
            if (!fresh || baseline || own(actor)) continue;
            const state = String(review["state"]);
            const kind: GitHubTriggerEvent | undefined = state === "APPROVED" ? "review_approved" : state === "CHANGES_REQUESTED" ? "review_changes_requested" : state === "COMMENTED" ? "review_commented" : undefined;
            if (!kind) continue;
            const body = text(review["body"], 20_000);
            const verb = kind === "review_approved" ? "approved" : kind === "review_changes_requested" ? "requested changes on" : "reviewed";
            emit(event(repo, kind, pullOf(snapshot), snapshot.number, `@${actor} ${verb} #${snapshot.number} in ${repo}`,
              [...(text(review["html_url"], 500) ? [`  ${text(review["html_url"], 500)}`] : []), ...(body.trim() ? [quote(body)] : [])], submitted,
              { actor, ...(mentions(body, login) ? { also: MENTION } : {}) }));
          }
          snapshot.reviews = [...seen].slice(-200);
        }
        delete snapshot.stale;
      }
    } else {
      delete cursor.reviewsSince;
      for (const snapshot of Object.values(cursor.prs)) {
        delete snapshot.reviews;
        delete snapshot.stale;
      }
    }

    // Comments: the repo's newest, on pull requests only.
    if (wanted(COMMENT_EVENTS)) {
      const lookups: number[] = [];
      for (const [path, key, pattern] of [
        [`repos/${repo}/issues/comments?sort=created&direction=desc&per_page=${COMMENTS_PER_PAGE}`, "issueComments", /\/pull\/(\d+)#issuecomment-/u],
        [`repos/${repo}/pulls/comments?sort=created&direction=desc&per_page=${COMMENTS_PER_PAGE}`, "reviewComments", /\/pull\/(\d+)#discussion_r/u],
      ] as const) {
        const response = await gh.get(path);
        if (!response) continue;
        const comments = (Array.isArray(response.body) ? response.body.filter(isRecord) : []).map((comment) => ({ comment, id: whole(comment["id"]) ?? 0 }))
          .sort((a, b) => a.id - b.id);
        const last = cursor[key];
        const newest = comments.reduce((max, each) => Math.max(max, each.id), last ?? 0);
        if (last !== undefined) {
          for (const { comment, id } of comments) {
            if (id <= last) continue;
            const url = text(comment["html_url"], 500);
            const number = Number(pattern.exec(url)?.[1] ?? (key === "reviewComments" ? /\/pulls\/(\d+)$/u.exec(text(comment["pull_request_url"], 500))?.[1] : undefined));
            if (!Number.isSafeInteger(number) || number < 1) continue;
            const actor = text(isRecord(comment["user"]) ? comment["user"]["login"] : "", 60);
            if (own(actor)) continue;
            let snapshot = cursor.prs[String(number)];
            if (!snapshot && lookups.length < LOOKUPS_PER_POLL && !lookups.includes(number)) {
              lookups.push(number);
              const pull = await gh.get(`repos/${repo}/pulls/${number}`);
              const read = pull && isRecord(pull.body) ? snapshotOf(pull.body, undefined) : undefined;
              if (read) snapshot = cursor.prs[String(number)] = read;
            }
            const body = text(comment["body"], 20_000);
            const mentioned = mentions(body, login);
            const where = key === "reviewComments" && text(comment["path"], 300) ? ` on ${text(comment["path"], 300)}` : "";
            emit(event(repo, "comment", snapshot ? pullOf(snapshot) : undefined, number,
              `@${actor} ${mentioned ? "mentioned you" : "commented"} on #${number}${where} in ${repo}`,
              [...(url ? [`  ${url}`] : []), quote(body)], iso(comment["created_at"]) ?? nowIso(), { actor, ...(mentioned ? { also: MENTION } : {}) }));
          }
        }
        cursor[key] = newest;
      }
    } else {
      delete cursor.issueComments;
      delete cursor.reviewComments;
    }

    // Checks of open pull requests' head commits, until they finish.
    if (wanted(CHECK_EVENTS)) {
      const now = input.now();
      const watched = Object.values(cursor.prs)
        .filter((snapshot) => snapshot.state === "open" && snapshot.sha && (!snapshot.checks || snapshot.checks.sha !== snapshot.sha
          || ((snapshot.checks.state === "pending" || snapshot.checks.state === "none") && now - Date.parse(snapshot.checks.since) < CHECKS_WATCH_MS)))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, CHECKS_PER_POLL);
      for (const snapshot of watched) {
        const known = snapshot.checks?.sha === snapshot.sha ? snapshot.checks : undefined;
        if (known?.state === "none" && now - Date.parse(known.since) > CHECKS_START_MS) continue;
        const runsPath = `repos/${repo}/commits/${snapshot.sha}/check-runs?per_page=100`;
        const statusPath = `repos/${repo}/commits/${snapshot.sha}/status`;
        const runsAnswer = await gh.get(runsPath);
        const statusAnswer = await gh.get(statusPath);
        // A 304 repeats the answer the cursor kept; without one kept, ask in full next time.
        const runs = runsAnswer ? checkRunsPart(runsAnswer.body) : known?.runs;
        const statuses = statusAnswer ? statusesPart(statusAnswer.body) : known?.statuses;
        if (!runs) delete cursor.etags[runsPath];
        if (!statuses) delete cursor.etags[statusPath];
        if (!runs || !statuses) continue;
        const result = checksOutcome(runs, statuses);
        const since = known?.since ?? nowIso();
        // An outcome only counts as an event when HUI saw the checks running: a pushed commit, or one still pending.
        if (known && (known.state === "pending" || known.state === "none") && (result.state === "success" || result.state === "failure") && !baseline) {
          const failed = result.state === "failure";
          emit(event(repo, failed ? "checks_failed" : "checks_succeeded", pullOf(snapshot), snapshot.number,
            `checks ${failed ? "failed" : "passed"} on #${snapshot.number} in ${repo}: ${snapshot.title}`,
            [`  commit ${snapshot.sha.slice(0, 7)}: ${failed ? `failed: ${result.failed.slice(0, 10).join(", ")}${result.failed.length > 10 ? ` +${result.failed.length - 10}` : ""}; ` : ""}${result.passed} passed`],
            nowIso()));
        }
        snapshot.checks = { sha: snapshot.sha, state: result.state, since, runs, statuses };
      }
    } else {
      for (const snapshot of Object.values(cursor.prs)) delete snapshot.checks;
    }
  } catch (error) {
    if (!(error instanceof PollStop)) throw error;
  }
  // ETags of requests this cursor no longer makes would only grow the file.
  for (const path of Object.keys(cursor.etags)) {
    const commit = /\/commits\/([0-9a-f]{40})\//u.exec(path)?.[1];
    const pull = /\/pulls\/(\d+)(?:\/reviews|\?|$)/u.exec(path)?.[1];
    if (commit && !Object.values(cursor.prs).some((snapshot) => snapshot.sha === commit)) delete cursor.etags[path];
    else if (pull && !cursor.prs[pull]) delete cursor.etags[path];
  }
  return { cursor, events, stats, ...outcome };
}

/* ── pollers ────────────────────────────────────────────────────────── */

export type RepoPollStatus = {
  repo: string;
  polledAt?: string;
  nextAt?: string;
  error?: string;
  /** Requests since the gateway started polling it, and how many were answered 304 (free of the rate limit). */
  requests: number;
  notModified: number;
  rateRemaining?: number;
};

type Poller = {
  repo: string;
  wants: ReadonlySet<GitHubTriggerEvent>;
  timer?: ReturnType<typeof setTimeout>;
  /** A poll completed since this poller started: until then, what it finds happened while HUI was not watching. */
  polled: boolean;
  failures: number;
  status: RepoPollStatus;
};

export type GitHubPollersDeps = {
  gh: GhRest;
  cursors: JsonStateFile<CursorState>;
  /** Every poll's events, after its cursor is saved. */
  onEvents(events: GitHubEvent[]): Promise<void> | void;
  intervalMs?: number;
  /** Before a new poller's first poll; a short random spread by default, so starting many repos doesn't burst. */
  firstDelayMs?: number;
  now?: () => number;
  report?(level: "info" | "warning", action: string, summary: string, detail?: string): void;
};

/** `GITHUB_TRIGGER_EVENTS`, for checks on a wants set read from elsewhere. */
export const isGitHubTriggerEvent = (value: unknown): value is GitHubTriggerEvent => (GITHUB_TRIGGER_EVENTS as readonly unknown[]).includes(value);

/**
 * The pollers, one per repo some enabled trigger names. Requests go out one at a time across all of them (GitHub
 * asks for serial requests). `sync` starts what's missing and stops (and forgets the cursor of) what is no longer
 * wanted; `stop` pauses every poller and keeps the cursors, so the next `sync` resumes from them.
 */
export class GitHubPollers {
  readonly #deps: GitHubPollersDeps;
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #pollers = new Map<string, Poller>();
  #queue: Promise<unknown> = Promise.resolve();
  #login?: { value: string | undefined; at: number };

  constructor(deps: GitHubPollersDeps) {
    this.#deps = deps;
    this.#intervalMs = deps.intervalMs ?? DEFAULT_POLL_MS;
    this.#now = deps.now ?? Date.now;
  }

  /** Repo (lowercase) → the kinds its triggers want. */
  async sync(wanted: ReadonlyMap<string, ReadonlySet<GitHubTriggerEvent>>): Promise<void> {
    const dropped = [...this.#pollers.keys()].filter((repo) => !wanted.has(repo));
    for (const repo of dropped) this.#remove(repo);
    for (const [repo, wants] of wanted) {
      const poller = this.#pollers.get(repo);
      if (poller) {
        poller.wants = wants;
        continue;
      }
      const created: Poller = { repo, wants, polled: false, failures: 0, status: { repo, requests: 0, notModified: 0 } };
      this.#pollers.set(repo, created);
      this.#schedule(created, this.#deps.firstDelayMs ?? Math.min(2_000, this.#intervalMs / 4) * Math.random());
    }
    // A repo no trigger watches any more forgets where it was: watching it again starts with a silent baseline.
    const saved = await this.#deps.cursors.read().catch(() => undefined);
    const forget = Object.keys(saved?.repos ?? {}).filter((repo) => !wanted.has(repo));
    if (forget.length) {
      await this.#deps.cursors.update((state) => {
        const repos = { ...state.repos };
        for (const repo of forget) delete repos[repo];
        return { value: { repos }, result: undefined };
      });
    }
  }

  /** Pauses every poller; the cursors stay for the next `sync`. */
  stop(): void {
    for (const repo of [...this.#pollers.keys()]) this.#remove(repo);
  }

  status(repo: string): RepoPollStatus | undefined {
    const status = this.#pollers.get(repo.toLowerCase())?.status;
    return status && { ...status };
  }

  get repos(): string[] {
    return [...this.#pollers.keys()];
  }

  /** Polls a repo now, in the queue, and resolves once its events were handed on. For tests and `hui bot trigger test`. */
  async pollNow(repo: string): Promise<void> {
    const poller = this.#pollers.get(repo.toLowerCase());
    if (!poller) return;
    if (poller.timer) clearTimeout(poller.timer);
    poller.timer = undefined;
    await this.#tick(poller);
  }

  #remove(repo: string): void {
    const poller = this.#pollers.get(repo);
    if (poller?.timer) clearTimeout(poller.timer);
    this.#pollers.delete(repo);
  }

  #schedule(poller: Poller, delayMs: number): void {
    if (this.#pollers.get(poller.repo) !== poller) return;
    if (poller.timer) clearTimeout(poller.timer);
    poller.status.nextAt = new Date(this.#now() + delayMs).toISOString();
    poller.timer = setTimeout(() => {
      poller.timer = undefined;
      void this.#tick(poller);
    }, Math.max(0, delayMs));
    poller.timer.unref?.();
  }

  async #operatorLogin(): Promise<string | undefined> {
    if (this.#login && this.#now() - this.#login.at < 3_600_000 && this.#login.value) return this.#login.value;
    try {
      const response = await this.#deps.gh("user");
      const login = response.status === 200 && isRecord(response.body) && typeof response.body["login"] === "string" ? response.body["login"] : undefined;
      this.#login = { value: login, at: this.#now() };
      return login;
    } catch {
      return this.#login?.value;
    }
  }

  async #tick(poller: Poller): Promise<void> {
    const run = this.#queue.then(() => this.#poll(poller));
    this.#queue = run.catch(() => undefined);
    await run.catch((error: unknown) => {
      this.#deps.report?.("warning", "trigger_poll_failed", `Polling ${poller.repo} for triggers failed`, error instanceof Error ? error.message : String(error));
    });
  }

  async #poll(poller: Poller): Promise<void> {
    if (this.#pollers.get(poller.repo) !== poller) return;
    let delay = this.#intervalMs;
    try {
      const saved = await this.#deps.cursors.read();
      const cursor = parseCursor(saved.repos[poller.repo]);
      const catchUp = !poller.polled && cursor !== undefined;
      const login = await this.#operatorLogin();
      const result = await pollRepo({ repo: poller.repo, cursor, wants: poller.wants, gh: this.#deps.gh, login, now: this.#now });
      poller.status.requests += result.stats.requests;
      poller.status.notModified += result.stats.notModified;
      if (result.rateRemaining !== undefined) poller.status.rateRemaining = result.rateRemaining;
      // Dropped meanwhile (no trigger watches it, or bots were turned off): nothing is saved or delivered.
      if (this.#pollers.get(poller.repo) !== poller) return;
      await this.#deps.cursors.update((state) => ({ value: { repos: { ...state.repos, [poller.repo]: result.cursor } }, result: undefined }));
      poller.status.polledAt = new Date(this.#now()).toISOString();
      if (result.error) {
        poller.failures += 1;
        poller.status.error = result.error.message;
        delay = result.retryAt !== undefined ? Math.max(delay, result.retryAt - this.#now())
          : result.error.status === 404 ? NOT_FOUND_RETRY_MS
            : Math.min(MAX_BACKOFF_MS, this.#intervalMs * 2 ** Math.min(poller.failures, 8));
      } else {
        poller.failures = 0;
        delete poller.status.error;
        poller.polled = true;
        if (result.retryAt !== undefined) delay = Math.max(delay, result.retryAt - this.#now());
      }
      if (result.pollInterval) delay = Math.max(delay, result.pollInterval * 1_000);
      if (result.events.length) await this.#deps.onEvents(catchUp ? result.events.map((each) => ({ ...each, catchUp: true as const })) : result.events);
    } catch (error) {
      poller.failures += 1;
      poller.status.error = error instanceof Error ? error.message : String(error);
      delay = Math.min(MAX_BACKOFF_MS, this.#intervalMs * 2 ** Math.min(poller.failures, 8));
      throw error;
    } finally {
      this.#schedule(poller, delay);
    }
  }
}
