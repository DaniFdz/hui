/**
 * Slack triggers' source (HUI-18): one poller per gateway that reads, as the operator and through the user token of
 * Settings → Integrations → Slack (`slack.ts`), the messages that ping them: a message in a channel or group DM that
 * @-mentions them, and a direct message to them.
 *
 * search.messages, polled about every minute, not Socket Mode (SPEC.md, "Slack triggers wake bots on review pings"):
 * only matches travel, one read-only token does it, and the first poll after a gap (the gateway stopped, bots off, a
 * laptop asleep) reads what was missed, a day back at most, which reaches each trigger as one catch-up. A poll asks
 * `<@me> after:<day>` for mentions and `is:dm after:<day>` for direct messages, newest first, page by page until a
 * page reaches what the previous poll already covered; it asks only what enabled triggers want.
 *
 * Never twice, never an edit: the cursor keeps when the previous poll started (`checkedTo`) and the messages seen
 * since shortly before it, and is saved before any event goes out. A message counts once, and only when it is newer
 * than the previous poll less an allowance for search indexing; an older one showing up later (an edit that adds the
 * mention or the link, or one indexed later than the allowance) never fires, and a deleted one is gone from search.
 * The first poll only records where it stands: a silent baseline, so watching starts from now.
 *
 * Each event says who asked (their display name), where, the message and the thread parent it replies to (bounded),
 * its permalink and the GitHub pull requests it links to, or its thread parent does; the pull requests themselves are
 * read when the delivery goes out (`bot-triggers-slack-prs.ts`). The operator's own messages are never events; bots,
 * apps and people outside the workspace (Slack Connect) are marked, and only triggers that allow them take them.
 */
import { BOT_TRIGGER_LIMITS, type SlackTriggerEvent } from "../shared/bot-triggers.ts";
import { parseGitHubUrl } from "../shared/github-links.ts";
import { InFlight, type JsonStateFile } from "./bot-triggers-store.ts";
import { isSlackAuthError, SlackApiError, type SlackClient, type SlackConfig, type SlackConnector, type SlackIdentity } from "./slack.ts";

/** How often Slack is read, unless it asks for longer (Retry-After). */
export const DEFAULT_SLACK_POLL_MS = 60_000;
/** How far back a poll after a gap reads: what is older than this was missed for good. */
export const SLACK_CATCH_UP_MS = 24 * 3_600_000;
/** How much later than its own time a new message may show up in search and still count. */
export const SLACK_LATE_MS = 2 * 60_000;
/** The longest a failing poller waits before it tries again. */
const MAX_BACKOFF_MS = 15 * 60_000;
/** Pages of 100 one query reads in one poll; a catch-up past that says how much it left out. */
const MAX_PAGES = 5;
const PAGE_SIZE = 100;
/** Messages a cursor remembers as seen. */
const MAX_SEEN = 2_000;
/** How long a member's name and kind are kept before Slack is asked again. */
const PEOPLE_TTL_MS = 3_600_000;
const MAX_PEOPLE = 1_000;
const DAY_MS = 86_400_000;

/* ── events ─────────────────────────────────────────────────────────── */

/** Which queries a poll makes: what the enabled Slack triggers want. */
export type SlackWants = { mention: boolean; dm: boolean };

export type SlackPerson = {
  /** A member id, or a bot's id when a bot posted without one. */
  id: string;
  /** Their handle (Slack's `name`), and the name people see. */
  name: string;
  displayName: string;
  bot: boolean;
  /** From outside the operator's workspace (Slack Connect). */
  external: boolean;
};

export type SlackPlace = { id: string; name: string; kind: "channel" | "group" | "mpim" | "im" };

export type SlackEvent = {
  kind: SlackTriggerEvent;
  /** `<channel>:<ts>`: one message. */
  key: string;
  ts: string;
  at: string;
  person: SlackPerson;
  place: SlackPlace;
  /** GitHub pull request URLs it links to, or its thread parent does (`linksFromThread`). */
  links: string[];
  linksFromThread: boolean;
  /** One line. */
  summary: string;
  details: string;
  /** Found by a poll after a gap: it happened while HUI was not reading. */
  catchUp?: true;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 300): string => (typeof value === "string" ? value.slice(0, max) : "");
