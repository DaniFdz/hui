/**
 * A bot's triggers in the Bots tab (HUI-18): the list on its panel's overview and its Triggers page. It reads
 * `GET /__hui/bots/:id/triggers` while either shows (again every few seconds, since triggers fire on their own),
 * adds, switches, tests and deletes triggers through the trigger routes, and shows a trigger's URL, which its listener
 * reports to, once, right after it was made or replaced. `BotTriggersController` keeps that state outside `hui-app.ts`,
 * as the Tools & skills page's controller does; the view is `src/views/bot-triggers.ts`.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import {
  BOT_TRIGGER_LIMITS, BOT_TRIGGER_SOURCES,
  type BotTrigger, type BotTriggerCreated, type BotTriggerFilter, type BotTriggerInput, type BotTriggerPatch, type BotTriggerRun, type BotTriggerRunStatus, type BotTriggersList,
} from "../../shared/bot-triggers.ts";
import type { BotView } from "../../shared/bots.ts";
import { writeClipboardText } from "./clipboard.ts";
import { fetchJson } from "../api/request.ts";

/** How often the open section reads the triggers again: they fire on their own. */
export const TRIGGERS_POLL_MS = 5_000;
const JSON_HEADERS = { "content-type": "application/json" } as const;

/* ── reading ─────────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const RUN_STATUSES: readonly BotTriggerRunStatus[] = ["fired", "coalesced", "skipped", "failed"];

function parseFilter(raw: unknown): BotTriggerFilter {
  if (!isRecord(raw)) return {};
  const match = isRecord(raw["match"]) && (raw["match"]["op"] === "equals" || raw["match"]["op"] === "contains") && str(raw["match"]["value"])
    ? { field: str(raw["match"]["field"]), op: raw["match"]["op"] === "contains" ? "contains" as const : "equals" as const, value: str(raw["match"]["value"]) }
    : undefined;
  return {
    ...(match ? { match } : {}),
    ...(raw["prLinks"] === true ? { prLinks: true as const } : {}),
    ...(raw["external"] === true ? { external: true as const } : {}),
    ...(raw["bots"] === true ? { bots: true as const } : {}),
  };
}

/** One trigger as the routes return it, narrowed; undefined when it doesn't validate. */
export function parseTrigger(raw: unknown): BotTrigger | undefined {
  if (!isRecord(raw) || !str(raw["id"]) || !str(raw["name"]) || !str(raw["botId"])) return undefined;
  const source = BOT_TRIGGER_SOURCES.find((candidate) => candidate === raw["source"]);
  if (!source) return undefined;
  const pending = isRecord(raw["pending"]) && Number.isInteger(raw["pending"]["events"]) && str(raw["pending"]["until"])
    ? { events: raw["pending"]["events"] as number, until: str(raw["pending"]["until"]) }
    : undefined;
  const watch = isRecord(raw["watch"]) ? { ...(str(raw["watch"]["polledAt"]) ? { polledAt: str(raw["watch"]["polledAt"]) } : {}), ...(str(raw["watch"]["error"]) ? { error: str(raw["watch"]["error"]) } : {}) } : undefined;
  return {
    id: str(raw["id"]), botId: str(raw["botId"]), name: str(raw["name"]), source, filter: parseFilter(raw["filter"]),
    ...(str(raw["prompt"]) ? { prompt: str(raw["prompt"]) } : {}),
    ...(raw["delivery"] === "steer" || raw["delivery"] === "followUp" ? { delivery: raw["delivery"] } : {}),
    enabled: raw["enabled"] !== false,
    cooldownSeconds: Number.isInteger(raw["cooldownSeconds"]) ? raw["cooldownSeconds"] as number : BOT_TRIGGER_LIMITS.cooldownDefault,
    createdBy: raw["createdBy"] === "bot" ? "bot" : "operator",
    createdAt: str(raw["createdAt"]), updatedAt: str(raw["updatedAt"]),
    ...(str(raw["lastFiredAt"]) ? { lastFiredAt: str(raw["lastFiredAt"]) } : {}),
    ...(str(raw["tokenHint"]) ? { tokenHint: str(raw["tokenHint"]) } : {}),
    ...(pending ? { pending } : {}),
    ...(watch && Object.keys(watch).length ? { watch } : {}),
  };
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
  if (!hook) throw new Error("The trigger's URL did not come back.");
  return { trigger, hook };
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
  /** The page's origin, which a trigger's URL starts with. */
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

export type TriggerFormFields = {
  name: string;
  prompt: string;
  cooldown: string;
  matchField: string;
  matchOp: string;
  matchValue: string;
  prLinks: boolean;
  external: boolean;
  bots: boolean;
  steer?: boolean;
};

/** The add form's fields as a `POST /__hui/bots/:id/triggers` body. */
export function triggerFormInput(fields: TriggerFormFields): BotTriggerInput {
  const name = fields.name.trim();
  if (!name) throw new TriggerFormError("Name the trigger.");
  if (/[[\]·]/u.test(name)) throw new TriggerFormError("A trigger's name can't hold [, ] or ·.");
  const cooldown = Number(fields.cooldown);
  const value = fields.matchValue.trim();
  return {
    name, source: "listener",
    ...(fields.prompt.trim() ? { prompt: fields.prompt.trim() } : {}),
    ...(fields.steer ? { delivery: "steer" } : {}),
    cooldownSeconds: Number.isInteger(cooldown) && cooldown >= 0 ? cooldown : BOT_TRIGGER_LIMITS.cooldownDefault,
    filter: {
      ...(value ? { match: { field: fields.matchField.trim(), op: fields.matchOp === "contains" ? "contains" as const : "equals" as const, value } } : {}),
      ...(fields.prLinks ? { prLinks: true as const } : {}),
      ...(fields.external ? { external: true as const } : {}),
      ...(fields.bots ? { bots: true as const } : {}),
    },
  };
}

/* ── the section's state ─────────────────────────────────────────────── */

export type RevealedHook = { triggerId: string; name: string; url: string; copied: boolean };

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
  /** A trigger's URL, shown once after it was made or replaced. */
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
    return { revealed: { triggerId: created.trigger.id, name: created.trigger.name, url: `${this.#api.origin()}${created.hook.path}`, copied: false } };
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
