/**
 * `/__hui/bots/:id/triggers` routes (HUI-18); see docs/api.md#triggers. `:id` is a bot's id or handle, `:trigger` a
 * trigger's id or name (URL-encoded).
 *
 *   GET    /__hui/bots/:id/triggers                  BotTriggersList: the bot's triggers, their latest runs, the cap
 *   POST   /__hui/bots/:id/triggers                  201 BotTriggerCreated (a webhook trigger's token, this once)
 *   PATCH  /__hui/bots/:id/triggers/:trigger         { trigger }
 *   DELETE /__hui/bots/:id/triggers/:trigger         { ok: true }
 *   POST   /__hui/bots/:id/triggers/:trigger/test    { run }: a sample event, delivered now
 *   POST   /__hui/bots/:id/triggers/:trigger/token   BotTriggerCreated: a webhook trigger's new token, this once
 *
 * They live under `/__hui/bots`, so the `x-hui` guard and the 409 while bots are off apply as to every bot route.
 * The webhook route itself, `POST /__hui/hooks/<token>`, is `bot-triggers-gateway.ts`'s.
 */
import { BOT_TRIGGER_LIMITS } from "../shared/bot-triggers.ts";
import type { BotTriggerService } from "./bot-triggers.ts";
import { TriggerConflictError, TriggerInputError, TriggerNotFoundError } from "./bot-triggers-input.ts";
import { TriggerStoreError } from "./bot-triggers-store.ts";
import { BotConflictError, BotInputError, BotNotFoundError, BotsOffError, BotStoreError } from "./bots.ts";

export const BOT_TRIGGERS_ROUTE = /^\/__hui\/bots\/([A-Za-z0-9_-]{1,100})\/triggers(?:\/([^/]{1,400})(?:\/(test|token))?)?$/u;
const BODY_BYTES = 64 * 1024;

export type TriggerRouteRequest = {
  method: string;
  path: string;
  /** The JSON body, at most `maxBytes`. */
  body(maxBytes: number): Promise<unknown>;
};

/** 400 for input, 404 for an unknown bot or trigger, 409 for a state that refuses it (bots off included), 500 for storage. */
export function triggerErrorStatus(error: unknown): number {
  if (error instanceof TriggerInputError || error instanceof BotInputError || error instanceof SyntaxError) return 400;
  if (error instanceof TriggerNotFoundError || error instanceof BotNotFoundError) return 404;
  if (error instanceof TriggerConflictError || error instanceof BotConflictError || error instanceof BotsOffError) return 409;
  if (error instanceof TriggerStoreError || error instanceof BotStoreError) return 500;
  return 500;
}

export function createBotTriggerRoutes(deps: { service: Pick<BotTriggerService, "list" | "create" | "update" | "remove" | "test" | "rotate"> }) {
  const { service } = deps;

  async function json(request: TriggerRouteRequest): Promise<unknown> {
    try {
      return await request.body(BODY_BYTES);
    } catch (error) {
      throw new TriggerInputError(error instanceof SyntaxError ? "The request body must be JSON." : `The request body is larger than ${BODY_BYTES / 1024} KiB.`);
    }
  }

  async function handle(request: TriggerRouteRequest): Promise<{ status: number; body: unknown } | undefined> {
    const match = BOT_TRIGGERS_ROUTE.exec(request.path);
    if (!match) return undefined;
    const [, bot, encoded, action] = match;
    const notAllowed = { status: 405, body: { error: "method not allowed" } };
    try {
      if (!encoded) {
        if (request.method === "GET") return { status: 200, body: await service.list(bot!) };
        if (request.method === "POST") return { status: 201, body: await service.create(bot!, await json(request)) };
        return notAllowed;
      }
      let trigger: string;
      try {
        trigger = decodeURIComponent(encoded);
      } catch {
        throw new TriggerInputError("The trigger in the path is not valid URL encoding.");
      }
      if (!trigger.trim() || trigger.length > Math.max(100, BOT_TRIGGER_LIMITS.name)) throw new TriggerInputError("Name the trigger by its id or name.");
      if (action) {
        if (request.method !== "POST") return notAllowed;
        return action === "test"
          ? { status: 200, body: { run: await service.test(bot!, trigger) } }
          : { status: 200, body: await service.rotate(bot!, trigger) };
      }
      if (request.method === "PATCH") return { status: 200, body: { trigger: await service.update(bot!, trigger, await json(request)) } };
      if (request.method === "DELETE") {
        await service.remove(bot!, trigger);
        return { status: 200, body: { ok: true } };
      }
      return notAllowed;
    } catch (error) {
      const status = triggerErrorStatus(error);
      return { status, body: { error: status === 500 && !(error instanceof TriggerStoreError || error instanceof BotStoreError) ? "The trigger request failed." : error instanceof Error ? error.message : "The trigger request failed." } };
    }
  }

  return { handle };
}