const iso = (time: number) => new Date(time).toISOString();
const oneLine = (value: string, max: number) => {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};
/** A Slack timestamp (`1700000000.000100`) in epoch milliseconds; NaN for anything else. */
export const tsMs = (ts: string): number => (/^\d{9,11}\.\d{1,6}$/u.test(ts) ? Math.round(Number(ts) * 1_000) : Number.NaN);
/** Two Slack timestamps in order, to the microsecond (milliseconds would tie messages of one burst). */
export function compareTs(a: string, b: string): number {
  const [aSeconds = "0", aFraction = ""] = a.split(".");
  const [bSeconds = "0", bFraction = ""] = b.split(".");
  return Number(aSeconds) - Number(bSeconds) || Number(aFraction.padEnd(6, "0")) - Number(bFraction.padEnd(6, "0"));
}
const SLACK_ID = /^[A-Z0-9]{2,40}$/u;

/** Slack's message markup as people read it: mentions as `@name`, channels as `#name`, links as `label (url)`. */
export function slackPlainText(raw: string, nameOf: (id: string) => string | undefined): string {
  return raw
    .replace(/<@([A-Z0-9]{2,40})(?:\|([^>]{1,80}))?>/gu, (_, id: string, label?: string) => `@${nameOf(id) ?? label ?? id}`)
    .replace(/<#([A-Z0-9]{2,40})(?:\|([^>]{0,80}))?>/gu, (_, id: string, label?: string) => `#${label || id}`)
    .replace(/<!subteam\^[A-Z0-9]{2,40}(?:\|([^>]{1,80}))?>/gu, (_, label?: string) => label ?? "@group")
    .replace(/<!(here|channel|everyone)(?:\|[^>]{0,40})?>/gu, (_, word: string) => `@${word}`)
    .replace(/<!date\^[^|>]{1,200}\|([^>]{1,200})>/gu, (_, fallback: string) => fallback)
    .replace(/<((?:https?|mailto):[^|>\s]{1,2000})(?:\|([^>]{1,500}))?>/gu, (_, url: string, label?: string) => {
      if (!label || label === url || `mailto:${label}` === url) return url.replace(/^mailto:/u, "");
      return `${label} (${url})`;
    })
    .replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
}

const PULL_URL = /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}\/pull\/\d{1,10}/giu;

/** The GitHub pull requests a message links to, in reading order: its text, then its attachments and blocks (an unfurl
 * or a rich-text link), each once, canonical, at most `BOT_TRIGGER_LIMITS.slackLinks`. */
export function pullRequestLinks(message: Record<string, unknown>): string[] {
  const sources = [text(message["text"], 40_000)];
  for (const key of ["attachments", "blocks", "files"]) {
    if (message[key] !== undefined) {
      try {
        sources.push((JSON.stringify(message[key]) ?? "").slice(0, 64 * 1024));
      } catch {
        // A value JSON can't hold carries no link HUI could read.
      }
    }
  }
  const links: string[] = [];
  for (const source of sources) {
    for (const match of source.matchAll(PULL_URL)) {
      const ref = parseGitHubUrl(match[0]);
      if (ref?.kind !== "pull" || links.includes(ref.url)) continue;
      links.push(ref.url);
      if (links.length >= BOT_TRIGGER_LIMITS.slackLinks) return links;
    }
  }
  return links;
}

/** `acme/widgets#42` for a pull request URL. */
export function pullRequestName(url: string): string {
  const ref = parseGitHubUrl(url);
  return ref && ref.kind !== "repo" ? `${ref.owner}/${ref.repo}#${ref.number}` : url;
}

/** The thread a message replies in: its `thread_ts`, or its permalink's. Undefined for a message that starts one or
 * stands alone. */
