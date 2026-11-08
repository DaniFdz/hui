/** Browser client for a bot's Tools & skills catalog (`GET /__hui/bots/:id/catalog`) and its own skills, narrowed on
 * the way in. */
import type { BotCatalog } from "./schema/bots.ts";
import { parseBotCatalog } from "../lib/bots/tools.ts";
import { fetchJson } from "./request.ts";

/** Reading the catalog may start the bot's chat first. */
const CATALOG_TIMEOUT_MS = 30_000;
const JSON_HEADERS = { "content-type": "application/json" } as const;

export type BotOwnSkill = { name: string; text: string };

function parseOwnSkill(body: unknown, failure: string): BotOwnSkill {
  if (typeof body === "object" && body !== null && typeof (body as { name?: unknown }).name === "string" && typeof (body as { text?: unknown }).text === "string") {
    return { name: (body as { name: string }).name, text: (body as { text: string }).text };
  }
  throw new Error(failure);
}

export async function loadBotCatalog(id: string): Promise<BotCatalog> {
  return parseBotCatalog(await fetchJson<unknown>(`/__hui/bots/${encodeURIComponent(id)}/catalog`, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) }));
}

/** One of a bot's own skills, with the SKILL.md the operator edits. */
export async function loadBotSkill(id: string, name: string): Promise<BotOwnSkill> {
  return parseOwnSkill(await fetchJson<unknown>(`/__hui/bots/${encodeURIComponent(id)}/skills/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  }), "The skill did not come back.");
}

/** Replaces that SKILL.md; files beside it stay, and the frontmatter name must keep matching the folder. */
export async function saveBotSkill(id: string, name: string, text: string): Promise<BotOwnSkill> {
  return parseOwnSkill(await fetchJson<unknown>(`/__hui/bots/${encodeURIComponent(id)}/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  }), "The saved skill did not come back.");
}
