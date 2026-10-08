/**
 * Triggers' input and stored shape (HUI-18): what `POST`/`PATCH /__hui/bots/:id/triggers`, a bot's `triggers` tool
 * and `bot-triggers.json` may hold, checked at the gateway's boundary. Input that does not validate is refused with
 * what to fix (400); a stored record that does not validate is kept aside in the file, untouched, and not used.
 */
import {
  BOT_TRIGGER_LIMITS, BOT_TRIGGER_SOURCES, GITHUB_TRIGGER_EVENTS, HOOK_TRIGGER_SOURCES, SESSION_TRIGGER_EVENTS, SLACK_TRIGGER_EVENTS,
  type BotTriggerFilters, type BotTriggerInput, type BotTriggerPatch, type BotTriggerRecord, type BotTriggerSource, type GitHubTriggerEvent,
  type GitHubTriggerFilter, type ListenerTriggerFilter, type SessionTriggerEvent, type SessionTriggerFilter, type SlackTriggerEvent, type SlackTriggerFilter,
  type WebhookTriggerFilter, type WebhookTriggerMatch,
} from "../shared/bot-triggers.ts";

/** Rejected input (400), with what to fix. */
export class TriggerInputError extends Error {
  override name = "TriggerInputError";
}

/** No such trigger for that bot (404). */
export class TriggerNotFoundError extends Error {
  override name = "TriggerNotFoundError";
}

/** Valid, but refused now (409): a name taken, the per-bot cap, a turn that may not add triggers. */
export class TriggerConflictError extends Error {
  override name = "TriggerConflictError";
}

