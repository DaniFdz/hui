/**
 * A bot's Tools tab (HUI-18): what the operator can turn off in the bot's chat,
 * what is off, and an access request waiting for them. Everything is on until
 * the operator turns it off; each change is a `PATCH /__hui/bots/:id` with the
 * whole list, and applies from the chat's next request. The tab reads
 * `GET /__hui/bots/:id/catalog` when it opens and again when the bots stream
 * shows the bot changed (a grant in its chat, a request that waits).
 *
 * `BotToolsController` keeps the tab's state outside `hui-app.ts`, so the tab
 * is self-contained: the app makes one, refreshes it when the tab shows, lets
 * it follow the stream, and passes `props(bot)` to the view.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import {
  BOT_ACCESS_ANSWERS,
  type BotAccessRequest, type BotCatalog, type BotCatalogSkill, type BotCatalogTool, type BotSkillRef, type BotToolGroup, type BotView,
} from "../../shared/bots.ts";
import { updateBot } from "./bots.ts";
import { answerQuestion } from "./sessions-store.ts";
import { fetchJson } from "./settings-store.ts";

/** Skills a tab shows before it offers a search. */
export const SKILL_SEARCH_MIN = 8;
/** Reading the catalog may start the bot's chat first. */
const CATALOG_TIMEOUT_MS = 30_000;

export type BotAccessAnswer = (typeof BOT_ACCESS_ANSWERS)[number];

/* ── catalog ─────────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const GROUPS: readonly BotToolGroup[] = ["files", "shell", "hui", "extension", "bots"];

function parseSkillRef(value: unknown): BotSkillRef | undefined {
  return isRecord(value) && str(value["name"]) && str(value["path"]) ? { name: str(value["name"]), path: str(value["path"]) } : undefined;
}

/** `GET /__hui/bots/:id/catalog`, narrowed: entries that don't validate are left out. */
export function parseBotCatalog(body: unknown): BotCatalog {
  if (!isRecord(body) || !Array.isArray(body["tools"]) || !Array.isArray(body["skills"])) throw new Error("The bot's tools did not come back.");
  const tools: BotCatalogTool[] = body["tools"].flatMap((raw) => {
    if (!isRecord(raw) || !str(raw["name"])) return [];
    const group = GROUPS.find((candidate) => candidate === raw["group"]) ?? "extension";
    return [{
      name: str(raw["name"]), label: str(raw["label"]) || str(raw["name"]), description: str(raw["description"]),
      group, source: str(raw["source"]), powerful: raw["powerful"] === true, enabled: raw["enabled"] !== false,
    }];
  });
  const skills: BotCatalogSkill[] = body["skills"].flatMap((raw) => {
    const ref = parseSkillRef(raw);
    return ref && isRecord(raw) ? [{ ...ref, description: str(raw["description"]), source: str(raw["source"]), enabled: raw["enabled"] !== false }] : [];
  });
  const request = isRecord(body["request"]) && str(body["request"]["id"]) && str(body["request"]["sessionId"])
    ? { id: str(body["request"]["id"]), sessionId: str(body["request"]["sessionId"]), title: str(body["request"]["title"]), message: str(body["request"]["message"]) } satisfies BotAccessRequest
    : undefined;
  return {
    tools,
    skills,
    alwaysOn: Array.isArray(body["alwaysOn"]) ? body["alwaysOn"].flatMap((raw) => isRecord(raw) && str(raw["name"]) ? [{ name: str(raw["name"]), description: str(raw["description"]) }] : []) : [],
    disabledTools: Array.isArray(body["disabledTools"]) ? body["disabledTools"].filter((name): name is string => typeof name === "string") : [],
    disabledSkills: Array.isArray(body["disabledSkills"]) ? body["disabledSkills"].flatMap((raw) => parseSkillRef(raw) ?? []) : [],
    live: body["live"] === true,
    ...(request ? { request } : {}),
  };
}

export async function loadBotCatalog(id: string): Promise<BotCatalog> {
  return parseBotCatalog(await fetchJson<unknown>(`/__hui/bots/${encodeURIComponent(id)}/catalog`, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) }));
}

