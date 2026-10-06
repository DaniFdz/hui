/**
 * Client half of the bots API (`/__hui/bots`, owned by `server/`; the contract
 * is in `docs/api.md`). A bot is a named agent with one permanent chat: its
 * session is an ordinary HUI session whose view carries `bot`, so the chat
 * itself reuses the session API and only roster, settings and memory live here.
 *
 * Responses are normalized on the way in, like settings: a malformed or newer
 * record is skipped or narrowed rather than reaching the roster as `undefined`.
 */
import { botLook, isBotFaceShape, type BotAvatar, type BotAvatarPatch, type BotFaceShape, type BotInput, type BotMemoryStatus, type BotMemoryUsage, type BotPatch, type BotSessionStatus, type BotsUpdate, type BotView, type BotVoice } from "../../shared/bots.ts";
import { gptLiveVoice } from "../../shared/calls.ts";
import { voiceLanguage, voiceProfileId, voiceSpeed } from "../../shared/voice.ts";
import { CLIENT_HEADERS, fetchJson } from "./settings-store.ts";
import { decodeSseFrame, reconnectDelay, STATUS_STREAM_STALL_MS, type SessionGroup, type SessionView } from "./sessions-store.ts";
import { trackedFetch } from "./ui-errors.ts";

export type { BotAvatar, BotInput, BotMemoryStatus, BotMemoryUsage, BotPatch, BotsUpdate, BotView } from "../../shared/bots.ts";

const BOTS_URL = "/__hui/bots";
const BOTS_EVENTS_URL = "/__hui/bots/events";
/** Creating a bot starts its session and memory before the gateway answers. */
const CREATE_BOT_TIMEOUT_MS = 60_000;

export type BotMemory = { status: BotMemoryStatus; view: string };

/** The New/Edit dialog as typed. Empty model fields mean the default: the
 * gateway's model, the default thinking level, the bot's own model for memory.
 * The persona is not here: the bot writes its SOUL.md in its first conversation. */
export type BotDraft = {
  name: string;
  title: string;
  /** Empty: a private folder the gateway creates for the bot. */
  cwd: string;
  emoji: string;
  /** The dialog's Look: "face" sends the shape and color and clears the emoji, "emoji" sends the emoji. Absent: the
   * emoji decides, as before faces. */
  look?: "face" | "emoji";
  shape?: BotFaceShape;
  /** #rrggbb */
  color?: string;
  model: string;
  thinking: string;
  memoryModel: string;
  /** A VoiceStudio voice id ("" for VoiceStudio's default) and speed; absent while VoiceStudio is not connected. */
  voice?: string;
  voiceSpeed?: number;
  /** A language code ("" for Auto); absent while neither VoiceStudio nor GPT-Live calls are on. */
  voiceLanguage?: string;
  /** A GPT-Live call voice ("" for Settings' default); absent while calls do not use GPT-Live. */
  callVoice?: string;
};

/** OptChat's view budget: the memory panel reports sizes against it. */
export const BOT_MEMORY_BUDGET_BYTES = 128_000;