const ID = /^[A-Za-z0-9_-]{1,100}$/u;
/** `owner/name` as GitHub allows them. */
export const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u;
/** A login, an app's included (`dependabot[bot]`). */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/u;
/** A branch name without spaces or the characters git refuses in refs. */
const BRANCH = /^[^\s~^:?*[\\\p{Cc}]{1,100}$/u;
/** A dot path into a JSON body: names of letters, digits, `_`, `-` and `$`, or list indexes. */
const FIELD = /^[A-Za-z0-9_$-]{1,64}(?:\.[A-Za-z0-9_$-]{1,64}){0,15}$/u;
const CONTROL = /\p{Cc}/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const GITHUB_EVENTS: ReadonlySet<string> = new Set(GITHUB_TRIGGER_EVENTS);
const SESSION_EVENTS: ReadonlySet<string> = new Set(SESSION_TRIGGER_EVENTS);
const SLACK_EVENTS: ReadonlySet<string> = new Set(SLACK_TRIGGER_EVENTS);
/** A Slack member as a filter names them: an id, or a handle, display or real name (no `@`). */
const SLACK_PERSON = /^[^\s<>@#,|][^<>,|\p{Cc}]{0,79}$/u;
/** A Slack conversation as a filter names it: an id, or a channel name (lowercase letters, digits, `-`, `_`, `.`). */
const SLACK_CHANNEL = /^(?:[CG][A-Z0-9]{2,39}|[\p{Ll}\p{Lo}\p{N}_.-]{1,80})$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function refuseUnknown(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new TriggerInputError(`Unknown ${what} field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
}

/** A trigger's name: 1–60 characters on one line, without `[`, `]` or `·`, which mark its deliveries. */
export function triggerName(raw: unknown): string {
  if (typeof raw !== "string") throw new TriggerInputError("A trigger's name must be text.");
  const name = raw.replace(/\s+/gu, " ").trim();
  if (!name || name.length > BOT_TRIGGER_LIMITS.name) throw new TriggerInputError(`A trigger's name must be 1-${BOT_TRIGGER_LIMITS.name} characters.`);
  if (CONTROL.test(name) || /[[\]·]/u.test(name)) throw new TriggerInputError("A trigger's name can't hold [, ] or ·: they mark its messages in the bot's chat.");
  return name;
}

function promptField(raw: unknown): string {
  if (typeof raw !== "string") throw new TriggerInputError("A trigger's prompt must be text.");
  const prompt = raw.replace(/\r\n?/gu, "\n").trim();
  if (prompt.length > BOT_TRIGGER_LIMITS.prompt) throw new TriggerInputError(`A trigger's prompt must be at most ${BOT_TRIGGER_LIMITS.prompt} characters.`);
  if (prompt.includes("\0")) throw new TriggerInputError("A trigger's prompt must be text.");
  return prompt;
}

function cooldownField(raw: unknown): number {
  if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > BOT_TRIGGER_LIMITS.cooldownMax) {
    throw new TriggerInputError(`cooldownSeconds must be a whole number of seconds, 0-${BOT_TRIGGER_LIMITS.cooldownMax}.`);
  }
  return raw as number;
}

/** `owner/name`, also from a GitHub URL (`https://github.com/owner/name`, `.git` and a trailing slash dropped). */
export function repoName(raw: string): string | undefined {
  const value = raw.trim().replace(/^https?:\/\/(?:www\.)?github\.com\//iu, "").replace(/\.git$/u, "").replace(/\/+$/u, "");
  return REPO.test(value) ? value : undefined;
}

/** A list of distinct texts (any case counts once), each checked by `valid`; `what` names it in errors. */
function textList(raw: unknown, what: string, valid: (value: string) => string | undefined, options: { min?: number; max?: number } = {}): string[] {
  const max = options.max ?? BOT_TRIGGER_LIMITS.values;
  if (!Array.isArray(raw) || raw.length > max) throw new TriggerInputError(`${what} must be a list of at most ${max}.`);
  const values: string[] = [];
  for (const item of raw) {
    const value = typeof item === "string" ? valid(item.trim()) : undefined;
    if (value === undefined) throw new TriggerInputError(`${what}: ${JSON.stringify(item)} is not valid.`);
    if (!values.some((each) => each.toLowerCase() === value.toLowerCase())) values.push(value);
  }
  if (values.length < (options.min ?? 0)) throw new TriggerInputError(`${what} needs at least ${options.min}.`);
  return values;
}

function eventList<T extends string>(raw: unknown, known: ReadonlySet<string>, all: readonly T[], what: string): T[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > all.length) throw new TriggerInputError(`${what} must list 1-${all.length} of: ${all.join(", ")}.`);
  const unknown = raw.filter((item) => typeof item !== "string" || !known.has(item));
  if (unknown.length) throw new TriggerInputError(`Unknown ${what}: ${unknown.map((item) => JSON.stringify(item)).join(", ")}. Choose from: ${all.join(", ")}.`);
  return all.filter((event) => raw.includes(event));
}

const label = (value: string) => (value && value.length <= BOT_TRIGGER_LIMITS.value && !CONTROL.test(value) ? value : undefined);

function githubFilter(raw: Record<string, unknown>): GitHubTriggerFilter {
  refuseUnknown(raw, ["repos", "events", "authors", "labels", "base", "pullRequests", "draft"], "GitHub filter");
  const filter: GitHubTriggerFilter = {
    repos: textList(raw["repos"], "repos (owner/name)", repoName, { min: 1, max: BOT_TRIGGER_LIMITS.repos }),
    events: eventList<GitHubTriggerEvent>(raw["events"], GITHUB_EVENTS, GITHUB_TRIGGER_EVENTS, "GitHub events"),
  };
  const authors = raw["authors"] == null ? [] : textList(raw["authors"], "authors (GitHub logins)", (value) => (LOGIN.test(value) ? value : undefined));
  const labels = raw["labels"] == null ? [] : textList(raw["labels"], "labels", label);
  const base = raw["base"] == null ? [] : textList(raw["base"], "base branches", (value) => (BRANCH.test(value) ? value : undefined));
  if (authors.length) filter.authors = authors;
  if (labels.length) filter.labels = labels;
  if (base.length) filter.base = base;
  if (raw["pullRequests"] != null) {
    const numbers = raw["pullRequests"];
    if (!Array.isArray(numbers) || numbers.length > BOT_TRIGGER_LIMITS.values || !numbers.every((value) => Number.isInteger(value) && value >= 1 && value <= 1_000_000_000)) {
      throw new TriggerInputError(`pullRequests must be a list of at most ${BOT_TRIGGER_LIMITS.values} pull request numbers.`);
    }
    if (numbers.length) filter.pullRequests = [...new Set(numbers as number[])];
  }
  if (raw["draft"] != null) {
    if (typeof raw["draft"] !== "boolean") throw new TriggerInputError("draft must be true (only drafts), false (only ready pull requests) or left out (both).");
    filter.draft = raw["draft"];
  }
  return filter;
}

function sessionFilter(raw: Record<string, unknown>): SessionTriggerFilter {
  refuseUnknown(raw, ["events"], "session filter");
  return { events: eventList<SessionTriggerEvent>(raw["events"], SESSION_EVENTS, SESSION_TRIGGER_EVENTS, "session events") };
}

export function webhookMatch(raw: unknown): WebhookTriggerMatch {
  if (!isRecord(raw)) throw new TriggerInputError("match must be { field, op, value }.");
  refuseUnknown(raw, ["field", "op", "value"], "match");
  const field = typeof raw["field"] === "string" ? raw["field"].trim() : undefined;
  if (field === undefined || (field !== "" && (field.length > BOT_TRIGGER_LIMITS.field || !FIELD.test(field)))) {
    throw new TriggerInputError("match.field must be a dot path into the JSON body, such as action or pull_request.state (\"\" is the whole body).");
  }
  if (raw["op"] !== "equals" && raw["op"] !== "contains") throw new TriggerInputError("match.op must be equals or contains.");
  const value = typeof raw["value"] === "string" ? raw["value"] : undefined;
  if (!value || value.length > BOT_TRIGGER_LIMITS.match || CONTROL.test(value)) throw new TriggerInputError(`match.value must be 1-${BOT_TRIGGER_LIMITS.match} characters on one line.`);
  return { field, op: raw["op"], value };
}

function webhookFilter(raw: Record<string, unknown>): WebhookTriggerFilter {
  refuseUnknown(raw, ["match"], "webhook filter");
  return raw["match"] == null ? {} : { match: webhookMatch(raw["match"]) };
}

/** An optional switch of a Slack filter: `true` sets it; `false` and `null` leave it out. */
function flag(raw: unknown, what: string): true | undefined {
  if (raw == null || raw === false) return undefined;
  if (raw !== true) throw new TriggerInputError(`${what} must be true or false.`);
  return true;
}

function slackFilter(raw: Record<string, unknown>): SlackTriggerFilter {
  refuseUnknown(raw, ["events", "prLinks", "from", "in", "external", "bots"], "Slack filter");
  const filter: SlackTriggerFilter = { events: eventList<SlackTriggerEvent>(raw["events"], SLACK_EVENTS, SLACK_TRIGGER_EVENTS, "Slack events") };
  const from = raw["from"] == null ? [] : textList(raw["from"], "from (Slack people)", (value) => {
    const person = value.replace(/^@/u, "").trim();
    return SLACK_PERSON.test(person) ? person : undefined;
  });
  const channels = raw["in"] == null ? [] : textList(raw["in"], "in (Slack channels)", (value) => {
    const channel = value.replace(/^#/u, "").trim();
    return SLACK_CHANNEL.test(channel) ? channel : undefined;
  });
  if (flag(raw["prLinks"], "prLinks")) filter.prLinks = true;
  if (from.length) filter.from = from;
  if (channels.length) filter.in = channels;
  if (flag(raw["external"], "external")) filter.external = true;
  if (flag(raw["bots"], "bots")) filter.bots = true;
  return filter;
}

function listenerFilter(raw: Record<string, unknown>): ListenerTriggerFilter {
  refuseUnknown(raw, ["match", "prLinks", "bots", "external"], "listener filter");
  const filter: ListenerTriggerFilter = raw["match"] == null ? {} : { match: webhookMatch(raw["match"]) };
  if (flag(raw["prLinks"], "prLinks")) filter.prLinks = true;
  if (flag(raw["bots"], "bots")) filter.bots = true;
  if (flag(raw["external"], "external")) filter.external = true;
  return filter;
}

/** A source's filter, every key checked. */
export function triggerFilter<S extends BotTriggerSource>(source: S, raw: unknown): BotTriggerFilters[S] {
  if (raw === undefined && HOOK_TRIGGER_SOURCES.has(source)) return {} as BotTriggerFilters[S];
  if (!isRecord(raw)) throw new TriggerInputError("filter must be an object.");
  switch (source) {
    case "github": return githubFilter(raw) as BotTriggerFilters[S];
    case "session": return sessionFilter(raw) as BotTriggerFilters[S];
    case "slack": return slackFilter(raw) as BotTriggerFilters[S];
    case "listener": return listenerFilter(raw) as BotTriggerFilters[S];
    default: return webhookFilter(raw) as BotTriggerFilters[S];
  }
}

function sourceField(raw: unknown): BotTriggerSource {
  const source = BOT_TRIGGER_SOURCES.find((candidate) => candidate === raw);
  if (!source) throw new TriggerInputError(`source must be one of: ${BOT_TRIGGER_SOURCES.join(", ")}.`);
  return source;
}

/** Validates `POST /__hui/bots/:id/triggers`. */
export function normalizeTriggerInput(value: unknown): BotTriggerInput {
  if (!isRecord(value)) throw new TriggerInputError("A trigger must be an object.");
  refuseUnknown(value, ["name", "source", "filter", "prompt", "enabled", "cooldownSeconds"], "trigger");
  const source = sourceField(value["source"]);
  const prompt = value["prompt"] === undefined ? "" : promptField(value["prompt"]);
  if (value["enabled"] !== undefined && typeof value["enabled"] !== "boolean") throw new TriggerInputError("enabled must be a boolean.");
  return {
    name: triggerName(value["name"]),
    ...({ source, filter: triggerFilter(source, value["filter"]) } as Pick<BotTriggerInput, "source" | "filter">),
    ...(prompt ? { prompt } : {}),
    enabled: value["enabled"] !== false,
    cooldownSeconds: value["cooldownSeconds"] === undefined ? BOT_TRIGGER_LIMITS.cooldownDefault : cooldownField(value["cooldownSeconds"]),
  } as BotTriggerInput;
}

/** Validates `PATCH /__hui/bots/:id/triggers/:trigger` against the trigger's source; the filter is checked once merged. */
export function normalizeTriggerPatch(value: unknown): BotTriggerPatch {
  if (!isRecord(value)) throw new TriggerInputError("A trigger change must be an object.");
  if ("source" in value) throw new TriggerInputError("A trigger's source can't change: add a new trigger instead.");
  refuseUnknown(value, ["name", "filter", "prompt", "enabled", "cooldownSeconds"], "trigger");
  if (!Object.keys(value).length) throw new TriggerInputError("Nothing to change.");
  const patch: BotTriggerPatch = {};
  if ("name" in value) patch.name = triggerName(value["name"]);
  if ("prompt" in value) patch.prompt = promptField(value["prompt"]);
  if ("enabled" in value) {
    if (typeof value["enabled"] !== "boolean") throw new TriggerInputError("enabled must be a boolean.");
    patch.enabled = value["enabled"];
  }
  if ("cooldownSeconds" in value) patch.cooldownSeconds = cooldownField(value["cooldownSeconds"]);
  if ("filter" in value) {
    if (!isRecord(value["filter"])) throw new TriggerInputError("filter must be an object of the keys to change.");
    patch.filter = value["filter"];
  }
  return patch;
}

const FILTER_KEYS: Readonly<Record<BotTriggerSource, readonly string[]>> = {
  github: ["repos", "events", "authors", "labels", "base", "pullRequests", "draft"],
  session: ["events"],
  webhook: ["match"],
  slack: ["events", "prLinks", "from", "in", "external", "bots"],
  listener: ["match", "prLinks", "bots", "external"],
};

/** The filter after a patch's keys: each given key replaces, `null` or an empty list clears an optional one. Only the
 * source's own keys are taken. */
export function patchedFilter<S extends BotTriggerSource>(source: S, current: BotTriggerFilters[S], change: Record<string, unknown>): BotTriggerFilters[S] {
  refuseUnknown(change, FILTER_KEYS[source], `${source} filter`);
  const entries = new Map<string, unknown>(Object.entries(current));
  for (const key of FILTER_KEYS[source]) {
    if (!Object.hasOwn(change, key)) continue;
    const value = change[key];
    // A Slack or listener filter's switches turn off with false too.
    if (value === null || (value === false && (source === "slack" || source === "listener")) || (Array.isArray(value) && !value.length && key !== "repos" && key !== "events")) entries.delete(key);
    else entries.set(key, value);
  }
  return triggerFilter(source, Object.fromEntries(entries));
}

function storedText(raw: unknown, max: number): string | undefined {
  return typeof raw === "string" && raw.trim() && raw.length <= max ? raw : undefined;
}

/**
 * A stored record, or undefined when anything required is missing or invalid: a trigger HUI can't read exactly is
 * kept aside rather than run with a guessed filter.
 */
export function parseTriggerRecord(raw: unknown): BotTriggerRecord | undefined {
  if (!isRecord(raw)) return undefined;
  try {
    const id = String(raw["id"] ?? "");
    const botId = String(raw["botId"] ?? "");
    const createdAt = String(raw["createdAt"] ?? "");
    const updatedAt = String(raw["updatedAt"] ?? "");
    if (!ID.test(id) || !ID.test(botId) || !ISO.test(createdAt) || !ISO.test(updatedAt)) return undefined;
    const source = sourceField(raw["source"]);
    const filter = triggerFilter(source, raw["filter"] ?? (HOOK_TRIGGER_SOURCES.has(source) ? {} : undefined));
    if (typeof raw["enabled"] !== "boolean") return undefined;
    const cooldownSeconds = cooldownField(raw["cooldownSeconds"]);
    const createdBy = raw["createdBy"] === "bot" ? "bot" : raw["createdBy"] === "operator" ? "operator" : undefined;
    if (!createdBy) return undefined;
    const prompt = storedText(raw["prompt"], BOT_TRIGGER_LIMITS.prompt);
    const lastFiredAt = typeof raw["lastFiredAt"] === "string" && ISO.test(raw["lastFiredAt"]) ? raw["lastFiredAt"] : undefined;
    const tokenHash = typeof raw["tokenHash"] === "string" && /^[0-9a-f]{64}$/u.test(raw["tokenHash"]) ? raw["tokenHash"] : undefined;
    const tokenHint = typeof raw["tokenHint"] === "string" && /^[A-Za-z0-9_-]{4}$/u.test(raw["tokenHint"]) ? raw["tokenHint"] : undefined;
    // A webhook or listener trigger without its token's hash could never be called: it is not a trigger HUI can run.
    if (HOOK_TRIGGER_SOURCES.has(source) && !tokenHash) return undefined;
    return {
      id, botId, name: triggerName(raw["name"]),
      ...({ source, filter } as Pick<BotTriggerRecord, "source" | "filter">),
      ...(prompt ? { prompt } : {}),
      enabled: raw["enabled"], cooldownSeconds, createdBy, createdAt, updatedAt,
      ...(lastFiredAt ? { lastFiredAt } : {}),
      ...(HOOK_TRIGGER_SOURCES.has(source) && tokenHash ? { tokenHash, ...(tokenHint ? { tokenHint } : {}) } : {}),
    } as BotTriggerRecord;
  } catch {
    return undefined;
  }
}
