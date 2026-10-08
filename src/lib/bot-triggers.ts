/**
 * A bot's triggers in the Bots tab (HUI-18): the Triggers section of its panel's Routines tab, Slack's included. It reads
 * `GET /__hui/bots/:id/triggers` while the tab shows (again every few seconds, since triggers fire on their own),
 * adds, switches, tests and deletes triggers through the trigger routes, and shows a webhook or listener trigger's URL
 * once, right after it was made or replaced. `BotTriggersController` keeps that state outside `hui-app.ts`, as the Tools tab's
 * controller does; the view is `src/views/bot-triggers.ts`.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import {
  BOT_TRIGGER_LIMITS, BOT_TRIGGER_SOURCES, GITHUB_TRIGGER_EVENTS, HOOK_TRIGGER_SOURCES, SESSION_TRIGGER_EVENTS, SLACK_TRIGGER_EVENTS,
  type BotTrigger, type BotTriggerCreated, type BotTriggerInput, type BotTriggerPatch, type BotTriggerRun, type BotTriggerRunStatus, type BotTriggersList,
  type BotTriggerSource, type GitHubTriggerEvent, type SessionTriggerEvent, type SlackTriggerEvent,
} from "../../shared/bot-triggers.ts";
import type { BotView } from "../../shared/bots.ts";
import { writeClipboardText } from "./clipboard.ts";
import { fetchJson } from "./settings-store.ts";

/** How often the open section reads the triggers again: they fire on their own. */
export const TRIGGERS_POLL_MS = 5_000;
const JSON_HEADERS = { "content-type": "application/json" } as const;