const SESSION_STATUSES: readonly BotSessionStatus[] = ["idle", "running", "waiting", "starting", "error", "reconnecting", "disconnected"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum = 20_000): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function optionalText(value: unknown, maximum = 20_000): string | undefined {
  return text(value, maximum) || undefined;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** A provider-reported amount such as a cost in USD: finite, never negative. */
function amount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function parseAvatar(value: unknown): BotAvatar | undefined {
  if (!isRecord(value)) return undefined;
  const emoji = optionalText(value["emoji"], 32);
  const color = typeof value["color"] === "string" && /^#[0-9a-f]{6}$/iu.test(value["color"].trim())
    ? value["color"].trim().toLowerCase()
    : undefined;
  const shape = isBotFaceShape(value["shape"]) ? value["shape"] : undefined;
  return emoji || color || shape ? { ...(emoji ? { emoji } : {}), ...(color ? { color } : {}), ...(shape ? { shape } : {}) } : undefined;
}

/** The compactor's spend; a gateway that reports none spent nothing it can show. */
function parseBotMemoryUsage(value: unknown): BotMemoryUsage {
  const usage = isRecord(value) ? value : {};
  return {
    calls: count(usage["calls"]),
    input: count(usage["input"]),
    output: count(usage["output"]),
    cacheRead: count(usage["cacheRead"]),
    cacheWrite: count(usage["cacheWrite"]),
    cost: amount(usage["cost"]),
  };
}

function parseVoice(value: unknown): BotVoice | undefined {
  if (!isRecord(value)) return undefined;
  const profile = voiceProfileId(value["profile"]);
  const speed = voiceSpeed(value["speed"]);
  const language = voiceLanguage(value["language"]);
  const live = gptLiveVoice(value["live"]);
  const voice: BotVoice = { ...(profile ? { profile } : {}), ...(speed !== undefined ? { speed } : {}), ...(language ? { language } : {}), ...(live ? { live } : {}) };
  return Object.keys(voice).length ? voice : undefined;
}

export function parseBotMemoryStatus(value: unknown): BotMemoryStatus | undefined {
  if (!isRecord(value)) return undefined;
  const failing = isRecord(value["failing"]) ? value["failing"] : undefined;
  const failingError = text(failing?.["error"], 2_000);
  return {
    messages: count(value["messages"]),
    built: count(value["built"]),
    pending: count(value["pending"]),
    viewBytes: count(value["viewBytes"]),
    viewLines: count(value["viewLines"]),
    ...(value["waiting"] === true ? { waiting: true } : {}),
    // A failure is shown only with its reason; node and time are details.
    ...(failingError ? { failing: { node: text(failing?.["node"], 200), error: failingError, since: text(failing?.["since"], 100) } } : {}),
    usage: parseBotMemoryUsage(value["usage"]),
  };
}

function parseLastMessage(value: unknown): BotView["lastMessage"] {
  if (!isRecord(value)) return undefined;
  const role = value["role"];
  const at = text(value["at"], 100);
  if ((role !== "user" && role !== "assistant") || !at) return undefined;
  // The gateway already sends one short line; keep the roster safe from a long one.
  return { role, text: text(value["text"], 400).replace(/\s+/gu, " "), at };
}

/** A bot record the roster can render, or undefined when it lacks identity. */
export function parseBot(value: unknown): BotView | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value["id"], 200);
  const name = text(value["name"], 200);
  const sessionId = text(value["sessionId"], 200);
  if (!id || !name || !sessionId) return undefined;
  const status = SESSION_STATUSES.find((candidate) => candidate === value["status"]) ?? "idle";
  const avatar = parseAvatar(value["avatar"]);
  const voice = parseVoice(value["voice"]);
  const lastMessage = parseLastMessage(value["lastMessage"]);
  const memory = parseBotMemoryStatus(value["memory"]);
  const optional: Partial<Record<"title" | "description" | "model" | "thinking" | "memoryModel" | "memoryThinking", string>> = {};
  for (const [key, maximum] of [["title", 200], ["description", 2_000], ["model", 200], ["thinking", 40], ["memoryModel", 200], ["memoryThinking", 40]] as const) {
    const entry = optionalText(value[key], maximum);
    if (entry) optional[key] = entry;
  }
  return {
    id,
    handle: text(value["handle"], 64),
    name,
    ...optional,
    cwd: text(value["cwd"], 4_096),
    ...(avatar ? { avatar } : {}),
    ...(voice ? { voice } : {}),
    ...(value["hidden"] === true ? { hidden: true } : {}),
    ...(value["archived"] === true ? { archived: true } : {}),
    sessionId,
    createdAt: text(value["createdAt"], 100),
    updatedAt: text(value["updatedAt"], 100),
    status,
    soul: value["soul"] === true,
    ...(lastMessage ? { lastMessage } : {}),
    unread: value["unread"] === true,
    ...(memory ? { memory } : {}),
    routines: count(value["routines"]),
  };
}

/** `{ bots: [...] }`; invalid entries are skipped and duplicate ids keep the first. */
export function parseBotList(body: unknown): BotView[] {
  const list = isRecord(body) && Array.isArray(body["bots"]) ? body["bots"] : [];
  const seen = new Set<string>();
  return list.flatMap((entry) => {
    const bot = parseBot(entry);
    if (!bot || seen.has(bot.id)) return [];
    seen.add(bot.id);
    return [bot];
  });
}