export function threadOf(message: Record<string, unknown>): string | undefined {
  const ts = text(message["ts"], 40);
  let thread = text(message["thread_ts"], 40);
  if (!thread) {
    try {
      thread = new URL(text(message["permalink"], 2_000)).searchParams.get("thread_ts") ?? "";
    } catch {
      thread = "";
    }
  }
  return /^\d{9,11}\.\d{1,6}$/u.test(thread) && thread !== ts ? thread : undefined;
}

/** Where a search match was said. */
export function placeOf(message: Record<string, unknown>): SlackPlace {
  const channel = isRecord(message["channel"]) ? message["channel"] : {};
  const id = text(channel["id"], 40);
  const name = text(channel["name"], 120);
  const kind: SlackPlace["kind"] = message["type"] === "im" || channel["is_im"] === true || id.startsWith("D") ? "im"
    : channel["is_mpim"] === true ? "mpim"
      : message["type"] === "group" || channel["is_private"] === true || channel["is_group"] === true ? "group"
        : "channel";
  return { id, name, kind };
}

/** `#team-reviews`, `a group DM`, `a direct message`. */
export function placeLabel(place: SlackPlace): string {
  if (place.kind === "im") return "a direct message";
  if (place.kind === "mpim") return "a group DM";
  return `#${place.name || place.id}`;
}

/** Whether a message's raw text @-mentions the member. */
export const mentionsMember = (raw: string, userId: string): boolean => raw.includes(`<@${userId}>`) || raw.includes(`<@${userId}|`);

function quote(body: string, max: number): string {
  const trimmed = body.replace(/\r\n?/gu, "\n").trim();
  const cut = trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
  return (cut || "(no text)").split("\n").map((line) => `  > ${line}`).join("\n");
}

const personLabel = (person: SlackPerson) => {
  const handle = person.name && person.name !== person.displayName ? ` (@${person.name})` : "";
  const marks = [...(person.bot ? ["a bot or app"] : []), ...(person.external ? ["outside your workspace, Slack Connect"] : [])];
  return `${person.displayName || person.name || person.id}${handle}${marks.length ? ` (${marks.join("; ")})` : ""}`;
};

/** A message without the `@operator` it starts with (and the punctuation after it): the one line is about the rest. */
function withoutLeadingMention(message: string, operator: string | undefined): string {
  const trimmed = message.trimStart();
  const mention = operator ? `@${operator}` : "";
  if (!mention || !trimmed.toLowerCase().startsWith(mention.toLowerCase())) return message;
  return trimmed.slice(mention.length).replace(/^[\s,:;.!-]+/u, "");
}

/** The one line and the details a delivery shows for a message. */
export function describeSlackEvent(input: {
  kind: SlackTriggerEvent;
  /** The operator's handle: a message that starts by mentioning them reads, in the one line, without it. */
  operator?: string;
  person: SlackPerson;
  place: SlackPlace;
  message: string;
  permalink: string;
  links: string[];
  linksFromThread: boolean;
  thread?: { person?: SlackPerson; message?: string; error?: string };
}): { summary: string; details: string } {
  const who = `@${input.person.name || input.person.displayName || input.person.id}`;
  const where = input.kind === "dm" ? "a DM" : placeLabel(input.place);
  const about = input.links.length ? input.links.map(pullRequestName).join(", ") : oneLine(withoutLeadingMention(input.message, input.operator), 120) || "(no text)";
  const summary = oneLine(`${who} in ${where}: ${about}`, 160);
  const lines = [
    `From ${personLabel(input.person)}, ${input.kind === "dm" ? "a direct message to you" : `in ${placeLabel(input.place)}`}${input.thread ? ", replying in a thread" : ""}`,
    ...(input.permalink ? [`${input.permalink}`] : []),
    quote(input.message, BOT_TRIGGER_LIMITS.slackText),
  ];
  if (input.thread?.error) lines.push(`The thread it replies to could not be read: ${input.thread.error}`);
  else if (input.thread?.message !== undefined) {
    lines.push(`It replies to${input.thread.person ? ` ${personLabel(input.thread.person)}` : " the thread"}:`, quote(input.thread.message, BOT_TRIGGER_LIMITS.slackText));
  }
  if (input.links.length) lines.push(`Pull requests: ${input.links.join(", ")}${input.linksFromThread ? " (linked in the thread it replies to)" : ""}`);
  let details = lines.join("\n");
  if (details.length > BOT_TRIGGER_LIMITS.slackDetails) details = `${details.slice(0, BOT_TRIGGER_LIMITS.slackDetails - 2).trimEnd()}\n…`;
  return { summary, details };
}

