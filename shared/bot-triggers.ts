/**
 * Triggers (HUI-18): what wakes a bot when something happens elsewhere, beside its routines, which wake it on a
 * schedule. Every trigger is a listener's: a program the operator runs outside HUI watches something (a Slack, a Jira
 * board, a repo) and reports what it found to the trigger's URL; when an event matches the trigger's filter, HUI
 * delivers `[trigger: <name> · <summary>] <prompt>` plus the event's details into the bot's chat, as a routine's message
 * is (a follow-up while the bot works). Shared by the gateway, the `hui bot trigger` CLI and the browser;
 * docs/api.md#triggers is the contract.
 */

/** The one source: kept in records and routes so a record of a source HUI no longer has is told apart (`hui doctor`). */
export const BOT_TRIGGER_SOURCES = ["listener"] as const;
export type BotTriggerSource = (typeof BOT_TRIGGER_SOURCES)[number];
export const BOT_TRIGGER_SOURCE_LABELS: Readonly<Record<BotTriggerSource, string>> = { listener: "Listener" };

/** Limits the gateway enforces; the CLI and the browser mirror them. */
export const BOT_TRIGGER_LIMITS = {
  /** A trigger's name: one line, without `[`, `]` or `·`, which mark its deliveries. */
  name: 60,
  prompt: 4_000,
  /** Triggers one bot may have. */
  perBot: 20,
  /** Deliveries one bot takes from all its triggers in an hour; what comes after waits for a free slot. */
  perHour: 12,
  /** Links or fields one event carries, and values one field's list holds. */
  values: 20,
  cooldownDefault: 300,
  cooldownMax: 86_400,
  /** A listener's report's body, in bytes. */
  body: 64 * 1024,
  /** Events one report holds. */
  events: 50,
  /** Event ids remembered per trigger, so a report sent again never wakes the bot twice. */
  seen: 500,
  /** One event's details in a delivery, in characters. */
  details: 5_000,
  /** A delivery's whole text, in characters: it carries the pull requests its events link to, diffs included. */
  message: 40_000,
  /** Events one delivery lists; the rest are counted. */
  listed: 20,
  /** Events that wait for a trigger's cooldown (or the hourly cap); the rest are counted. */
  pending: 50,
  /** Runs kept per trigger. */
  runs: 20,
  /** A filter's field path and value. */
  field: 200,
  match: 500,
  /** Pull request links read from one event. */
  links: 3,
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

/** The route a trigger's listener reports to: `POST /__hui/hooks/<token>` on the gateway. */
export const BOT_TRIGGER_HOOK_PREFIX = "/__hui/hooks/";

/** Why a trigger did not fire while bots are off (Settings → Labs → Bots). */
export const BOTS_OFF_TRIGGER_REASON = "Skipped because bots are off: turn them on in Settings → Labs → Bots.";

/** An event passes when what is at `field` (a dot path into the event: `fields.channel`, `summary`; `""` the whole
 * event) equals `value`, or contains it (text: a substring; a list: an element equal to it). */
export type TriggerMatch = { field: string; op: "equals" | "contains"; value: string };

/** An event passes when `match` holds for it and, for each switch given, satisfies it. */
export type BotTriggerFilter = {
  match?: TriggerMatch;
  /** Only events that link a GitHub pull request. */
  prLinks?: true;
  /** Also events the listener marks as from a bot or an app; left out otherwise. */
  bots?: true;
  /** Also events the listener marks as from outside the operator's organization; left out otherwise. */
  external?: true;
};

type BotTriggerBase = {
  id: string;
  botId: string;
  name: string;
  source: BotTriggerSource;
  filter: BotTriggerFilter;
  /** What the bot is asked to do, after the marker; absent: only the event. */
  prompt?: string;
  enabled: boolean;
  /** Events within this many seconds of the last delivery wait and arrive together, as one delivery. */
  cooldownSeconds: number;
  /** The operator; `bot` is kept for triggers a bot added when bots still could. */
  createdBy: "operator" | "bot";
  createdAt: string;
  updatedAt: string;
  lastFiredAt?: string;
  /** Its token's first four characters: enough to tell two URLs apart, never to call one. */
  tokenHint?: string;
};

/** One trigger as `bot-triggers.json` stores it: its URL's token only as its SHA-256. */
export type BotTriggerRecord = BotTriggerBase & { tokenHash: string };

/** One trigger as the routes return it. */
export type BotTrigger = BotTriggerBase & {
  /** Events waiting for the cooldown or the hourly cap, and when they go out at the earliest. */
  pending?: { events: number; until: string };
  /** Its listener's latest report and the problem it reported, or how long it has been silent. */
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
  /** What the listener caught up on, delivered as one summary. */
  catchUp?: true;
};

/** `GET /__hui/bots/:id/triggers`. */
export type BotTriggersList = {
  triggers: BotTrigger[];
  /** Newest first. */
  runs: BotTriggerRun[];
  deliveries: { lastHour: number; perHour: number };
};

/** `POST /__hui/bots/:id/triggers` (201) and `POST …/:trigger/token`: the trigger's URL token, shown this once. */
export type BotTriggerCreated = { trigger: BotTrigger; hook: { token: string; path: string } };

/** `POST /__hui/bots/:id/triggers`. Without `cooldownSeconds` it is 300; without `enabled`, on. */
export type BotTriggerInput = { name: string; source: BotTriggerSource; filter: BotTriggerFilter; prompt?: string; enabled?: boolean; cooldownSeconds?: number };

/** `PATCH /__hui/bots/:id/triggers/:trigger`: only what changes. `filter` keys replace those of the filter (`null`
 * or `false` clears an optional one). `prompt: ""` clears the prompt. */
export type BotTriggerPatch = {
  name?: string;
  prompt?: string;
  enabled?: boolean;
  cooldownSeconds?: number;
  filter?: Record<string, unknown>;
};

/** `5 min`, `1 h 30 min`, `45 s`, `none`. */
export function cooldownLabel(seconds: number): string {
  if (seconds <= 0) return "none";
  if (seconds < 60) return `${seconds} s`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return [hours ? `${hours} h` : "", minutes ? `${minutes} min` : "", rest && !hours ? `${rest} s` : ""].filter(Boolean).join(" ");
}

/** One line for what a trigger lets through: `fields.channel equals "C0123" · PR links only`. */
export function botTriggerFilterSummary(trigger: Pick<BotTriggerBase, "filter">): string {
  const filter = trigger.filter;
  return [
    filter.match ? `${filter.match.field || "event"} ${filter.match.op} "${filter.match.value}"` : "Any event",
    ...(filter.prLinks ? ["PR links only"] : []),
    ...(filter.external ? ["outsiders too"] : []),
    ...(filter.bots ? ["bots too"] : []),
  ].join(" · ");
}