function parseBotBody(body: unknown, failure: string): BotView {
  const bot = isRecord(body) ? parseBot(body["bot"]) : undefined;
  if (!bot) throw new Error(failure);
  return bot;
}

export function parseBotMemory(body: unknown): BotMemory {
  const status = isRecord(body) ? parseBotMemoryStatus(body["status"]) : undefined;
  if (!status) throw new Error("The bot's memory status did not come back.");
  return { status, view: isRecord(body) && typeof body["view"] === "string" ? body["view"] : "" };
}

/* ── live list ────────────────────────────────────────────────────────────── */

/** Reads one frame of `GET /__hui/bots/events`: the complete list first, then
 * only the bots whose views changed; `ids` (every bot, in order) when that
 * changed. The stream includes archived bots; the roster leaves them out. */
export function parseBotsUpdate(payload: unknown): BotsUpdate | undefined {
  if (!isRecord(payload) || typeof payload["revision"] !== "number" || !Number.isFinite(payload["revision"])) return undefined;
  const ids = Array.isArray(payload["ids"]) ? payload["ids"].filter((id): id is string => typeof id === "string") : undefined;
  return { revision: payload["revision"], ...(ids ? { ids } : {}), upserts: parseBotList({ bots: payload["upserts"] }) };
}

/** Whether a stream frame says something the list has not seen. Every
 * (re)connect starts with the gateway's cached list: at the revision already
 * applied it replays what the list shows (older, even, once confirmed edits
 * landed on top), so it is not news. Any other first revision is newer, or
 * comes from a gateway that started again. Later frames only move forward. */
export function isNewBotsFrame(revision: number, first: boolean, applied: number): boolean {
  return first ? revision !== applied : revision > applied;
}

/** Changed bots replace their copies; `ids`, when present, is the whole list. */
export function applyBotsUpdate(bots: readonly BotView[], update: Pick<BotsUpdate, "ids" | "upserts">): BotView[] {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  for (const bot of update.upserts) byId.set(bot.id, bot);
  if (update.ids) return update.ids.flatMap((id) => byId.get(id) ?? []);
  const known = new Set(bots.map(({ id }) => id));
  return [...bots.map((bot) => byId.get(bot.id) ?? bot), ...update.upserts.filter((bot) => !known.has(bot.id))];
}

export type BotsStreamHandlers = {
  /** `first` marks the complete list each (re)connect starts with. */
  onUpdate: (update: BotsUpdate, first: boolean) => void;
  /** `unsupported`: the gateway has no bot stream (an older build); stop asking. */
  onConnection: (state: "live" | "reconnecting" | "unsupported") => void;
};

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Keeps the shared bot list current, reconnecting like the session status
 * stream (same backoff, same heartbeat stall). Returns the stop function. */
export function subscribeBots(handlers: BotsStreamHandlers, fetcher: typeof fetch = trackedFetch): () => void {
  const abort = new AbortController();
  void (async () => {
    let attempt = 0;
    while (!abort.signal.aborted) {
      const outcome = await connectBotsOnce(handlers, abort.signal, fetcher, () => { attempt = 0; });
      if (abort.signal.aborted) return;
      if (outcome === "unsupported") {
        handlers.onConnection("unsupported");
        return;
      }
      handlers.onConnection("reconnecting");
      attempt += 1;
      await waitFor(reconnectDelay(attempt), abort.signal);
    }
  })();
  return () => abort.abort();
}