/* ── reading ─────────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const RUN_STATUSES: readonly BotTriggerRunStatus[] = ["fired", "coalesced", "skipped", "failed"];

function parseFilter(source: BotTriggerSource, raw: unknown): BotTrigger["filter"] | undefined {
  if (!isRecord(raw)) return HOOK_TRIGGER_SOURCES.has(source) ? {} : undefined;
  if (source === "github") {
    const repos = strings(raw["repos"]);
    const events = strings(raw["events"]).filter((event): event is GitHubTriggerEvent => (GITHUB_TRIGGER_EVENTS as readonly string[]).includes(event));
    if (!repos.length || !events.length) return undefined;
    const numbers = Array.isArray(raw["pullRequests"]) ? raw["pullRequests"].filter((value): value is number => Number.isInteger(value)) : [];
    return {
      repos, events,
      ...(strings(raw["authors"]).length ? { authors: strings(raw["authors"]) } : {}),
      ...(strings(raw["labels"]).length ? { labels: strings(raw["labels"]) } : {}),
      ...(strings(raw["base"]).length ? { base: strings(raw["base"]) } : {}),
      ...(numbers.length ? { pullRequests: numbers } : {}),
      ...(typeof raw["draft"] === "boolean" ? { draft: raw["draft"] } : {}),
    };
  }
  if (source === "session") {
    const events = strings(raw["events"]).filter((event): event is SessionTriggerEvent => (SESSION_TRIGGER_EVENTS as readonly string[]).includes(event));
    return events.length ? { events } : undefined;
  }
  if (source === "slack") {
    const events = strings(raw["events"]).filter((event): event is SlackTriggerEvent => (SLACK_TRIGGER_EVENTS as readonly string[]).includes(event));
    if (!events.length) return undefined;
    return {
      events,
      ...(raw["prLinks"] === true ? { prLinks: true as const } : {}),
      ...(strings(raw["from"]).length ? { from: strings(raw["from"]) } : {}),
      ...(strings(raw["in"]).length ? { in: strings(raw["in"]) } : {}),
      ...(raw["external"] === true ? { external: true as const } : {}),
      ...(raw["bots"] === true ? { bots: true as const } : {}),
    };
  }
  const match = isRecord(raw["match"]) && (raw["match"]["op"] === "equals" || raw["match"]["op"] === "contains") && str(raw["match"]["value"])
    ? { field: str(raw["match"]["field"]), op: raw["match"]["op"] === "contains" ? "contains" as const : "equals" as const, value: str(raw["match"]["value"]) }
    : undefined;
  if (source === "listener") {
    return {
      ...(match ? { match } : {}),
      ...(raw["prLinks"] === true ? { prLinks: true as const } : {}),
      ...(raw["external"] === true ? { external: true as const } : {}),
      ...(raw["bots"] === true ? { bots: true as const } : {}),
    };
  }
  return match ? { match } : {};
}

/** One trigger as the routes return it, narrowed; undefined when it doesn't validate. */
export function parseTrigger(raw: unknown): BotTrigger | undefined {
  if (!isRecord(raw) || !str(raw["id"]) || !str(raw["name"]) || !str(raw["botId"])) return undefined;
  const source = BOT_TRIGGER_SOURCES.find((candidate) => candidate === raw["source"]);
  if (!source) return undefined;
  const filter = parseFilter(source, raw["filter"]);
  if (!filter) return undefined;
  const pending = isRecord(raw["pending"]) && Number.isInteger(raw["pending"]["events"]) && str(raw["pending"]["until"])
    ? { events: raw["pending"]["events"] as number, until: str(raw["pending"]["until"]) }
    : undefined;
  const watch = isRecord(raw["watch"]) ? { ...(str(raw["watch"]["polledAt"]) ? { polledAt: str(raw["watch"]["polledAt"]) } : {}), ...(str(raw["watch"]["error"]) ? { error: str(raw["watch"]["error"]) } : {}) } : undefined;
  return {
    id: str(raw["id"]), botId: str(raw["botId"]), name: str(raw["name"]),
    ...({ source, filter } as Pick<BotTrigger, "source" | "filter">),
    ...(str(raw["prompt"]) ? { prompt: str(raw["prompt"]) } : {}),
    enabled: raw["enabled"] !== false,
    cooldownSeconds: Number.isInteger(raw["cooldownSeconds"]) ? raw["cooldownSeconds"] as number : BOT_TRIGGER_LIMITS.cooldownDefault,
    createdBy: raw["createdBy"] === "bot" ? "bot" : "operator",
    createdAt: str(raw["createdAt"]), updatedAt: str(raw["updatedAt"]),
    ...(str(raw["lastFiredAt"]) ? { lastFiredAt: str(raw["lastFiredAt"]) } : {}),
    ...(str(raw["tokenHint"]) ? { tokenHint: str(raw["tokenHint"]) } : {}),
    ...(pending ? { pending } : {}),
    ...(watch && Object.keys(watch).length ? { watch } : {}),
  } as BotTrigger;
}

function parseRun(raw: unknown): BotTriggerRun | undefined {
  if (!isRecord(raw) || !str(raw["id"]) || !str(raw["triggerId"]) || !str(raw["at"])) return undefined;
  const status = RUN_STATUSES.find((candidate) => candidate === raw["status"]);
  if (!status) return undefined;
  return {
    id: str(raw["id"]), triggerId: str(raw["triggerId"]), triggerName: str(raw["triggerName"]), at: str(raw["at"]), status,
    events: Number.isInteger(raw["events"]) ? raw["events"] as number : 1, summary: str(raw["summary"]),
    ...(str(raw["reason"]) ? { reason: str(raw["reason"]) } : {}),
    ...(raw["test"] === true ? { test: true } : {}),
    ...(raw["catchUp"] === true ? { catchUp: true } : {}),
  };
}

/** `GET /__hui/bots/:id/triggers`, narrowed: entries that don't validate are left out. */
export function parseTriggersList(body: unknown): BotTriggersList {
  if (!isRecord(body) || !Array.isArray(body["triggers"])) throw new Error("The bot's triggers did not come back.");
  const deliveries = isRecord(body["deliveries"]) ? body["deliveries"] : {};
  return {
    triggers: body["triggers"].flatMap((raw) => parseTrigger(raw) ?? []),
    runs: Array.isArray(body["runs"]) ? body["runs"].flatMap((raw) => parseRun(raw) ?? []) : [],
    deliveries: {
      lastHour: Number.isInteger(deliveries["lastHour"]) ? deliveries["lastHour"] as number : 0,
      perHour: Number.isInteger(deliveries["perHour"]) ? deliveries["perHour"] as number : BOT_TRIGGER_LIMITS.perHour,
    },
  };
}

