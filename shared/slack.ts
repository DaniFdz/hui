/**
 * The Slack connection (HUI-18, Slack triggers): what Settings → Integrations → Slack and `hui slack` show, the user
 * token scopes HUI asks for and the app manifest the operator creates their own Slack app from. The gateway keeps one
 * user token per gateway (`server/slack.ts`) and never returns it; docs/api.md#slack is the contract.
 */

/** `not_connected`: no token; `connected`: Slack accepted it at the last check; `revoked`: Slack refused it (revoked,
 * expired, or the app was removed); `missing_scopes`: accepted, but without a scope Slack triggers need; `unverified`:
 * Slack could not be reached at the last check. */
export const SLACK_CONNECTION_STATUSES = ["not_connected", "connected", "revoked", "missing_scopes", "unverified"] as const;
export type SlackConnectionStatus = (typeof SLACK_CONNECTION_STATUSES)[number];

/** Credential-free view of the gateway's Slack connection. The token never leaves the server. */
export type SlackConnection = {
  configured: boolean;
  status: SlackConnectionStatus;
  /** One plain line: "Connected as maria in Acme.", "Token revoked or expired: connect again." */
  message: string;
  /** Who the token acts as (auth.test's `user`, `user_id`) and in which workspace (`team`, `team_id`, `url`). */
  user?: string;
  userId?: string;
  team?: string;
  teamId?: string;
  url?: string;
  /** The token's scopes, when Slack reported them, and those of `SLACK_USER_SCOPES` it lacks. */
  scopes?: string[];
  missingScopes?: string[];
  /** When Slack last answered for this token. */
  checkedAt?: string;
  /** Slack triggers' reading: whether it runs (an enabled Slack trigger, bots on), the newest read and its problem. */
  watch: { active: boolean; polledAt?: string; error?: string };
};

/** The message the status line shows for a revoked or expired token. */
export const SLACK_REVOKED_MESSAGE = "Token revoked or expired: connect again.";

/** The user token scopes HUI asks for, every one read-only, and why. No scope lets HUI post, react or edit. */
export const SLACK_USER_SCOPES = [
  { scope: "search:read", why: "Find the messages that mention you and the direct messages sent to you (search.messages)." },
  { scope: "users:read", why: "Name who asked, and tell bots, apps and people outside your workspace apart (users.info)." },
  { scope: "channels:history", why: "Read the message a thread reply answers, in public channels (conversations.replies)." },
  { scope: "groups:history", why: "The same in private channels." },
  { scope: "im:history", why: "The same in direct messages." },
  { scope: "mpim:history", why: "The same in group direct messages." },
] as const;

export const SLACK_SCOPE_NAMES: readonly string[] = SLACK_USER_SCOPES.map((entry) => entry.scope);

/** Where the operator creates their Slack app (Create New App → From a manifest). */
export const SLACK_APPS_URL = "https://api.slack.com/apps";

/**
 * The app the operator creates in their own workspace: user token scopes only, no bot user, no events, no Socket
 * Mode, token rotation off (a rotating token expires within a day and HUI doesn't refresh it). Installed, it gives a
 * User OAuth Token (`xoxp-…`) that acts as the operator, read-only.
 */
export const SLACK_APP_MANIFEST = {
  _metadata: { major_version: 2, minor_version: 1 },
  display_information: {
    name: "HUI pings",
    description: "Lets your own HUI gateway read the Slack messages that mention you or are sent to you. Read-only.",
    background_color: "#1f2328",
  },
  settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
  oauth_config: { scopes: { user: [...SLACK_SCOPE_NAMES] } },
} as const;

/** The manifest as the Slack app dialog's JSON tab takes it. */
export function slackManifestJson(): string {
  return `${JSON.stringify(SLACK_APP_MANIFEST, null, 2)}\n`;
}

/** A User OAuth Token as Slack issues it: `xoxp-…`, or `xoxe.xoxp-…` from an app with token rotation. */
export const SLACK_USER_TOKEN = /^(?:xoxe\.)?xoxp-[A-Za-z0-9-]{10,}$/u;
