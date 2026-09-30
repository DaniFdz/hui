/** Credential-free view of the GitHub CLI login HUI relies on. HUI never reads,
 * stores or forwards the token: `gh` keeps it in its own keyring or config. */
export type GitHubAccount = {
  host: string;
  login: string;
  /** OAuth scopes reported by `gh auth status`; empty when unknown. */
  scopes: string[];
  /** Where `gh` found the token, e.g. `keyring`, `GH_TOKEN` or a hosts.yml path. */
  tokenSource?: string;
};

/** The device-flow login the gateway runs through `gh auth login --web`. */
export type GitHubLoginState =
  | { phase: "idle" }
  | { phase: "starting" }
  | {
    phase: "pending";
    /** One-time code the operator types at `verificationUri`. */
    userCode: string;
    verificationUri: string;
    /** Epoch milliseconds after which HUI stops waiting for approval. */
    expiresAt: number;
  }
  | { phase: "failed"; message: string };

export type GitHubConnection = {
  cli: { installed: false } | { installed: true; version: string };
  /** `unknown`: an account exists but GitHub could not verify it right now. */
  status: "connected" | "disconnected" | "invalid" | "unknown";
  account?: GitHubAccount;
  /** Why the status is `invalid` or `unknown`. */
  message?: string;
  login: GitHubLoginState;
};

export const GITHUB_CLI_URL = "https://cli.github.com";
export const GITHUB_CLI_REQUIRED = "GitHub CLI (gh) is required. Install it on the machine that runs HUI and make sure `gh` is on the gateway's PATH.";

/** One `gh` account's GitHub activity over the requested year, as ISO timestamps. */
export type GitHubContributionAccount = {
  login: string;
  /** When the GitHub account was created; the page offers its years. */
  createdAt?: string;
  /** Author dates of the commits GitHub search indexes (default branches). */
  commits: string[];
  /** Creation times of the pull requests the account opened. */
  pullRequests: string[];
  /** Why this account's activity could not be read; its lists are then empty. */
  error?: string;
};

/** One year of every github.com account `gh` is signed in to. */
export type GitHubContributions = { accounts: GitHubContributionAccount[] };
