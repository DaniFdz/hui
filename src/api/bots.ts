/**
 * Client half of the bots API (`/__hui/bots`, owned by `server/`; the contract is in `docs/api.md`): reading the
 * roster, the live list stream, creating, editing, archiving, restoring and deleting a bot, and what it cost. Records are
 * normalized by src/lib/bots/bots.ts on the way in.
 */
import type { BotInput, BotPatch, BotUsageResponse, BotView } from "./schema/bots.ts";
import type { UsageTotals } from "./schema/diagnostics.ts";
import { isRecord, parseBot, parseBotList, parseBotsUpdate, type BotsStreamHandlers } from "../lib/bots/bots.ts";
import { CLIENT_HEADERS, fetchJson, trackedFetch } from "./request.ts";
import { readEventStream } from "./sessions.ts";
import { reconnectDelay } from "../lib/event-stream.ts";

const BOTS_URL = "/__hui/bots";

const BOTS_EVENTS_URL = "/__hui/bots/events";

/** Creating a bot starts its session and memory before the gateway answers. */
const CREATE_BOT_TIMEOUT_MS = 60_000;

function parseBotBody(body: unknown, failure: string): BotView {
  const bot = isRecord(body) ? parseBot(body["bot"]) : undefined;
  if (!bot) throw new Error(failure);
  return bot;
}

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
        handlers.onConnection(outcome);
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
  let first = true;
  try {
    await readEventStream(response.body, (frame) => {
      const update = frame.name === "bots" ? parseBotsUpdate(frame.payload) : undefined;
      if (!update) return;
      if (first) {
        onLive();
        handlers.onConnection("live");
      }
      handlers.onUpdate(update, first);
      first = false;
    });
  } catch {
    return "dropped";
  }
  return "dropped";
}

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

/** What a bot's chat and the subagents under it cost, per model. */
export async function loadBotUsage(id: string): Promise<UsageTotals> {
  return (await fetchJson<BotUsageResponse>(`${BOTS_URL}/${encodeURIComponent(id)}/usage`)).usage;
}
