/**
 * Triggers (HUI-18): what wakes a bot when something happens elsewhere, beside its routines, which wake it on a
 * schedule. A trigger watches one source (pull requests on GitHub, the sessions the bot started, a webhook URL, Slack
 * messages that ping the operator, or what a listener the operator runs reports), and when an event matches its filter
 * HUI delivers
 * `[trigger: <name> · <summary>] <prompt>` plus the event's details into the bot's chat, as a routine's message is (a
 * follow-up while the bot works). Shared by the gateway, the `hui bot trigger` CLI and the browser;
 * docs/api.md#triggers is the contract.
 */

export const BOT_TRIGGER_SOURCES = ["github", "session", "webhook", "slack", "listener"] as const;
export type BotTriggerSource = (typeof BOT_TRIGGER_SOURCES)[number];
export const BOT_TRIGGER_SOURCE_LABELS: Readonly<Record<BotTriggerSource, string>> = { github: "GitHub", session: "Sessions", webhook: "Webhook", slack: "Slack", listener: "Listener" };

/** Sources whose triggers have a URL with a secret token: `POST /__hui/hooks/<token>`. */
export const HOOK_TRIGGER_SOURCES: ReadonlySet<BotTriggerSource> = new Set(["webhook", "listener"]);

/** What a GitHub trigger can wake on, all about pull requests in the repos it names. */
export const GITHUB_TRIGGER_EVENTS = [
  "pr_opened", "pr_pushed", "checks_failed", "checks_succeeded", "review_approved", "review_changes_requested", "review_commented",
  "comment", "mention", "pr_merged", "pr_closed",
] as const;
export type GitHubTriggerEvent = (typeof GITHUB_TRIGGER_EVENTS)[number];
export const GITHUB_TRIGGER_EVENT_LABELS: Readonly<Record<GitHubTriggerEvent, string>> = {
  pr_opened: "PR opened",
  pr_pushed: "Pushed",
  checks_failed: "Checks failed",
  checks_succeeded: "Checks passed",
  review_approved: "Approved",
  review_changes_requested: "Changes requested",
  review_commented: "Review comment",
  comment: "Comment",
  mention: "Mentions you",
  pr_merged: "Merged",
  pr_closed: "Closed",
};

/** What a session trigger wakes on, for the sessions the bot itself started. */
export const SESSION_TRIGGER_EVENTS = ["finished", "failed", "waiting"] as const;
export type SessionTriggerEvent = (typeof SESSION_TRIGGER_EVENTS)[number];
export const SESSION_TRIGGER_EVENT_LABELS: Readonly<Record<SessionTriggerEvent, string>> = {
  finished: "Finished",
  failed: "Failed",
  waiting: "Waiting for an answer",
};

/** What a Slack trigger wakes on, as the operator: a message in a channel or a group DM that @-mentions them, or a
 * direct message to them. */
export const SLACK_TRIGGER_EVENTS = ["mention", "dm"] as const;
export type SlackTriggerEvent = (typeof SLACK_TRIGGER_EVENTS)[number];
export const SLACK_TRIGGER_EVENT_LABELS: Readonly<Record<SlackTriggerEvent, string>> = {
  mention: "Mentions you",
  dm: "Direct messages",
};

/** Limits the gateway enforces; the CLI and the browser mirror them. */
export const BOT_TRIGGER_LIMITS = {
  /** A trigger's name: one line, without `[`, `]` or `·`, which mark its deliveries. */
  name: 60,
  prompt: 4_000,
  /** Triggers one bot may have, the operator's and its own together. */
  perBot: 20,
  /** Deliveries one bot takes from all its triggers in an hour; what comes after waits for a free slot. */
  perHour: 12,
  repos: 10,
  /** Authors, labels, base branches or PR numbers one filter names. */
  values: 20,
  value: 100,
  cooldownDefault: 300,
  cooldownMax: 86_400,
  /** A webhook call's or a listener's report's body, in bytes. */
  body: 64 * 1024,
  /** One event's details in a delivery, in characters. */
  details: 1_500,
  /** A delivery's whole text, in characters. */
  message: 12_000,
  /** Events one delivery lists; the rest are counted. */
  listed: 20,
  /** Events that wait for a trigger's cooldown (or the hourly cap); the rest are counted. */
  pending: 50,
  /** Runs kept per trigger. */
  runs: 20,
  /** A webhook filter's field path and value. */
  field: 200,
  match: 500,
  /** A Slack message's text in a delivery, and the thread parent's, in characters. */
  slackText: 2_000,
  /** One Slack or listener event's details (for Slack: who, where, the message and its thread parent), in characters. */
  slackDetails: 5_000,
  /** A Slack or listener delivery's whole text: it carries the pull requests its events link to, diffs included. */
  slackMessage: 40_000,
  /** Pull request links read from one Slack message or listener event. */
  slackLinks: 3,
  /** Events one listener report holds. */
  listenerEvents: 50,
  /** Event ids remembered per listener trigger, so a report sent again never wakes the bot twice. */
  listenerSeen: 500,
  /** A linked pull request's description in a delivery, in characters. */
  prDescription: 2_000,
  /** A linked pull request's changed files listed in a delivery; the rest are counted. */
  prFiles: 60,
  /** The diffs of one delivery together, in characters, shared evenly by its pull requests. */
  prDiffs: 24_000,
  /** Pull requests one delivery reads; past that, the rest are named, not read. */
  prsPerDelivery: 6,
} as const;

