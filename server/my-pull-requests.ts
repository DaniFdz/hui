/**
 * The operator's open pull requests for the Pull Requests page.
 *
 * Two `gh api graphql` searches with the Settings → Integrations → GitHub login:
 * pull requests the account authored and those awaiting its review. The lists
 * are cached in gateway memory stale-while-revalidate (nothing is persisted), so
 * only the very first load waits on the network; a failure keeps the last
 * confirmed lists and reports a coarse reason. Sessions are linked per request
 * from their transcripts and from the Git checkout their directory is on.
 */
import { realpath } from "node:fs/promises";

import type {
  MyPullRequest,
  MyPullRequestSession,
  MyPullRequests,
  MyPullRequestsError,
  PullRequestChecks,
  PullRequestReviewDecision,
} from "../shared/pull-requests.ts";
import { GitHubApiError } from "./github-previews.ts";
import { parseReviewComments, REVIEW_COMMENTS_FIELDS, type ReviewComment } from "./pull-request-comments.ts";
import { pullRequestUrls } from "./pull-requests.ts";
import type { CommandRunner } from "./worktree-inventory.ts";

export type FoundPullRequest = Omit<MyPullRequest, "sessions" | "newComments" | "localCheckout"> & {
  /** Created tab: review comments that can be sent (server-only, never returned). */
  reviewComments?: ReviewComment[];
};
export type PullRequestLists = { created: FoundPullRequest[]; reviewRequested: FoundPullRequest[] };
export type PullRequestSnapshot = Omit<MyPullRequests, "created" | "reviewRequested"> & PullRequestLists;

const SEARCH_LIMIT = 50;
export const CREATED_SEARCH = "is:pr is:open author:@me archived:false";
export const REVIEW_REQUESTED_SEARCH = "is:pr is:open review-requested:@me archived:false";
/** The Created search also selects the review comments needed for the new-comment count. */
export const searchQuery = (comments: boolean) => `query($q: String!) {
  search(query: $q, type: ISSUE, first: ${SEARCH_LIMIT}) {
    nodes {
      ... on PullRequest {
        number url title isDraft updatedAt headRefName baseRefName reviewDecision
        repository { nameWithOwner }
        headRepository { nameWithOwner }
        author { login }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }${comments ? REVIEW_COMMENTS_FIELDS : ""}
      }
    }
  }
}`;

const CHECKS = new Set<PullRequestChecks>(["success", "failure", "error", "pending", "expected"]);
const DECISIONS = new Set<PullRequestReviewDecision>(["approved", "changes_requested", "review_required"]);

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, limit = 300) => typeof value === "string" ? value.trim().slice(0, limit) : "";

/** Parses one `search` response; nodes that are not well-formed pull requests are dropped. */
export function parsePullRequestSearch(raw: unknown): FoundPullRequest[] {
  const nodes = record(record(record(raw)["data"])["search"])["nodes"];
  if (!Array.isArray(nodes)) throw new GitHubApiError("unavailable");
  return nodes.slice(0, SEARCH_LIMIT).flatMap((node): FoundPullRequest[] => {
    const data = record(node);
    const ref = pullRequestUrls(str(data["url"], 500))[0];
    if (!ref || ref.url !== data["url"] || ref.number !== data["number"]) return [];
    const headRepository = str(record(data["headRepository"])["nameWithOwner"], 200);
    const author = str(record(data["author"])["login"], 60);
    const decision = str(data["reviewDecision"], 40).toLowerCase() as PullRequestReviewDecision;
    const commits = record(data["commits"])["nodes"];
    const rollup = Array.isArray(commits) ? record(record(record(commits.at(-1))["commit"])["statusCheckRollup"])["state"] : undefined;
    const checks = str(rollup, 40).toLowerCase() as PullRequestChecks;
    // Created by the operator, so the author is the account whose own comments do not count.
    const reviewComments = "reviewThreads" in data || "reviews" in data ? parseReviewComments(data, author) : undefined;
    return [{
      ...ref,
      title: str(data["title"]),
      state: data["isDraft"] === true ? "draft" : "open",
      headRefName: str(data["headRefName"], 255),
      ...(headRepository ? { headRepository } : {}),
      baseRefName: str(data["baseRefName"], 255),
      ...(author ? { author } : {}),
      updatedAt: str(data["updatedAt"], 40),
      ...(DECISIONS.has(decision) ? { reviewDecision: decision } : {}),
      ...(CHECKS.has(checks) ? { checks } : {}),
      ...(reviewComments ? { reviewComments } : {}),
    }];
  });
}

/** Both lists, one `gh api graphql` call each. */
export async function fetchMyPullRequests(gh: (args: readonly string[]) => Promise<unknown>): Promise<PullRequestLists> {
  const search = async (q: string) => parsePullRequestSearch(await gh(["api", "graphql", "-f", `query=${searchQuery(q === CREATED_SEARCH)}`, "-f", `q=${q}`]));
  const [created, reviewRequested] = await Promise.all([search(CREATED_SEARCH), search(REVIEW_REQUESTED_SEARCH)]);
  return { created, reviewRequested };
}

/** `owner/repo` of every github.com remote in `git remote -v` output. */
export function parseGitHubRemotes(stdout: string): string[] {
  const found = new Set<string>();
  for (const line of stdout.split("\n")) {
    const url = line.split(/\s+/u)[1] ?? "";
    const match = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/u.exec(url);
    if (match) found.add(match[1]!);
  }
  return [...found];
}

/** The branch a directory's checkout is on and the GitHub repositories it pushes to. */
export type Checkout = { branch: string; repositories: readonly string[] };

/** Git facts for each session directory, keyed by the directory as given.
 * Directories are resolved through symlinks first, so aliases share one read. */