async function connectBotsOnce(handlers: BotsStreamHandlers, signal: AbortSignal, fetcher: typeof fetch, onLive: () => void): Promise<"dropped" | "unsupported"> {
  let response: Response;
  try {
    response = await fetcher(BOTS_EVENTS_URL, { headers: { ...CLIENT_HEADERS, accept: "text/event-stream" }, cache: "no-store", signal });
  } catch {
    return "dropped";
  }
  if (!response.ok || !response.body) return response.status === 404 || response.status === 405 ? "unsupported" : "dropped";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let first = true;
  let stall: ReturnType<typeof setTimeout> | undefined;
  try {
    for (;;) {
      clearTimeout(stall);
      stall = setTimeout(() => void reader.cancel(), STATUS_STREAM_STALL_MS);
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let at: number;
      while ((at = buffer.indexOf("\n\n")) !== -1) {
        const frame = decodeSseFrame(buffer.slice(0, at));
        buffer = buffer.slice(at + 2);
        const update = frame?.name === "bots" ? parseBotsUpdate(frame.payload) : undefined;
        if (!update) continue;
        if (first) {
          onLive();
          handlers.onConnection("live");
        }
        handlers.onUpdate(update, first);
        first = false;
      }
    }
  } catch {
    return "dropped";
  } finally {
    clearTimeout(stall);
  }
  return "dropped";
}

/* ── dialog drafts ────────────────────────────────────────────────────────── */

/** Create payload: trimmed, with empty optional fields left to the gateway's defaults. */
export function botInputFromDraft(draft: BotDraft): BotInput {
  const optional = (value: string) => value.trim() || undefined;
  const entries = {
    title: optional(draft.title),
    cwd: optional(draft.cwd),
    model: optional(draft.model),
    thinking: optional(draft.thinking),
    memoryModel: optional(draft.memoryModel),
  };
  const avatar = draftAvatar(draft);
  const voice = draftVoice(draft);
  return {
    name: draft.name.trim(),
    ...Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined)),
    ...(avatar ? { avatar } : {}),
    ...(voice ? { voice } : {}),
  };
}

function draftLook(draft: BotDraft): "face" | "emoji" {
  return draft.look ?? (draft.emoji.trim() ? "emoji" : "face");
}

