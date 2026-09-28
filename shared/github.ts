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
