/** Types of the fake GitHub REST API behind a fake `gh` (github-triggers-fixture.mjs), for triggers' tests. */
export type FakeGitHubState = {
  login?: string;
  pollInterval?: number;
  rateLimited?: { retryAfter?: number };
  repos: Record<string, {
    pulls?: Record<string, unknown>[];
    reviews?: Record<string, Record<string, unknown>[]>;
    issueComments?: Record<string, unknown>[];
    reviewComments?: Record<string, unknown>[];
    checkRuns?: Record<string, Record<string, unknown>[]>;
    statuses?: Record<string, Record<string, unknown>[]>;
    /** A pull request's changed files, and its diff as `Accept: application/vnd.github.diff` answers it. */
    files?: Record<string, Record<string, unknown>[]>;
    diffs?: Record<string, string>;
  }>;
};

export type FakeGitHub = {
  state: FakeGitHubState;
  log: { path: string; etag: string | null; status: number; accept?: string }[];
  respond(path: string, etag?: string, accept?: string): { status: number; headers: Record<string, string>; body: unknown; text?: true };
};

export function createGitHubFake(state: FakeGitHubState): FakeGitHub;