/** A new bot keeps the look its dialog showed: the shape and color picked (or preselected), and the emoji in Emoji. */
function draftAvatar(draft: BotDraft): BotAvatar | undefined {
  const emoji = draft.emoji.trim();
  const avatar: BotAvatar = {
    ...(draftLook(draft) === "emoji" && emoji ? { emoji } : {}),
    ...(draft.color && /^#[0-9a-f]{6}$/iu.test(draft.color) ? { color: draft.color.toLowerCase() } : {}),
    ...(draft.shape && isBotFaceShape(draft.shape) ? { shape: draft.shape } : {}),
  };
  return Object.keys(avatar).length ? avatar : undefined;
}

/** The dialog's voice: a chosen voice id, a speed other than 1×, a language and a call voice; nothing for the defaults. */
function draftVoice(draft: BotDraft): BotVoice | undefined {
  const profile = draft.voice?.trim() ?? "";
  const speed = draft.voiceSpeed !== undefined && draft.voiceSpeed !== 1 ? voiceSpeed(draft.voiceSpeed) : undefined;
  const language = voiceLanguage(draft.voiceLanguage);
  const live = gptLiveVoice(draft.callVoice);
  const voice: BotVoice = { ...(profile ? { profile } : {}), ...(speed !== undefined ? { speed } : {}), ...(language ? { language } : {}), ...(live ? { live } : {}) };
  return Object.keys(voice).length ? voice : undefined;
}

/** Edit payload: only what changed, so an untouched workspace never trips the
 * gateway's "only while idle" rule. An emptied field clears: the title goes,
 * the memory model goes back to the bot's own, and an empty
 * model or thinking level ("Gateway default") puts the chat back on what a new
 * chat gets. An avatar key set to "" clears that key: Face clears the emoji, and
 * a shape or color is sent only when it differs from what the bot shows now
 * (its own, or the one its id picks). */
export function botPatchFromDraft(bot: BotView, draft: BotDraft): BotPatch {
  const patch: BotPatch = {};
  const name = draft.name.trim();
  if (name && name !== bot.name) patch.name = name;
  for (const key of ["title", "model", "thinking", "memoryModel"] as const) {
    const value = draft[key].trim();
    if (value !== (bot[key] ?? "")) patch[key] = value;
  }
  const cwd = draft.cwd.trim();
  if (cwd && cwd !== bot.cwd) patch.cwd = cwd;
  const avatar = avatarPatch(bot, draft);
  if (avatar) patch.avatar = avatar;
  // Each part of the voice changes only while the dialog showed it: VoiceStudio's voice and speed while it is
  // connected, the language while VoiceStudio or GPT-Live calls are on, the call voice while calls use GPT-Live.
  const voice: NonNullable<BotPatch["voice"]> = {};
  if (draft.voice !== undefined) {
    const profile = draft.voice.trim();
    const speed = draft.voiceSpeed ?? 1;
    if (profile !== (bot.voice?.profile ?? "")) voice.profile = profile;
    if (speed !== (bot.voice?.speed ?? 1)) voice.speed = speed === 1 ? null : speed;
  }
  // Auto ("") clears the language; a draft without one leaves it alone.
  const language = draft.voiceLanguage === undefined ? undefined : voiceLanguage(draft.voiceLanguage) ?? "";
  if (language !== undefined && language !== (bot.voice?.language ?? "")) voice.language = language;
  // "Default" ("") follows Settings → Models → Calls.
  const live = draft.callVoice === undefined ? undefined : gptLiveVoice(draft.callVoice) ?? "";
  if (live !== undefined && live !== (bot.voice?.live ?? "")) voice.live = live;
  if (Object.keys(voice).length) patch.voice = voice;
  return patch;
}

function avatarPatch(bot: BotView, draft: BotDraft): BotAvatarPatch | undefined {
  const patch: BotAvatarPatch = {};
  const emoji = draftLook(draft) === "emoji" ? draft.emoji.trim() : "";
  if (emoji !== (bot.avatar?.emoji ?? "")) patch.emoji = emoji;
  const look = botLook(bot);
  if (draft.shape && isBotFaceShape(draft.shape) && draft.shape !== look.shape) patch.shape = draft.shape;
  const color = draft.color?.toLowerCase();
  if (color && /^#[0-9a-f]{6}$/u.test(color) && color !== look.color) patch.color = color;
  return Object.keys(patch).length ? patch : undefined;
}

/** Puts a confirmed bot record in place of its old copy, or adds it. */
export function upsertBot(bots: readonly BotView[], bot: BotView): BotView[] {
  return bots.some(({ id }) => id === bot.id) ? bots.map((entry) => entry.id === bot.id ? bot : entry) : [...bots, bot];
}

/* ── session lists ────────────────────────────────────────────────────────── */

export function isBotSession(session: Pick<SessionView, "bot">): boolean {
  return Boolean(session.bot);
}

/** Bot chats live in the Bots tab, never in session lists, search, the board
 * or session pickers. Configured groups stay even when emptied, as they would
 * without the bot; OTHER exists only for listed sessions, so it goes when bot
 * chats were all it held. Groups without bot chats keep their identity. */
export function withoutBotSessions(groups: readonly SessionGroup[]): SessionGroup[] {
  return groups.flatMap((group) => {
    if (!group.sessions.some(isBotSession)) return [group];
    const sessions = group.sessions.filter((session) => !isBotSession(session));
    return sessions.length || (group.label && group.label !== "ungrouped") ? [{ ...group, sessions }] : [];
  });
}

/* ── requests ─────────────────────────────────────────────────────────────── */

const JSON_HEADERS = { "content-type": "application/json" } as const;

function botUrl(id: string, suffix = ""): string {
  return `${BOTS_URL}/${encodeURIComponent(id)}${suffix}`;
}

/** Every bot, archived ones included, as the events stream lists them (the
 * route answers active and archived bots separately). */
export async function loadBots(): Promise<BotView[]> {
  const [active, archived] = await Promise.all([fetchJson<unknown>(BOTS_URL), fetchJson<unknown>(`${BOTS_URL}?archived=1`)]);
  const entries = (body: unknown): unknown[] => isRecord(body) && Array.isArray(body["bots"]) ? body["bots"] : [];
  return parseBotList({ bots: [...entries(active), ...entries(archived)] });
}

/** Resolves only once the gateway created the bot, its chat and its memory. */
export async function createBot(input: BotInput): Promise<BotView> {
  return parseBotBody(await fetchJson<unknown>(BOTS_URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(CREATE_BOT_TIMEOUT_MS),
  }), "The bot was created but could not be read back.");
}

export async function updateBot(id: string, patch: BotPatch): Promise<BotView> {
  return parseBotBody(await fetchJson<unknown>(botUrl(id), {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(30_000),
  }), "The bot's change did not come back.");
}

/** Archives: the gateway keeps the chat and memory and disables its routines. */
export async function archiveBot(id: string): Promise<BotView> {
  return parseBotBody(await fetchJson<unknown>(botUrl(id), { method: "DELETE", signal: AbortSignal.timeout(30_000) }),
    "The archived bot did not come back.");
}

export async function restoreBot(id: string): Promise<BotView> {
  return parseBotBody(await fetchJson<unknown>(botUrl(id, "/restore"), { method: "POST", headers: JSON_HEADERS, body: "{}" }),
    "The restored bot did not come back.");
}

/** Deletes an archived bot for good: its routines and chat go from HUI; its files stay. */
export async function deleteBot(id: string): Promise<void> {
  await fetchJson<unknown>(botUrl(id, "?permanent=1"), { method: "DELETE", signal: AbortSignal.timeout(30_000) });
}

/**
 * What says the bot's SOUL.md may have changed, for the open Soul tab: its soul flag (the bot wrote it), its
 * `updatedAt` (HUI wrote it) and its latest message (a turn settled, in which the bot may have rewritten it).
 */
export function botSoulKey(bot: Pick<BotView, "soul" | "updatedAt" | "lastMessage">): string {
  return `${bot.soul ? "soul" : "none"}|${bot.updatedAt}|${bot.lastMessage?.at ?? ""}`;
}

/** SOUL.md's text from `GET`/`PUT …/soul`, or null while the bot has none (its first conversation). */
export function parseBotSoul(body: unknown): string | null {
  const soul = isRecord(body) ? body["soul"] : undefined;
  if (soul === null) return null;
  if (typeof soul !== "string") throw new Error("The bot's soul did not come back.");
  return soul.trim() ? soul : null;
}

export async function loadBotSoul(id: string): Promise<string | null> {
  return parseBotSoul(await fetchJson<unknown>(botUrl(id, "/soul"), { signal: AbortSignal.timeout(10_000) }));
}

/** Replaces the bot's SOUL.md; `""` removes it, so the bot asks what you expect again at its next turn. Resolves with
 * what the gateway stored. */
export async function saveBotSoul(id: string, soul: string): Promise<string | null> {
  return parseBotSoul(await fetchJson<unknown>(botUrl(id, "/soul"), {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ soul }),
    signal: AbortSignal.timeout(30_000),
  }));
}