/** The first characters of every delivery: `[trigger: <name> · <summary>] <prompt>`. */
export const BOT_TRIGGER_MARKER = "[trigger: ";

/** The route a webhook trigger answers on: `POST /__hui/hooks/<token>` on the gateway. */
export const BOT_TRIGGER_HOOK_PREFIX = "/__hui/hooks/";

/** Why a trigger did not fire while bots are off (Settings → Labs → Bots). */
export const BOTS_OFF_TRIGGER_REASON = "Skipped because bots are off: turn them on in Settings → Labs → Bots.";

export type GitHubTriggerFilter = {
  /** `owner/name`, 1–10. */
  repos: string[];
  events: GitHubTriggerEvent[];
  /** Only pull requests opened by one of these logins (any case). */
  authors?: string[];
  /** Only pull requests carrying one of these labels (any case). */
  labels?: string[];
  /** Only pull requests into one of these base branches. */
  base?: string[];
  /** Only these pull requests. */
  pullRequests?: number[];
  /** true: only drafts; false: only pull requests ready for review; absent: both. */
  draft?: boolean;
};

export type SessionTriggerFilter = { events: SessionTriggerEvent[] };

/** A webhook call's body passes when the JSON value at `field` (a dot path: `pull_request.state`) equals `value`, or
 * contains it (text: a substring; a list: an element equal to it). `field: ""` is the whole body, which is how a
 * text body is matched. */
export type WebhookTriggerMatch = { field: string; op: "equals" | "contains"; value: string };
export type WebhookTriggerFilter = { match?: WebhookTriggerMatch };

/** A listener's event passes when `match` holds for it, as a webhook's does for a body (`fields.channel`, `summary`,
 * `""` for the whole event) and, for each switch given, satisfies it. */
export type ListenerTriggerFilter = {
  match?: WebhookTriggerMatch;
  /** Only events that link a GitHub pull request. */
  prLinks?: true;
  /** Also events the listener marks as from a bot or an app; left out otherwise. */
  bots?: true;
  /** Also events the listener marks as from outside the operator's organization; left out otherwise. */
  external?: true;
};

/** A Slack message passes when it is one of `events` and, for each optional key given, satisfies it. */
export type SlackTriggerFilter = {
  events: SlackTriggerEvent[];
  /** Only messages with a link to a GitHub pull request; a thread reply without one counts its thread parent's. */
  prLinks?: true;
  /** Only messages from these people: a member id (`U…`, `W…`), or a handle, display or real name (any case, no `@`). */
  from?: string[];
  /** Only mentions in these conversations: a channel id (`C…`, `G…`) or name (no `#`). DMs aren't channels. */
  in?: string[];
  /** Also people outside the operator's workspace (Slack Connect); left out otherwise. */
  external?: true;
  /** Also bots and apps; left out otherwise. */
  bots?: true;
};

export type BotTriggerFilters = { github: GitHubTriggerFilter; session: SessionTriggerFilter; webhook: WebhookTriggerFilter; slack: SlackTriggerFilter; listener: ListenerTriggerFilter };
/** A trigger's source and its filter, which always go together. */
export type BotTriggerSpec = { [S in BotTriggerSource]: { source: S; filter: BotTriggerFilters[S] } }[BotTriggerSource];

type BotTriggerBase = {
  id: string;
  botId: string;
  name: string;
  /** What the bot is asked to do, after the marker; absent: only the event. */
  prompt?: string;
  enabled: boolean;
  /** Events within this many seconds of the last delivery wait and arrive together, as one delivery. */
  cooldownSeconds: number;
  /** The operator (the Bots tab, `hui bot trigger add`, the API) or the bot itself (its `triggers` tool). */
  createdBy: "operator" | "bot";
  createdAt: string;
  updatedAt: string;
  lastFiredAt?: string;
};

/** One trigger as `bot-triggers.json` stores it; a webhook or listener trigger keeps only its token's SHA-256 and first
 * characters. */
export type BotTriggerRecord = BotTriggerBase & BotTriggerSpec & { tokenHash?: string; tokenHint?: string };

/** One trigger as the routes return it. */
export type BotTrigger = BotTriggerBase & BotTriggerSpec & {
  /** A webhook or listener trigger's token, its first four characters: enough to tell two URLs apart, never to call one. */
  tokenHint?: string;
  /** Events waiting for the cooldown or the hourly cap, and when they go out at the earliest. */
  pending?: { events: number; until: string };
  /** A GitHub or Slack trigger: its source's polling, the newest poll and the latest problem. A listener trigger: the
   * listener's latest report and its problem, or how long it has been silent. */
  watch?: { polledAt?: string; error?: string };
};

