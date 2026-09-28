/** Browser half of the GitHub integration. `gh` on the gateway owns the
 * credential; this module only moves credential-free status and login state. */
import type { GitHubConnection } from "../../shared/github.ts";
import { fetchJson } from "./settings-store.ts";

const GITHUB_URL = "/__hui/github";

export function loadGitHubConnection(): Promise<GitHubConnection> {
  return fetchJson<GitHubConnection>(GITHUB_URL, { signal: AbortSignal.timeout(25_000) });
}

/** Starts `gh auth login --web` and resolves with the one-time code once gh prints it. */
export function startGitHubLogin(): Promise<GitHubConnection> {
  return fetchJson<GitHubConnection>(`${GITHUB_URL}/login`, { method: "POST", signal: AbortSignal.timeout(45_000) });
}

export function cancelGitHubLogin(): Promise<GitHubConnection> {
  return fetchJson<GitHubConnection>(`${GITHUB_URL}/login`, { method: "DELETE", signal: AbortSignal.timeout(25_000) });
}

/** Status line shown under the GitHub heading. */
export function gitHubStatusLabel(connection: GitHubConnection | undefined): { kind: "ok" | "warn" | "danger" | "accent" | "muted"; label: string } {
  if (!connection) return { kind: "muted", label: "Checking…" };
  if (!connection.cli.installed) return { kind: "danger", label: "GitHub CLI required" };
  if (connection.login.phase === "starting") return { kind: "accent", label: "Requesting code…" };
  if (connection.login.phase === "pending") return { kind: "accent", label: "Waiting for approval…" };
  if (connection.status === "connected") return { kind: "ok", label: "Connected" };
  if (connection.status === "invalid") return { kind: "danger", label: "Sign-in required" };
  if (connection.status === "unknown") return { kind: "warn", label: "Could not verify" };
  return { kind: "muted", label: "Not connected" };
}