/* ── people ─────────────────────────────────────────────────────────── */

type SlackReader = Pick<SlackClient, "searchMessages" | "userInfo" | "threadParent">;

/** Members as users.info describes them, kept for an hour; without users:read, what a match says. */
export class SlackPeople {
  readonly #now: () => number;
  readonly #known = new Map<string, { person: SlackPerson; at: number }>();
  /** Until when users.info is not asked (the token lacks users:read). */
  #unreadableUntil = 0;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** A name already known, for rendering a mention. */
  name(id: string): string | undefined {
    const known = this.#known.get(id)?.person;
    return known ? known.name || known.displayName : undefined;
  }

  async get(reader: Pick<SlackClient, "userInfo">, me: SlackIdentity, message: Record<string, unknown>): Promise<SlackPerson> {
    const id = text(message["user"], 40);
    const botId = text(message["bot_id"], 40);
    const username = text(message["username"], 120);
    const botPost = Boolean(botId) || message["subtype"] === "bot_message";
    const fallback: SlackPerson = {
      id: id || botId || "unknown", name: username || id || botId, displayName: username || id || botId, bot: botPost || !id,
      external: this.#externalByMessage(me, message),
    };
    if (!SLACK_ID.test(id)) return fallback;
    const now = this.#now();
    const known = this.#known.get(id);
    if (known && now - known.at < PEOPLE_TTL_MS) return { ...known.person, bot: known.person.bot || botPost };
    if (now < this.#unreadableUntil) return fallback;
    let info: Record<string, unknown> | undefined;
    try {
      info = await reader.userInfo(id);
    } catch (error) {
      if (error instanceof SlackApiError && error.code === "missing_scope") {
        this.#unreadableUntil = now + PEOPLE_TTL_MS;
        return fallback;
      }
      throw error;
    }
    if (!info) return fallback;
    const profile = isRecord(info["profile"]) ? info["profile"] : {};
    const name = text(info["name"], 120) || username || id;
    const displayName = text(profile["display_name"], 120) || text(info["real_name"], 120) || text(profile["real_name"], 120) || name;
    const enterprise = isRecord(info["enterprise_user"]) ? text(info["enterprise_user"]["enterprise_id"], 40) : "";
    const team = text(info["team_id"], 40);
    const sameOrg = Boolean(me.enterpriseId) && enterprise === me.enterpriseId;
    const person: SlackPerson = {
      id, name, displayName,
      bot: info["is_bot"] === true || botPost,
      external: info["is_stranger"] === true || (Boolean(team) && team !== me.teamId && !sameOrg),
    };
    this.#known.set(id, { person, at: now });
    if (this.#known.size > MAX_PEOPLE) this.#known.delete(this.#known.keys().next().value!);
    return person;
  }

  /** Without users.info: a shared channel's message whose author's team isn't the operator's. */
  #externalByMessage(me: SlackIdentity, message: Record<string, unknown>): boolean {
    const channel = isRecord(message["channel"]) ? message["channel"] : {};
    const team = text(message["user_team"], 40) || text(message["source_team"], 40) || text(message["team"], 40);
    return channel["is_ext_shared"] === true && Boolean(team) && team !== me.teamId;
  }
}

/* ── cursor ─────────────────────────────────────────────────────────── */

export type SlackCursor = {
  /** Whose messages it read: another member or workspace starts with a new baseline. */
  userId: string;
  teamId: string;
  baselineAt: string;
  /** When the previous poll started, epoch ms: messages newer than this less `SLACK_LATE_MS` are new. */
  checkedTo: number;
  /** Messages seen since shortly before `checkedTo` (`<channel>:<ts>` → their time), so none counts twice. */
  seen: Record<string, number>;
};

export type SlackCursorState = { cursor?: unknown };

/** A saved cursor, or undefined when it can't be read exactly, which makes the next poll a silent baseline again. */
export function parseSlackCursor(raw: unknown): SlackCursor | undefined {
  if (!isRecord(raw)) return undefined;
  const userId = text(raw["userId"], 40);
  const teamId = text(raw["teamId"], 40);
  const baselineAt = text(raw["baselineAt"], 40);
  const checkedTo = raw["checkedTo"];
  if (!SLACK_ID.test(userId) || !SLACK_ID.test(teamId) || !Number.isFinite(Date.parse(baselineAt)) || typeof checkedTo !== "number" || !Number.isSafeInteger(checkedTo) || checkedTo <= 0) return undefined;
  const seen: Record<string, number> = Object.fromEntries(Object.entries(isRecord(raw["seen"]) ? raw["seen"] : {})
    .filter((entry): entry is [string, number] => /^[A-Z0-9]{2,40}:\d{9,11}\.\d{1,6}$/u.test(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .slice(-MAX_SEEN));
  return { userId, teamId, baselineAt, checkedTo, seen };
}

/* ── one poll ───────────────────────────────────────────────────────── */

export type SlackPollOutcome = {
  cursor: SlackCursor;
  events: SlackEvent[];
  /** Requests the poll made. */
  requests: number;
  /** The first poll: it only recorded where Slack stands. */
  baseline: boolean;
  /** The gap was longer than `SLACK_CATCH_UP_MS`: only the last day was read. */
  clipped: boolean;
  /** A query had more than `MAX_PAGES` pages of new messages: the oldest were left out. */
  truncated: boolean;
};

/** The day before `time`'s, as search's `after:` takes it (exclusive, in the member's time zone: a day of margin each side). */
const afterDay = (time: number) => new Date(time - 2 * DAY_MS).toISOString().slice(0, 10);

/**
 * One poll: what pinged the operator since `cursor` (undefined, or another member's: a silent baseline), and the next
 * cursor. Only the queries `wants` names are made. A Slack error (a 429, a revoked token) throws, and the cursor the
 * caller keeps is the previous one: the next poll reads the same window again.
 */
export async function pollSlack(input: {
  reader: SlackReader;
  me: SlackIdentity;
  cursor: SlackCursor | undefined;
  wants: SlackWants;
  now: () => number;
  people: SlackPeople;
  requests?: () => number;
}): Promise<SlackPollOutcome> {
  const { reader, me, wants } = input;
  const start = input.now();
  const previous = input.cursor && input.cursor.userId === me.userId && input.cursor.teamId === me.teamId ? input.cursor : undefined;
  let requests = 0;
  if (!previous) {
    return { cursor: { userId: me.userId, teamId: me.teamId, baselineAt: iso(start), checkedTo: start, seen: {} }, events: [], requests, baseline: true, clipped: false, truncated: false };
  }
  const from = Math.max(previous.checkedTo - SLACK_LATE_MS, start - SLACK_CATCH_UP_MS);
  const clipped = previous.checkedTo - SLACK_LATE_MS < start - SLACK_CATCH_UP_MS;
  let truncated = false;
  const found = new Map<string, Record<string, unknown>>();
  const queries: [SlackTriggerEvent, string][] = [];
  if (wants.mention) queries.push(["mention", `<@${me.userId}> after:${afterDay(from)}`]);
  if (wants.dm) queries.push(["dm", `is:dm after:${afterDay(from)}`]);
  for (const [, query] of queries) {
    for (let page = 1; ; page += 1) {
      requests += 1;
      const answer = await reader.searchMessages(query, page, PAGE_SIZE);
      let reached = false;
      for (const match of answer.matches) {
        const ts = text(match["ts"], 40);
        const time = tsMs(ts);
        if (!Number.isFinite(time)) continue;
        if (time < from) {
          reached = true;
          continue;
        }
        const place = placeOf(match);
        if (!place.id) continue;
        found.set(`${place.id}:${ts}`, match);
      }
      if (reached || page >= answer.pages) break;
      if (page >= MAX_PAGES) {
        truncated = true;
        break;
      }
    }
  }

  const seen = { ...previous.seen };
  const events: SlackEvent[] = [];
  const ordered = [...found.entries()].sort((a, b) => compareTs(text(a[1]["ts"], 40), text(b[1]["ts"], 40)));
  for (const [key, match] of ordered) {
    if (seen[key] !== undefined) continue;
    const ts = text(match["ts"], 40);
    const time = tsMs(ts);
    seen[key] = time;
    // An edit of a message from before the previous poll: that poll would have seen it, had it pinged then.
    const edited = isRecord(match["edited"]) || typeof match["edited"] === "string";
    if (edited && time < previous.checkedTo) continue;
    if (text(match["user"], 40) === me.userId) continue;
    const place = placeOf(match);
    const raw = text(match["text"], 40_000);
    const kind: SlackTriggerEvent = place.kind === "im" ? "dm" : "mention";
    if (kind === "mention" && !mentionsMember(raw, me.userId)) continue;
    const person = await input.people.get(reader, me, match);
    if (person.id === me.userId) continue;
    let links = pullRequestLinks(match);
    let linksFromThread = false;
    const threadTs = threadOf(match);
    let thread: { person?: SlackPerson; message?: string; error?: string } | undefined;
    if (threadTs) {
      thread = {};
      if (!links.length) {
        try {
          requests += 1;
          const parent = await reader.threadParent(place.id, threadTs);
          if (parent) {
            thread = {
              ...(text(parent["user"], 40) || text(parent["bot_id"], 40) ? { person: await input.people.get(reader, me, { ...parent, channel: match["channel"] }) } : {}),
              message: slackPlainText(text(parent["text"], 40_000), (id) => (id === me.userId ? me.user || id : input.people.name(id))),
            };
            links = pullRequestLinks(parent);
            linksFromThread = links.length > 0;
          } else thread = { error: "Slack did not return it." };
        } catch (error) {
          if (isSlackAuthError(error) || (error instanceof SlackApiError && error.code === "ratelimited")) throw error;
          thread = { error: error instanceof SlackApiError && error.code === "missing_scope" ? "the token lacks the history scope for this kind of conversation." : error instanceof Error ? error.message : String(error) };
        }
      }
    }
    const message = slackPlainText(raw, (id) => (id === me.userId ? me.user || id : input.people.name(id)));
    const { summary, details } = describeSlackEvent({
      kind, operator: me.user || me.userId, person, place, message, permalink: text(match["permalink"], 2_000), links, linksFromThread,
      ...(thread && (thread.message !== undefined || thread.error) ? { thread } : threadTs ? { thread: {} } : {}),
    });
    events.push({ kind, key, ts, at: iso(time), person, place, links, linksFromThread, summary, details });
  }
  // What the next poll's window can't reach any more need not be remembered.
  const keepFrom = start - SLACK_LATE_MS - 60_000;
  const kept = Object.entries(seen).filter(([, time]) => time >= keepFrom).sort((a, b) => a[1] - b[1]).slice(-MAX_SEEN);
  return {
    cursor: { userId: me.userId, teamId: me.teamId, baselineAt: previous.baselineAt, checkedTo: start, seen: Object.fromEntries(kept) },
    events, requests, baseline: false, clipped, truncated,
  };
}

/* ── the poller ─────────────────────────────────────────────────────── */

export type SlackPollStatus = {
  polledAt?: string;
  nextAt?: string;
  error?: string;
  /** Requests since the gateway started reading. */
  requests: number;
};

export type SlackPollerDeps = {
  connector: Pick<SlackConnector, "config" | "clientFor" | "refused" | "accepted" | "revoked" | "onChange">;
  cursors: JsonStateFile<SlackCursorState>;
  /** Every poll's events, after its cursor is saved. */
  onEvents(events: SlackEvent[]): Promise<void> | void;
  intervalMs?: number;
  /** Before the first poll once reading starts. */
  firstDelayMs?: number;
  now?: () => number;
  /** Runs `run` after `ms`; returns a cancel. Unref'd timers by default. */
  schedule?: (run: () => void, ms: number) => () => void;
  report?(level: "info" | "warning", action: string, summary: string, detail?: string): void;
};

const NOT_CONNECTED = "Slack isn't connected: connect it in Settings → Integrations → Slack, or with hui slack connect.";

/**
 * The Slack poller: reading while some enabled Slack trigger of an active bot wants it (`sync`), paused while bots are
 * off (`stop` keeps the cursor, so turning them on again catches up), forgetting where it was once no trigger wants
 * it. A poll after a gap longer than three intervals (the machine slept) or the first after a start from a saved
 * cursor marks its events as a catch-up.
 */
export class SlackPoller {
  readonly #deps: SlackPollerDeps;
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #schedule: (run: () => void, ms: number) => () => void;
  readonly #people: SlackPeople;
  #wants?: SlackWants;
  #cancel?: () => void;
  /** Bumped by every start and stop: a poll that started before one drops its answer. */
  #generation = 0;
  /** A poll completed since reading (re)started. */
  #polled = false;
  #failures = 0;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #status: SlackPollStatus = { requests: 0 };
  readonly #busy = new InFlight();
  /** Waiting for the operator to connect again (no token, or Slack refused it). */
  #parked = false;

  constructor(deps: SlackPollerDeps) {
    this.#deps = deps;
    this.#intervalMs = deps.intervalMs ?? DEFAULT_SLACK_POLL_MS;
    this.#now = deps.now ?? Date.now;
    this.#people = new SlackPeople(this.#now);
    this.#schedule = deps.schedule ?? ((run, ms) => {
      const timer = setTimeout(run, Math.max(0, ms));
      timer.unref?.();
      return () => clearTimeout(timer);
    });
    deps.connector.onChange(() => {
      // Connected again (or another account): read soon, from the cursor if it is the same member's.
      this.#parked = false;
      this.#failures = 0;
      delete this.#status.error;
      if (this.#wants) this.#arm(this.#deps.firstDelayMs ?? 1_000);
    });
  }

  /** Reads what `wants` asks for, starting now if it wasn't; undefined stops reading and forgets the cursor. */
  async sync(wants: SlackWants | undefined): Promise<void> {
    if (!wants || (!wants.mention && !wants.dm)) {
      const was = this.#wants !== undefined;
      this.#halt();
      this.#wants = undefined;
      delete this.#status.error;
      // No trigger reads Slack any more: watching again starts with a silent baseline.
      if (was || (await this.#deps.cursors.read().catch(() => undefined))?.cursor !== undefined) {
        await this.#busy.track(this.#deps.cursors.update(() => ({ value: {}, result: undefined })));
      }
      return;
    }
    const starting = this.#wants === undefined;
    this.#wants = { ...wants };
    if (starting) {
      this.#generation += 1;
      this.#polled = false;
      this.#arm(this.#deps.firstDelayMs ?? Math.min(2_000, this.#intervalMs / 4) * Math.random());
    }
  }

  /** Pauses reading; the cursor stays for the next `sync`. Resolves once a cursor being saved, and the events handed
   * on after it, have settled. */
  async stop(): Promise<void> {
    this.#halt();
    this.#wants = undefined;
    await this.#busy.settled();
  }

  status(): SlackPollStatus | undefined {
    return this.#wants ? { ...this.#status } : undefined;
  }

  get active(): boolean {
    return this.#wants !== undefined;
  }

  /** Polls now, in the queue, and resolves once its events were handed on. For tests. */
  async pollNow(): Promise<void> {
    if (!this.#wants) return;
    this.#cancel?.();
    this.#cancel = undefined;
    await this.#tick(this.#generation);
  }

  #halt(): void {
    this.#generation += 1;
    this.#cancel?.();
    this.#cancel = undefined;
    delete this.#status.nextAt;
  }

  #arm(delayMs: number): void {
    this.#cancel?.();
    const generation = this.#generation;
    this.#status.nextAt = iso(this.#now() + delayMs);
    this.#cancel = this.#schedule(() => {
      this.#cancel = undefined;
      void this.#tick(generation);
    }, delayMs);
  }