export type BotTriggerRunStatus = "fired" | "coalesced" | "skipped" | "failed";

/** What one firing did: `fired` delivered one event, `coalesced` delivered several as one, `skipped` delivered
 * nothing (bots off, the bot archived), `failed` could not deliver. */
export type BotTriggerRun = {
  id: string;
  triggerId: string;
  triggerName: string;
  at: string;
  status: BotTriggerRunStatus;
  /** Events the run covers. */
  events: number;
  /** One line. */
  summary: string;
  reason?: string;
  /** `POST …/test` or `hui bot trigger test`: a sample event, outside the cooldown and the cap. */
  test?: true;
  /** What happened while HUI was not watching (the gateway down, bots off), delivered as one summary. */
  catchUp?: true;
};

/** `GET /__hui/bots/:id/triggers`. */
export type BotTriggersList = {
  triggers: BotTrigger[];
  /** Newest first. */
  runs: BotTriggerRun[];
  deliveries: { lastHour: number; perHour: number };
};

/** `POST /__hui/bots/:id/triggers` (201) and `POST …/:trigger/token`: a webhook or listener trigger's token, shown
 * this once. */
export type BotTriggerCreated = { trigger: BotTrigger; hook?: { token: string; path: string } };

/** `POST /__hui/bots/:id/triggers`. Without `cooldownSeconds` it is 300; without `enabled`, on. */
export type BotTriggerInput = { name: string; prompt?: string; enabled?: boolean; cooldownSeconds?: number } & BotTriggerSpec;

/** `PATCH /__hui/bots/:id/triggers/:trigger`: only what changes. `filter` keys replace those of the filter (an empty
 * list or `null` clears an optional one); the source never changes. `prompt: ""` clears the prompt. */
export type BotTriggerPatch = {
  name?: string;
  prompt?: string;
  enabled?: boolean;
  cooldownSeconds?: number;
  filter?: Record<string, unknown>;
};

const listed = (items: readonly string[], max = 3) => (items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} +${items.length - max}`);

/** `5 min`, `1 h 30 min`, `45 s`, `none`. */
export function cooldownLabel(seconds: number): string {
  if (seconds <= 0) return "none";
  if (seconds < 60) return `${seconds} s`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return [hours ? `${hours} h` : "", minutes ? `${minutes} min` : "", rest && !hours ? `${rest} s` : ""].filter(Boolean).join(" ");
}

/** A Slack member or conversation as a filter names it: an id as it is, a name with its `@` or `#`. */
const slackRef = (value: string, mark: "@" | "#") => (/^[CDGUW][A-Z0-9]{2,}$/u.test(value) ? value : `${mark}${value}`);

/** One line for what a trigger watches: `DaniFdz/hui · PR opened, Checks failed · by dependabot · into main`. */
export function botTriggerFilterSummary(trigger: BotTriggerSpec): string {
  switch (trigger.source) {
    case "github": {
      const filter = trigger.filter;
      return [
        listed(filter.repos, 2),
        listed(filter.events.map((event) => GITHUB_TRIGGER_EVENT_LABELS[event])),
        ...(filter.authors?.length ? [`by ${listed(filter.authors)}`] : []),
        ...(filter.labels?.length ? [`label ${listed(filter.labels)}`] : []),
        ...(filter.base?.length ? [`into ${listed(filter.base)}`] : []),
        ...(filter.pullRequests?.length ? [listed(filter.pullRequests.map((number) => `#${number}`))] : []),
        ...(filter.draft === true ? ["drafts only"] : filter.draft === false ? ["ready PRs only"] : []),
      ].join(" · ");
    }
    case "session":
      return `Sessions it starts · ${trigger.filter.events.map((event) => SESSION_TRIGGER_EVENT_LABELS[event]).join(", ")}`;
    case "webhook": {
      const match = trigger.filter.match;
      if (!match) return "Any call";
      return `${match.field || "body"} ${match.op} "${match.value}"`;
    }
    case "listener": {
      const filter = trigger.filter;
      return [
        filter.match ? `${filter.match.field || "event"} ${filter.match.op} "${filter.match.value}"` : "Any event",
        ...(filter.prLinks ? ["PR links only"] : []),
        ...(filter.external ? ["outsiders too"] : []),
        ...(filter.bots ? ["bots too"] : []),
      ].join(" · ");
    }
    case "slack": {
      const filter = trigger.filter;
      return [
        filter.events.map((event) => SLACK_TRIGGER_EVENT_LABELS[event]).join(", "),
        ...(filter.prLinks ? ["PR links only"] : []),
        ...(filter.from?.length ? [`from ${listed(filter.from.map((person) => slackRef(person, "@")))}`] : []),
        ...(filter.in?.length ? [`in ${listed(filter.in.map((channel) => slackRef(channel, "#")))}`] : []),
        ...(filter.external ? ["Slack Connect too"] : []),
        ...(filter.bots ? ["bots too"] : []),
      ].join(" · ");
    }
  }
}