function parseCreated(body: unknown): BotTriggerCreated {
  const trigger = isRecord(body) ? parseTrigger(body["trigger"]) : undefined;
  if (!trigger || !isRecord(body)) throw new Error("The trigger did not come back.");
  const hook = isRecord(body["hook"]) && str(body["hook"]["token"]) && str(body["hook"]["path"]) ? { token: str(body["hook"]["token"]), path: str(body["hook"]["path"]) } : undefined;
  return { trigger, ...(hook ? { hook } : {}) };
}

const triggersUrl = (botId: string, trigger?: string, action?: string) =>
  `/__hui/bots/${encodeURIComponent(botId)}/triggers${trigger ? `/${encodeURIComponent(trigger)}` : ""}${action ? `/${action}` : ""}`;

export type BotTriggersApi = {
  list(botId: string): Promise<BotTriggersList>;
  create(botId: string, input: BotTriggerInput): Promise<BotTriggerCreated>;
  update(botId: string, triggerId: string, patch: BotTriggerPatch): Promise<BotTrigger>;
  remove(botId: string, triggerId: string): Promise<void>;
  test(botId: string, triggerId: string): Promise<BotTriggerRun>;
  rotate(botId: string, triggerId: string): Promise<BotTriggerCreated>;
  copy(text: string): Promise<boolean>;
  /** The page's origin, which a webhook or listener URL starts with. */
  origin(): string;
};

const API: BotTriggersApi = {
  list: async (botId) => parseTriggersList(await fetchJson<unknown>(triggersUrl(botId))),
  create: async (botId, input) => parseCreated(await fetchJson<unknown>(triggersUrl(botId), { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input), signal: AbortSignal.timeout(30_000) })),
  update: async (botId, triggerId, patch) => {
    const body = await fetchJson<unknown>(triggersUrl(botId, triggerId), { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch), signal: AbortSignal.timeout(30_000) });
    const trigger = isRecord(body) ? parseTrigger(body["trigger"]) : undefined;
    if (!trigger) throw new Error("The trigger did not come back.");
    return trigger;
  },
  remove: async (botId, triggerId) => {
    await fetchJson<unknown>(triggersUrl(botId, triggerId), { method: "DELETE", signal: AbortSignal.timeout(30_000) });
  },
  test: async (botId, triggerId) => {
    const body = await fetchJson<unknown>(triggersUrl(botId, triggerId, "test"), { method: "POST", headers: JSON_HEADERS, body: "{}", signal: AbortSignal.timeout(90_000) });
    const run = isRecord(body) ? parseRun(body["run"]) : undefined;
    if (!run) throw new Error("The test's run did not come back.");
    return run;
  },
  rotate: async (botId, triggerId) => parseCreated(await fetchJson<unknown>(triggersUrl(botId, triggerId, "token"), { method: "POST", headers: JSON_HEADERS, body: "{}", signal: AbortSignal.timeout(30_000) })),
  copy: (text) => writeClipboardText(text),
  origin: () => (typeof location === "undefined" ? "" : location.origin),
};

/* ── the add form ────────────────────────────────────────────────────── */

/** A form the gateway would refuse anyway, refused with what to fix before a request. */
export class TriggerFormError extends Error {
  override name = "TriggerFormError";
}

/** Comma- or space-separated entries, trimmed. */
export function splitEntries(text: string): string[] {
  return text.split(/[\s,]+/u).map((entry) => entry.trim()).filter(Boolean);
}