  async #tick(generation: number): Promise<void> {
    const run = this.#queue.then(() => this.#poll(generation));
    this.#queue = run.catch(() => undefined);
    await run.catch((error: unknown) => {
      this.#deps.report?.("warning", "slack_poll_failed", "Reading Slack for triggers failed", error instanceof Error ? error.message : String(error));
    });
  }

  async #poll(generation: number): Promise<void> {
    if (generation !== this.#generation || !this.#wants) return;
    const wants = this.#wants;
    let delay = this.#intervalMs;
    let rearm = true;
    try {
      const config: SlackConfig | undefined = await this.#deps.connector.config();
      if (!config || this.#deps.connector.revoked) {
        this.#status.error = config ? "Slack refused the token: it was revoked or expired. Connect again in Settings → Integrations → Slack." : NOT_CONNECTED;
        this.#parked = true;
        rearm = false;
        return;
      }
      const saved = await this.#deps.cursors.read();
      const cursor = parseSlackCursor(saved.cursor);
      const client = this.#deps.connector.clientFor(config.token);
      const start = this.#now();
      const gap = cursor ? start - cursor.checkedTo : 0;
      const catchUp = cursor !== undefined && cursor.userId === config.userId && (!this.#polled || gap > Math.max(3 * this.#intervalMs, 180_000));
      let outcome: SlackPollOutcome;
      try {
        outcome = await pollSlack({ reader: client, me: config, cursor, wants, now: this.#now, people: this.#people });
      } finally {
        this.#status.requests += client.requests;
      }
      // Stopped or synced away meanwhile: nothing is saved or delivered.
      if (generation !== this.#generation) {
        rearm = false;
        return;
      }
      this.#deps.connector.accepted();
      await this.#busy.track(this.#keep(outcome, catchUp));
      this.#failures = 0;
      this.#polled = true;
      delete this.#status.error;
      if (outcome.truncated) this.#deps.report?.("warning", "slack_poll_truncated", "More Slack messages pinged you than one read takes; the oldest were left out");
    } catch (error) {
      if (generation !== this.#generation) {
        rearm = false;
        return;
      }
      this.#failures += 1;
      this.#status.error = error instanceof Error ? error.message : String(error);
      if (isSlackAuthError(error)) {
        // Slack refused the token: reading waits for the operator to connect again.
        this.#deps.connector.refused(error);
        this.#parked = true;
        rearm = false;
      } else if (error instanceof SlackApiError && error.code === "ratelimited") {
        delay = Math.max(this.#intervalMs, error.retryAfterMs ?? this.#intervalMs);
      } else {
        if (error instanceof SlackApiError) this.#deps.connector.refused(error);
        delay = Math.min(MAX_BACKOFF_MS, this.#intervalMs * 2 ** Math.min(this.#failures, 8));
      }
      if (!(error instanceof SlackApiError)) throw error;
    } finally {
      this.#status.polledAt = iso(this.#now());
      if (rearm && !this.#parked && generation === this.#generation && this.#wants) this.#arm(delay);
      else if (generation === this.#generation) delete this.#status.nextAt;
    }
  }

  /** A poll's outcome kept: its cursor saved, then its events handed on. */
  async #keep(outcome: SlackPollOutcome, catchUp: boolean): Promise<void> {
    await this.#deps.cursors.update(() => ({ value: { cursor: outcome.cursor }, result: undefined }));
    if (!outcome.events.length) return;
    const events = catchUp ? outcome.events.map((event) => ({ ...event, catchUp: true as const })) : outcome.events;
    if (outcome.clipped) this.#deps.report?.("info", "slack_catch_up_clipped", "HUI read the last 24 hours of Slack pings; older ones were missed while it wasn't reading");
    await this.#deps.onEvents(events);
  }
}
