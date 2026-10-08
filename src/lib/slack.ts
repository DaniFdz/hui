/**
 * Browser half of the Slack connection (HUI-18, Slack triggers): it moves credential-free views from the gateway and
 * the operator's pasted token to it, once; the gateway verifies the token with Slack and keeps it. `/__hui/slack`
 * is the contract (docs/api.md#slack).
 */
import { SLACK_CONNECTION_STATUSES, type SlackConnection, type SlackConnectionStatus } from "../../shared/slack.ts";
import { fetchJson } from "./settings-store.ts";

const SLACK_URL = "/__hui/slack";
const JSON_HEADERS = { "content-type": "application/json" } as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** A route's answer, narrowed: anything it doesn't know stays out. */
export function parseSlackConnection(raw: unknown): SlackConnection {
  if (!isRecord(raw)) throw new Error("The Slack connection did not come back.");
  const status = SLACK_CONNECTION_STATUSES.find((candidate) => candidate === raw["status"]) ?? "not_connected";
  const watch = isRecord(raw["watch"]) ? raw["watch"] : {};
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined);
  const scopes = list(raw["scopes"]);
  const missing = list(raw["missingScopes"]);
  return {
    configured: raw["configured"] === true,
    status,
    message: str(raw["message"]) || (status === "not_connected" ? "Not connected." : ""),
    ...(str(raw["user"]) ? { user: str(raw["user"]) } : {}),
    ...(str(raw["userId"]) ? { userId: str(raw["userId"]) } : {}),
    ...(str(raw["team"]) ? { team: str(raw["team"]) } : {}),
    ...(str(raw["teamId"]) ? { teamId: str(raw["teamId"]) } : {}),
    ...(str(raw["url"]) ? { url: str(raw["url"]) } : {}),
    ...(scopes ? { scopes } : {}),
    ...(missing?.length ? { missingScopes: missing } : {}),
    ...(str(raw["checkedAt"]) ? { checkedAt: str(raw["checkedAt"]) } : {}),
    watch: {
      active: watch["active"] === true,
      ...(str(watch["polledAt"]) ? { polledAt: str(watch["polledAt"]) } : {}),
      ...(str(watch["error"]) ? { error: str(watch["error"]) } : {}),
    },
  };
}

/** `verify` asks Slack again when its last answer is more than ten minutes old. */
export async function loadSlackConnection(verify = false): Promise<SlackConnection> {
  return parseSlackConnection(await fetchJson<unknown>(`${SLACK_URL}${verify ? "?verify=1" : ""}`, { signal: AbortSignal.timeout(20_000) }));
}

export async function connectSlack(token: string): Promise<SlackConnection> {
  return parseSlackConnection(await fetchJson<unknown>(SLACK_URL, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ token }), signal: AbortSignal.timeout(20_000) }));
}

export async function disconnectSlack(): Promise<SlackConnection> {
  return parseSlackConnection(await fetchJson<unknown>(SLACK_URL, { method: "DELETE" }));
}

const LABELS: Readonly<Record<SlackConnectionStatus, { kind: "ok" | "warn" | "danger" | "muted"; label: string }>> = {
  connected: { kind: "ok", label: "Connected" },
  missing_scopes: { kind: "warn", label: "Missing scopes" },
  unverified: { kind: "warn", label: "Could not verify" },
  revoked: { kind: "danger", label: "Token revoked or expired" },
  not_connected: { kind: "muted", label: "Not connected" },
};

/** The status pill: what the connection is, in two or three words. */
export function slackStatusLabel(connection: SlackConnection | undefined): { kind: "ok" | "warn" | "danger" | "muted"; label: string } {
  return connection ? LABELS[connection.status] : { kind: "muted", label: "Checking…" };
}

/** `acme.slack.com` from a workspace URL. */
export function slackHost(url: string | undefined): string {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
}