/** 503: the gateway cannot read this chat's memory (no OptChat for it, or a
 * store another process owns). Unlike a failed read, asking again on every
 * change cannot fix that; Retry still asks. */
export class BotMemoryUnavailableError extends Error {
  override name = "BotMemoryUnavailableError";
}

export async function loadBotMemory(id: string): Promise<BotMemory> {
  const response = await trackedFetch(botUrl(id, "/memory"), { headers: CLIENT_HEADERS, cache: "no-store", signal: AbortSignal.timeout(5000) });
  const body = await response.json().catch(() => undefined) as unknown;
  if (!response.ok) {
    const message = isRecord(body) && typeof body["error"] === "string" ? body["error"] : `The bot's memory returned HTTP ${response.status}.`;
    throw response.status === 503 ? new BotMemoryUnavailableError(message) : new Error(message);
  }
  return parseBotMemory(body);
}

/** One line of the view opened into its two halves, or a message whole (n = 1). */
export async function zoomBotMemory(id: string, line: { id: number; n: number }): Promise<string> {
  const body = await fetchJson<unknown>(botUrl(id, `/memory/zoom?id=${line.id}&n=${line.n}`));
  if (!isRecord(body) || typeof body["text"] !== "string") throw new Error("The memory line did not come back.");
  return body["text"];
}

/** OptChat's browse page. A link opens it: the gateway accepts a page load the
 * browser attests as same-origin, and serves it under a policy that runs,
 * loads and frames nothing (docs/api.md#bots). */
export function botMemoryPageUrl(id: string): string {
  return botUrl(id, "/memory/html");
}
