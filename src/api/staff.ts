/** Browser client for the staff pack's own route: the Chief of Staff for one custom session group. */
import type { BotView } from "./schema/bots.ts";
import { parseBot } from "../lib/bots/bots.ts";
import { CLIENT_HEADERS, fetchJson } from "./request.ts";

/** A chief is a bot creation, conversation and skills in one request, so it can take longer than a plain read. */
const CHIEF_TIMEOUT_MS = 120_000;

export async function createStaffChief(input: { group: string; cwd: string }): Promise<BotView> {
  const body = await fetchJson<unknown>("/__hui/staff/chiefs", {
    method: "POST",
    headers: { ...CLIENT_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(CHIEF_TIMEOUT_MS),
  });
  const bot = typeof body === "object" && body !== null ? parseBot((body as { bot?: unknown }).bot) : undefined;
  if (!bot) throw new Error("The chief did not come back.");
  return bot;
}