export type TriggerFormFields = {
  name: string;
  source: string;
  prompt: string;
  cooldown: string;
  repos: string;
  githubEvents: readonly string[];
  authors: string;
  labels: string;
  base: string;
  pulls: string;
  draft: string;
  sessionEvents: readonly string[];
  matchField: string;
  matchOp: string;
  matchValue: string;
  slackEvents: readonly string[];
  slackPrLinks: boolean;
  slackFrom: string;
  slackIn: string;
  slackExternal: boolean;
  slackBots: boolean;
  listenerField: string;
  listenerOp: string;
  listenerValue: string;
  listenerPrLinks: boolean;
  listenerExternal: boolean;
  listenerBots: boolean;
};

/** The form's Review requests preset: mentions and DMs that link a GitHub pull request, reviewed from the delivery. */
export const REVIEW_REQUESTS_PRESET = {
  name: "Reviews",
  events: ["mention", "dm"] as readonly SlackTriggerEvent[],
  prLinks: true,
  prompt: "Someone asked me to review this pull request. Review it from the details below: what it changes, what could break, and the comments you'd leave. Don't run commands or change anything; tell me here.",
};

/** The add form's fields as a `POST /__hui/bots/:id/triggers` body. */
export function triggerFormInput(fields: TriggerFormFields): BotTriggerInput {
  const name = fields.name.trim();
  if (!name) throw new TriggerFormError("Name the trigger.");
  if (/[[\]·]/u.test(name)) throw new TriggerFormError("A trigger's name can't hold [, ] or ·.");
  const source = BOT_TRIGGER_SOURCES.find((candidate) => candidate === fields.source);
  if (!source) throw new TriggerFormError("Choose what the trigger watches.");
  const cooldown = Number(fields.cooldown);
  const base = {
    name,
    ...(fields.prompt.trim() ? { prompt: fields.prompt.trim() } : {}),
    cooldownSeconds: Number.isInteger(cooldown) && cooldown >= 0 ? cooldown : BOT_TRIGGER_LIMITS.cooldownDefault,
  };
  if (source === "github") {
    const repos = splitEntries(fields.repos).map((repo) => repo.replace(/^https?:\/\/(?:www\.)?github\.com\//iu, "").replace(/\.git$/u, "").replace(/\/+$/u, ""));
    if (!repos.length) throw new TriggerFormError("Name at least one repo, as owner/name.");
    const bad = repos.find((repo) => !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/u.test(repo));
    if (bad) throw new TriggerFormError(`${bad} is not a repo: write owner/name.`);
    const events = GITHUB_TRIGGER_EVENTS.filter((event) => fields.githubEvents.includes(event));
    if (!events.length) throw new TriggerFormError("Choose at least one GitHub event.");
    const pulls = splitEntries(fields.pulls).map((value) => Number(value.replace(/^#/u, "")));
    if (pulls.some((value) => !Number.isInteger(value) || value < 1)) throw new TriggerFormError("Pull requests are numbers, such as 12 or #12.");
    const authors = splitEntries(fields.authors).map((login) => login.replace(/^@/u, ""));
    const labels = fields.labels.split(",").map((label) => label.trim()).filter(Boolean);
    const branches = splitEntries(fields.base);
    return {
      ...base, source,
      filter: {
        repos, events,
        ...(authors.length ? { authors } : {}),
        ...(labels.length ? { labels } : {}),
        ...(branches.length ? { base: branches } : {}),
        ...(pulls.length ? { pullRequests: pulls } : {}),
        ...(fields.draft === "drafts" ? { draft: true } : fields.draft === "ready" ? { draft: false } : {}),
      },
    };
  }
  if (source === "session") {
    const events = SESSION_TRIGGER_EVENTS.filter((event) => fields.sessionEvents.includes(event));
    if (!events.length) throw new TriggerFormError("Choose at least one session event.");
    return { ...base, source, filter: { events } };
  }
  if (source === "slack") {
    const events = SLACK_TRIGGER_EVENTS.filter((event) => fields.slackEvents.includes(event));
    if (!events.length) throw new TriggerFormError("Choose mentions, direct messages or both.");
    const from = fields.slackFrom.split(",").map((person) => person.trim().replace(/^@/u, "")).filter(Boolean);
    const channels = splitEntries(fields.slackIn).map((channel) => channel.replace(/^#/u, ""));
    return {
      ...base, source,
      filter: {
        events,
        ...(fields.slackPrLinks ? { prLinks: true as const } : {}),
        ...(from.length ? { from } : {}),
        ...(channels.length ? { in: channels } : {}),
        ...(fields.slackExternal ? { external: true as const } : {}),
        ...(fields.slackBots ? { bots: true as const } : {}),
      },
    };
  }
  if (source === "listener") {
    const value = fields.listenerValue.trim();
    return {
      ...base, source,
      filter: {
        ...(value ? { match: { field: fields.listenerField.trim(), op: fields.listenerOp === "contains" ? "contains" as const : "equals" as const, value } } : {}),
        ...(fields.listenerPrLinks ? { prLinks: true as const } : {}),
        ...(fields.listenerExternal ? { external: true as const } : {}),
        ...(fields.listenerBots ? { bots: true as const } : {}),
      },
    };
  }
  const value = fields.matchValue.trim();
  if (!value) return { ...base, source, filter: {} };
  const op = fields.matchOp === "contains" ? "contains" : "equals";
  return { ...base, source, filter: { match: { field: fields.matchField.trim(), op, value } } };
}

/* ── the section's state ─────────────────────────────────────────────── */

export type RevealedHook = { triggerId: string; name: string; source: BotTriggerSource; url: string; copied: boolean };

export type BotTriggersState = {
  botId: string;
  loading: boolean;
  error: string;
  list?: BotTriggersList;
  /** A change on its way: every control waits for it. */
  pending: boolean;
  actionError: string;
  formError: string;
  /** A note after a test: how its run went. */
  notice: string;
  /** A webhook or listener trigger's URL, shown once after it was made or replaced. */
  revealed?: RevealedHook;
};

export type BotTriggersActions = {
  /** Resolves true once the gateway accepted it, so the form clears only then. */
  onCreate: (input: BotTriggerInput) => Promise<boolean>;
  onFormError: (message: string) => void;
  onToggle: (trigger: BotTrigger, enabled: boolean) => void;
  onTest: (trigger: BotTrigger) => void;
  onDelete: (trigger: BotTrigger) => void;
  onRotate: (trigger: BotTrigger) => void;
  onCopy: () => void;
  onDismissUrl: () => void;
  onRetry: () => void;
};

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const EMPTY: Omit<BotTriggersState, "botId"> = { loading: false, error: "", pending: false, actionError: "", formError: "", notice: "" };

export class BotTriggersController implements ReactiveController {
  state: BotTriggersState = { botId: "", ...EMPTY };
  readonly #host: ReactiveControllerHost;
  readonly #api: BotTriggersApi;
  readonly #visible: () => boolean;
  #request = 0;
  #timer?: ReturnType<typeof setInterval>;
  #watched?: BotView;
  /** The bot and its chat's status when `follow` last looked. */
  #followed = "";

  /** `visible`: whether the section still shows; the timer stops by itself once it doesn't. */
  constructor(host: ReactiveControllerHost, options: { api?: BotTriggersApi; visible?: () => boolean } = {}) {
    this.#host = host;
    this.#api = options.api ?? API;
    this.#visible = options.visible ?? (() => true);
    host.addController(this);
  }

  hostConnected(): void {}

  hostDisconnected(): void {
    this.sync(undefined);
  }

  #set(next: Partial<BotTriggersState>): void {
    this.state = { ...this.state, ...next };
    this.#host.requestUpdate();
  }

  /** Another bot: nothing of the last one stays, its revealed URL least of all. */
  reset(botId: string): void {
    this.#request += 1;
    this.state = { botId, ...EMPTY };
    this.#host.requestUpdate();
  }

  /** The section shows for `bot` (read now, then every few seconds) or no longer shows (undefined). */
  sync(bot: BotView | undefined): void {
    if (!bot) {
      if (this.#timer) clearInterval(this.#timer);
      this.#timer = undefined;
      this.#watched = undefined;
      return;
    }
    const changed = this.#watched?.id !== bot.id;
    this.#watched = bot;
    if (changed || !this.#timer) {
      void this.refresh(bot);
      if (!this.#timer) {
        this.#timer = setInterval(() => {
          if (!this.#visible()) this.sync(undefined);
          else if (this.#watched && !this.state.pending) void this.refresh(this.#watched);
        }, TRIGGERS_POLL_MS);
      }
    }
  }

  /** From the bots stream while the section shows: starts reading once the bot is known, and reads again when its chat
   * changes state (a trigger may just have woken it). */
  follow(bot: BotView): void {
    const key = `${bot.id}|${bot.status}`;
    if (this.#watched?.id !== bot.id || !this.#timer) {
      this.#followed = key;
      this.sync(bot);
      return;
    }
    this.#watched = bot;
    if (key === this.#followed) return;
    this.#followed = key;
    if (!this.state.pending) void this.refresh(bot);
  }

  /** Reads the triggers; a failed read keeps what was shown. */
  async refresh(bot: BotView): Promise<void> {
    if (this.state.botId !== bot.id) this.reset(bot.id);
    const request = ++this.#request;
    this.#set({ loading: true });
    try {
      const list = await this.#api.list(bot.id);
      if (request !== this.#request) return;
      this.#set({ loading: false, error: "", list });
    } catch (error) {
      if (request !== this.#request) return;
      this.#set({ loading: false, error: errorText(error, "Could not read the bot's triggers.") });
    }
  }

  async #act(bot: BotView, work: () => Promise<Partial<BotTriggersState> | void>, surface: "form" | "action", fallback: string): Promise<boolean> {
    if (this.state.pending) return false;
    this.#set({ pending: true, actionError: "", formError: "", notice: "" });
    try {
      const next = await work();
      this.#set({ pending: false, ...(next ?? {}) });
      await this.refresh(bot);
      return true;
    } catch (error) {
      this.#set({ pending: false, ...(surface === "form" ? { formError: errorText(error, fallback) } : { actionError: errorText(error, fallback) }) });
      return false;
    }
  }

  #reveal(created: BotTriggerCreated): Partial<BotTriggersState> {
    return created.hook ? { revealed: { triggerId: created.trigger.id, name: created.trigger.name, source: created.trigger.source, url: `${this.#api.origin()}${created.hook.path}`, copied: false } } : {};
  }

  props(bot: BotView): { state: BotTriggersState } & BotTriggersActions {
    const state = this.state.botId === bot.id ? this.state : { botId: bot.id, ...EMPTY, loading: true };
    return {
      state,
      onCreate: (input) => this.#act(bot, async () => this.#reveal(await this.#api.create(bot.id, input)), "form", "Could not add the trigger."),
      onFormError: (message) => { this.#set({ formError: message }); },
      onToggle: (trigger, enabled) => { void this.#act(bot, async () => { await this.#api.update(bot.id, trigger.id, { enabled }); }, "action", "Could not switch the trigger."); },
      onTest: (trigger) => {
        void this.#act(bot, async () => {
          const run = await this.#api.test(bot.id, trigger.id);
          return { notice: run.status === "fired" ? `Sent a test event to ${bot.name}'s chat.` : `The test did not reach ${bot.name}: ${run.reason ?? run.status}.` };
        }, "action", "Could not test the trigger.");
      },
      onDelete: (trigger) => {
        void this.#act(bot, async () => {
          await this.#api.remove(bot.id, trigger.id);
          return this.state.revealed?.triggerId === trigger.id ? { revealed: undefined } : {};
        }, "action", "Could not delete the trigger.");
      },
      onRotate: (trigger) => { void this.#act(bot, async () => this.#reveal(await this.#api.rotate(bot.id, trigger.id)), "action", "Could not replace the URL."); },
      onCopy: () => {
        const revealed = this.state.revealed;
        if (!revealed) return;
        void this.#api.copy(revealed.url).then((copied) => {
          if (this.state.revealed?.url === revealed.url) this.#set({ revealed: { ...revealed, copied } });
        });
      },
      onDismissUrl: () => { this.#set({ revealed: undefined }); },
      onRetry: () => { void this.refresh(bot); },
    };
  }
}
