/**
 * Listener triggers' source (HUI-18): a program the operator runs outside HUI watches something HUI doesn't read
 * itself (a work Slack through its MCP server, a Jira board, …) and, after every check, reports what it found to its
 * trigger's URL, the webhooks' route `POST /__hui/hooks/<token>` (`bot-triggers-webhook.ts`):
 *
 *   { "events": [{ "id", "summary", "details"?, "at"?, "links"?, "fields"?, "bot"?, "external"? }], "error"?, "catchUp"? }
 *
 * An empty `events` is a check-in: no delivery, no turn. The service wakes the bot once per event id (it remembers the
 * ids with the delivery it decides), never for an event older than the trigger, and only for what the trigger's filter
 * passes; the GitHub pull requests an event links to are read as its delivery goes out. The listener keeps its own
 * place in what it watches: a report HUI refuses (bots off: 409) is its cue to send those events again later.
 */
import { BOT_TRIGGER_LIMITS, type ListenerTriggerFilter } from "../shared/bot-triggers.ts";
import { parseGitHubUrl } from "../shared/github-links.ts";
import { refuseUnknown, TriggerInputError } from "./bot-triggers-input.ts";
import { matchesJson, oneLine, type HookBody } from "./bot-triggers-webhook.ts";

/** A listener that hasn't reported for this long is said to be silent, on its trigger. */
export const LISTENER_SILENT_MS = 5 * 60_000;

/** One event as HUI keeps it: what it matches a filter against and delivers. */
export type ListenerEvent = {
  id: string;
  /** One line. */
  summary: string;
  details: string;
  at: string;
  /** The GitHub pull requests among its links, canonical, each once, `BOT_TRIGGER_LIMITS.slackLinks` at most. */
  links: string[];
  fields: Record<string, unknown>;
  bot: boolean;
  external: boolean;
};

export type ListenerReport = { events: ListenerEvent[]; error?: string; catchUp: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const CONTROL = /\p{Cc}/u;
const FIELD_NAME = /^[A-Za-z0-9_$-]{1,64}$/u;
const refused = (message: string) => new TriggerInputError(message);
/** Control characters (a terminal's escapes among them) and bidirectional overrides, which only disguise text: what a
 * listener relays reaches the bot's chat, the UI and `hui bot trigger list`. Lines and tabs stay in details. */
const plain = (value: string, keepLines = false) => value
  .replace(keepLines ? /[^\P{Cc}\n\t]/gu : /\p{Cc}/gu, keepLines ? "" : " ")
  .replace(/[\u202a-\u202e\u2066-\u2069]/gu, "");
const scalar = (value: unknown) => value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= BOT_TRIGGER_LIMITS.match);

/** The GitHub pull requests among an event's links. */
function pullRequests(links: readonly string[]): string[] {
  const found: string[] = [];
  for (const link of links) {
    const ref = parseGitHubUrl(link.trim());
    if (ref?.kind === "pull" && !found.includes(ref.url)) found.push(ref.url);
  }
  return found.slice(0, BOT_TRIGGER_LIMITS.slackLinks);
}