export async function readCheckouts(cwds: readonly string[], run: CommandRunner): Promise<Map<string, Checkout>> {
  const byCanonical = new Map<string, Promise<Checkout | undefined>>();
  const read = async (directory: string): Promise<Checkout | undefined> => {
    const [head, remotes] = await Promise.all([
      run("git", ["-C", directory, "symbolic-ref", "--quiet", "--short", "HEAD"]),
      run("git", ["-C", directory, "remote", "-v"]),
    ]);
    if (head.code !== 0 || remotes.code !== 0) return undefined;
    const repositories = parseGitHubRemotes(remotes.stdout);
    return repositories.length ? { branch: head.stdout.trim(), repositories } : undefined;
  };
  const output = new Map<string, Checkout>();
  // ponytail: two git calls per distinct session directory per GET; cache like the worktree facts if registries grow large.
  await Promise.all([...new Set(cwds.filter(Boolean))].map(async (cwd) => {
    const directory = await realpath(cwd).catch(() => undefined);
    if (!directory) return;
    let checkout = byCanonical.get(directory);
    if (!checkout) {
      checkout = read(directory);
      byCanonical.set(directory, checkout);
    }
    const value = await checkout;
    if (value) output.set(cwd, value);
  }));
  return output;
}

export type CorrelationSession = MyPullRequestSession & {
  cwd: string;
  updatedAt: string;
  /** Pull request URLs the session's transcript created. */
  createdPullRequests: readonly string[];
};

/** Sessions that created the pull request or sit on its head branch in a
 * checkout of its repository. Newest first; archived sessions last. */
type PullRequestPlace = Pick<FoundPullRequest, "repository" | "headRepository" | "headRefName">;

function ofRepository(pr: PullRequestPlace, checkout: Checkout | undefined): checkout is Checkout {
  const repositories = new Set([pr.repository, pr.headRepository].filter(Boolean).map((name) => name!.toLowerCase()));
  return Boolean(checkout?.repositories.some((name) => repositories.has(name.toLowerCase())));
}

const onHeadBranch = (pr: PullRequestPlace, checkout: Checkout) => Boolean(pr.headRefName) && checkout.branch === pr.headRefName;

export function correlateSessions(
  pr: PullRequestPlace & Pick<FoundPullRequest, "url">,
  sessions: readonly CorrelationSession[],
  checkouts: ReadonlyMap<string, Checkout>,
): MyPullRequestSession[] {
  const url = pr.url.toLowerCase();
  return sessions
    .filter((session) => {
      if (session.createdPullRequests.some((created) => created.toLowerCase() === url)) return true;
      const checkout = checkouts.get(session.cwd);
      return ofRepository(pr, checkout) && onHeadBranch(pr, checkout);
    })
    .toSorted((a, b) => Number(a.archived) - Number(b.archived) || b.updatedAt.localeCompare(a.updatedAt))
    .map(({ id, title, archived }) => ({ id, title, archived }));
}

/** Session directories that are checkouts of the pull request's repository,
 * those already on its head branch first. */
export function repositoryCheckouts(pr: PullRequestPlace, checkouts: ReadonlyMap<string, Checkout>): { cwd: string; onHeadBranch: boolean }[] {
  return [...checkouts]
    .filter(([, checkout]) => ofRepository(pr, checkout))
    .map(([cwd, checkout]) => ({ cwd, onHeadBranch: onHeadBranch(pr, checkout) }))
    .toSorted((a, b) => Number(b.onHeadBranch) - Number(a.onHeadBranch));
}

export type MyPullRequestsOptions = { now?: () => number; ttlMs?: number };

function failureReason(error: unknown): MyPullRequestsError {
  const reason = error instanceof GitHubApiError ? error.reason : "unavailable";
  return reason === "signed_out" || reason === "cli_missing" ? reason : "unavailable";
}

/** Stale-while-revalidate lists. Only the very first `view` waits for GitHub. */
export class MyPullRequestsCache {
  readonly #fetch: () => Promise<PullRequestLists>;
  readonly #now: () => number;
  readonly #ttl: number;
  #lists: PullRequestLists = { created: [], reviewRequested: [] };
  #fetchedAt?: string;
  #error?: MyPullRequestsError;
  #freshUntil = 0;
  #attempted = false;
  #running?: Promise<void>;

  constructor(fetch: () => Promise<PullRequestLists>, options: MyPullRequestsOptions = {}) {
    this.#fetch = fetch;
    this.#now = options.now ?? Date.now;
    this.#ttl = options.ttlMs ?? 60_000;
  }

  async view(): Promise<PullRequestSnapshot> {
    if (!this.#attempted) await this.#start();
    else if (!this.#running && this.#freshUntil <= this.#now()) void this.#start();
    return this.#snapshot();
  }

  /** Forces a fetch; a fetch already running counts. */
  async refresh(): Promise<PullRequestSnapshot> {
    await (this.#running ?? this.#start());
    return this.#snapshot();
  }

  #snapshot(): PullRequestSnapshot {
    return {
      ...this.#lists,
      ...(this.#fetchedAt ? { fetchedAt: this.#fetchedAt } : {}),
      pending: this.#running !== undefined,
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  #start(): Promise<void> {
    this.#attempted = true;
    this.#running = this.#fetch().then(
      (lists) => {
        this.#lists = lists;
        this.#fetchedAt = new Date(this.#now()).toISOString();
        this.#error = undefined;
      },
      (error: unknown) => {
        // Keep the last confirmed lists; never invent an empty state for a failure.
        this.#error = failureReason(error);
      },
    ).finally(() => {
      this.#freshUntil = this.#now() + this.#ttl;
      this.#running = undefined;
    });
    return this.#running;
  }
}