/* ── what the tab shows ──────────────────────────────────────────────── */

export type BotToolsGroup = { key: string; title: string; source?: string; tools: BotCatalogTool[] };

const GROUP_TITLES: Record<Exclude<BotToolGroup, "extension">, string> = { files: "Files", shell: "Shell", hui: "HUI", bots: "Bots" };

/** Files, Shell, HUI, one group per extension source, then Bots; tools keep their offer order inside each. */
export function groupBotTools(tools: readonly BotCatalogTool[]): BotToolsGroup[] {
  const groups: BotToolsGroup[] = [];
  for (const group of GROUPS) {
    if (group !== "extension") {
      const members = tools.filter((tool) => tool.group === group);
      if (members.length) groups.push({ key: group, title: GROUP_TITLES[group], tools: members });
      continue;
    }
    const sources = [...new Set(tools.filter((tool) => tool.group === "extension").map((tool) => tool.source))];
    for (const source of sources) {
      groups.push({ key: `extension:${source}`, title: "Extension", source, tools: tools.filter((tool) => tool.group === "extension" && tool.source === source) });
    }
  }
  return groups;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Everything is on: 19 tools and 4 skills." or "2 of 19 tools and 1 of 4 skills are off." */
export function botToolsSummary(catalog: Pick<BotCatalog, "tools" | "skills">): string {
  const tools = catalog.tools.length;
  const skills = catalog.skills.length;
  const offTools = catalog.tools.filter((tool) => !tool.enabled).length;
  const offSkills = catalog.skills.filter((skill) => !skill.enabled).length;
  if (!offTools && !offSkills) return `Everything is on: ${count(tools, "tool")} and ${count(skills, "skill")}.`;
  const parts = [
    ...(offTools ? [`${offTools} of ${count(tools, "tool")}`] : []),
    ...(offSkills ? [`${offSkills} of ${count(skills, "skill")}`] : []),
  ];
  return `${parts.join(" and ")} ${offTools + offSkills === 1 ? "is" : "are"} off.`;
}

/** Skills whose name, description or source contain every word of `query`. */
export function matchingSkills(skills: readonly BotCatalogSkill[], query: string): BotCatalogSkill[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length) return [...skills];
  return skills.filter((skill) => {
    const haystack = `${skill.name} ${skill.description} ${skill.source}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

const sameSkill = (a: BotSkillRef, b: BotSkillRef) => a.name === b.name && a.path === b.path;

/** The whole `disabledTools` list after turning one tool on or off. */
export function toolsAfter(catalog: Pick<BotCatalog, "disabledTools">, name: string, enabled: boolean): string[] {
  const rest = catalog.disabledTools.filter((each) => each !== name);
  return enabled ? rest : [...rest, name];
}

/** The whole `disabledSkills` list after turning one skill on or off. */
export function skillsAfter(catalog: Pick<BotCatalog, "disabledSkills">, skill: BotSkillRef, enabled: boolean): BotSkillRef[] {
  const rest = catalog.disabledSkills.filter((each) => !sameSkill(each, skill));
  return enabled ? rest : [...rest, { name: skill.name, path: skill.path }];
}

/** What changes on the bots stream when the catalog may have: its chat waits on a question or moves on, or its record
 * (its lists) changed. */
export function botToolsKey(bot: Pick<BotView, "status" | "updatedAt">): string {
  return `${bot.status}|${bot.updatedAt}`;
}

/* ── the tab's state ─────────────────────────────────────────────────── */

export type BotToolsState = {
  botId: string;
  loading: boolean;
  error: string;
  catalog?: BotCatalog;
  /** A change on its way to the gateway: every switch waits for it, so no two lists race. */
  saving: boolean;
  saveError: string;
  answering: boolean;
  query: string;
};

export type BotToolsActions = {
  onToggleTool: (name: string, enabled: boolean) => void;
  onToggleSkill: (skill: BotSkillRef, enabled: boolean) => void;
  onSearch: (query: string) => void;
  onAnswer: (answer: BotAccessAnswer) => void;
  onRetry: () => void;
};

export type BotToolsApi = {
  load: (id: string) => Promise<BotCatalog>;
  save: (id: string, change: { disabledTools?: string[]; disabledSkills?: BotSkillRef[] }) => Promise<unknown>;
  answer: (sessionId: string, questionId: string, value: BotAccessAnswer) => Promise<void>;
};

const API: BotToolsApi = {
  load: loadBotCatalog,
  save: (id, change) => updateBot(id, change),
  answer: (sessionId, questionId, value) => answerQuestion(sessionId, questionId, { value }),
};

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** The Tools tab's state and actions, for one bot at a time. */
export class BotToolsController implements ReactiveController {
  state: BotToolsState = { botId: "", loading: false, error: "", saving: false, saveError: "", answering: false, query: "" };
  readonly #host: ReactiveControllerHost;
  readonly #api: BotToolsApi;
  #request = 0;
  /** `botToolsKey` of the bot when the catalog was last read. */
  #seen = "";

  constructor(host: ReactiveControllerHost, api: BotToolsApi = API) {
    this.#host = host;
    this.#api = api;
    host.addController(this);
  }

  hostConnected(): void {}

  #set(next: Partial<BotToolsState>): void {
    this.state = { ...this.state, ...next };
    this.#host.requestUpdate();
  }

  /** Another bot: nothing of the last one stays. */
  reset(botId: string): void {
    this.#request += 1;
    this.#seen = "";
    this.state = { botId, loading: false, error: "", saving: false, saveError: "", answering: false, query: "" };
    this.#host.requestUpdate();
  }

  /** Reads the catalog; a failed read keeps what was shown. */
  async refresh(bot: BotView): Promise<void> {
    if (this.state.botId !== bot.id) this.reset(bot.id);
    const request = ++this.#request;
    this.#seen = botToolsKey(bot);
    this.#set({ loading: true });
    try {
      const catalog = await this.#api.load(bot.id);
      if (request !== this.#request) return;
      this.#set({ loading: false, error: "", catalog });
    } catch (error) {
      if (request !== this.#request) return;
      this.#set({ loading: false, error: errorText(error, "Could not read the bot's tools.") });
    }
  }

  /** From the bots stream: read again once the bot changed in a way the catalog shows. */
  follow(bot: BotView): void {
    if (this.state.botId !== bot.id || this.state.saving) return;
    if (botToolsKey(bot) !== this.#seen) void this.refresh(bot);
  }

  async #save(bot: BotView, change: { disabledTools?: string[]; disabledSkills?: BotSkillRef[] }): Promise<void> {
    if (this.state.saving || !this.state.catalog) return;
    this.#set({ saving: true, saveError: "" });
    try {
      await this.#api.save(bot.id, change);
      this.#set({ saving: false });
      await this.refresh(bot);
    } catch (error) {
      this.#set({ saving: false, saveError: errorText(error, "Could not change the bot's tools.") });
    }
  }

  async #answer(bot: BotView, value: BotAccessAnswer): Promise<void> {
    const request = this.state.catalog?.request;
    if (!request || this.state.answering) return;
    this.#set({ answering: true, saveError: "" });
    try {
      await this.#api.answer(request.sessionId, request.id, value);
      this.#set({ answering: false });
      await this.refresh(bot);
    } catch (error) {
      this.#set({ answering: false, saveError: errorText(error, "Could not answer the request.") });
    }
  }

  /** The tab's view state and callbacks for `bot`. */
  props(bot: BotView): { state: BotToolsState } & BotToolsActions {
    const state = this.state.botId === bot.id ? this.state : { ...this.state, botId: bot.id, loading: true, catalog: undefined, error: "" };
    return {
      state,
      onToggleTool: (name, enabled) => {
        const catalog = this.state.catalog;
        if (catalog) void this.#save(bot, { disabledTools: toolsAfter(catalog, name, enabled) });
      },
      onToggleSkill: (skill, enabled) => {
        const catalog = this.state.catalog;
        if (catalog) void this.#save(bot, { disabledSkills: skillsAfter(catalog, skill, enabled) });
      },
      onSearch: (query) => { this.#set({ query }); },
      onAnswer: (value) => { void this.#answer(bot, value); },
      onRetry: () => { void this.refresh(bot); },
    };
  }
}