function eventOf(raw: unknown, where: string, now: number): ListenerEvent {
  if (!isRecord(raw)) throw refused(`${where} must be an object: { id, summary, details?, at?, links?, fields?, bot?, external? }.`);
  refuseUnknown(raw, ["id", "summary", "details", "at", "links", "fields", "bot", "external"], where);
  const id = raw["id"];
  if (typeof id !== "string" || !id.trim() || id.length > 200 || CONTROL.test(id)) {
    throw refused(`${where}.id must be 1-200 characters on one line: the event's own id, so a report sent again never wakes the bot twice.`);
  }
  const summary = typeof raw["summary"] === "string" ? oneLine(plain(raw["summary"]), 160) : "";
  if (!summary) throw refused(`${where}.summary must be text: one line that says what happened.`);
  if (raw["details"] !== undefined && typeof raw["details"] !== "string") throw refused(`${where}.details must be text.`);
  const details = plain((raw["details"] ?? "").replace(/\r\n?/gu, "\n"), true).trim();
  const time = raw["at"] === undefined ? now : typeof raw["at"] === "string" ? Date.parse(raw["at"]) : Number.NaN;
  if (!Number.isFinite(time)) throw refused(`${where}.at must be an ISO 8601 time, such as 2026-10-08T09:30:00Z.`);
  const links = raw["links"] ?? [];
  if (!Array.isArray(links) || links.length > BOT_TRIGGER_LIMITS.values || !links.every((link) => typeof link === "string" && link.length <= 2_000)) {
    throw refused(`${where}.links must be a list of at most ${BOT_TRIGGER_LIMITS.values} URLs.`);
  }
  const fields = raw["fields"] ?? {};
  if (!isRecord(fields) || Object.keys(fields).length > BOT_TRIGGER_LIMITS.values) throw refused(`${where}.fields must be an object of at most ${BOT_TRIGGER_LIMITS.values} fields.`);
  for (const [name, value] of Object.entries(fields)) {
    if (!FIELD_NAME.test(name) || !(scalar(value) || (Array.isArray(value) && value.length <= BOT_TRIGGER_LIMITS.values && value.every(scalar)))) {
      throw refused(`${where}.fields.${name.slice(0, 64)} must be text (${BOT_TRIGGER_LIMITS.match} characters at most), a number, true, false or null, or a list of at most ${BOT_TRIGGER_LIMITS.values} of them.`);
    }
  }
  for (const flag of ["bot", "external"]) if (raw[flag] !== undefined && typeof raw[flag] !== "boolean") throw refused(`${where}.${flag} must be true or false.`);
  return {
    id, summary,
    details: details.length > BOT_TRIGGER_LIMITS.slackDetails ? `${details.slice(0, BOT_TRIGGER_LIMITS.slackDetails - 2).trimEnd()}\n…` : details,
    at: new Date(time).toISOString(),
    links: pullRequests(links), fields,
    bot: raw["bot"] === true, external: raw["external"] === true,
  };
}

/** A listener's report, checked; what to fix when it isn't one (`TriggerInputError`, a 400). An id the report repeats
 * counts once. */
export function parseListenerReport(body: HookBody, now: number): ListenerReport {
  if (body.kind !== "json" || !isRecord(body.value)) throw refused("A listener reports JSON (Content-Type: application/json): { \"events\": [...] }, the list empty when nothing happened.");
  const value = body.value;
  refuseUnknown(value, ["events", "error", "catchUp"], "report");
  const raw = value["events"];
  if (!Array.isArray(raw) || raw.length > BOT_TRIGGER_LIMITS.listenerEvents) {
    throw refused(`events must be a list of at most ${BOT_TRIGGER_LIMITS.listenerEvents} events, empty when nothing happened; send more in several reports.`);
  }
  if (value["error"] !== undefined && typeof value["error"] !== "string") throw refused("error must be text: the listener's own problem, which its trigger shows.");
  if (value["catchUp"] !== undefined && typeof value["catchUp"] !== "boolean") throw refused("catchUp must be true or false.");
  const events: ListenerEvent[] = [];
  raw.forEach((item, index) => {
    const event = eventOf(item, `events[${index}]`, now);
    if (!events.some((each) => each.id === event.id)) events.push(event);
  });
  const error = oneLine(plain(value["error"] ?? ""), 300);
  return { events, ...(error ? { error } : {}), catchUp: value["catchUp"] === true };
}

/** Whether an event passes a listener trigger's filter and is no older than the trigger (`since`). */
export function listenerMatches(filter: ListenerTriggerFilter, event: ListenerEvent, since?: string): boolean {
  if (since && Date.parse(event.at) < Date.parse(since)) return false;
  if (event.bot && !filter.bots) return false;
  if (event.external && !filter.external) return false;
  if (filter.prLinks && !event.links.length) return false;
  return !filter.match || matchesJson(filter.match, event);
}
