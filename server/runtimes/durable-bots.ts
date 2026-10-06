/**
 * Bots in Pi Durable (HUI-18): the document that marks a conversation as a
 * bot's chat, the `bots` prompt section and the `message_bot` tool only those
 * chats get.
 *
 * The section's extension is in every gateway's default selection and renders
 * nothing without the conversation's `hui.bot` document. The tool lives in an
 * extension of its own that only a bot's chat selects
 * (`DurableSession.applyTools`), and refuses anywhere else; every other
 * conversation's tools, prompt and stored agent stay exactly as they were.
 */
import type { Context } from "@earendil-works/chord";
import {
  defineDoc, defineEntry, defineExtension, defineTool, section,
  type ConversationId, type DocumentReader, type Extension, type ToolRegistration,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { BOT_LIMITS } from "../../shared/bots.ts";
import type { CallRecord } from "../../shared/calls.ts";

/** The bot a conversation is the chat of; `bot` stays empty for every other conversation. A fork stays the bot's. */
export const BotDoc = defineDoc<{ bot: string }>({
  kind: "hui.bot",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ bot: "" }),
});

/**
 * The record of one GPT-Live call with the bot (HUI-18): its summary and its whole transcript (`CallRecord`), written
 * once at hang-up as a passive entry, so no model turn runs for it. It carries no model messages: the chat shows it
 * as one card, OptChat logs it (its transcript and summary, marked `[call]`), and Durable places it at a running
 * turn's next boundary.
 */
export const CallEntry = defineEntry<CallRecord>("hui.call");

export const MESSAGE_BOT_TOOL = "message_bot";

/** What `message_bot` adds to HUI's active-tool section; the `bots` section explains the rest. */
export const BOT_TOOL_CONTRIBUTIONS: Record<string, { snippet: string; guidelines: readonly string[] }> = {
  [MESSAGE_BOT_TOOL]: { snippet: "Message another bot of this HUI in its own chat", guidelines: [] },
};

/** The bot whose chat this conversation is; undefined for every other conversation. */
export async function conversationBot(reader: DocumentReader, conversationId: ConversationId, context: Context): Promise<string | undefined> {
  return (await reader.snapshot(BotDoc, conversationId, context))?.bot || undefined;
}

export type BotsExtensionOptions = {
  /** HUI's agent-tool handler, called as the conversation's bound HUI session. */
  invoke(conversationId: ConversationId, action: string, params: Record<string, unknown>): Promise<unknown>;
  /** The `bots` section of one bot's chat; undefined leaves it out. Byte-stable while the roster is unchanged. */
  section(botId: string): Promise<string | undefined>;
};

/** `section`: global, inert outside bots' chats. `tools`: installed, selected by bots' chats only. */
export function huiBotsExtensions(options: BotsExtensionOptions): { section: Extension; tools: Extension } {
  const messageBot: ToolRegistration = defineTool({
    name: MESSAGE_BOT_TOOL,
    description: "Send a message to another bot of this HUI. It arrives in that bot's own chat, marked with your handle, and the bot answers there: nothing comes back to you by itself.",
    parameters: Type.Object({
      to: Type.String({ minLength: 1, maxLength: 100, description: "The bot's handle (@handle) or its exact name." }),
      message: Type.String({ minLength: 1, maxLength: BOT_LIMITS.message }),
    }),
    // A delivered message cannot be taken back: an interrupted call is reported to the model, never sent twice.
    replay: "unsafe",
    execute: async (args, api, context) => {
      try {
        if (!await conversationBot(api, api.conversationId, context)) throw new Error("message_bot is only available in a bot's chat.");
        const result = await options.invoke(api.conversationId, MESSAGE_BOT_TOOL, { to: args.to, message: args.message });
        const text = typeof result === "object" && result !== null && typeof (result as { text?: unknown }).text === "string"
          ? (result as { text: string }).text
          : "Sent.";
        return { content: [{ type: "text", text }] };
      } catch (error) {
        if (context.abortSignal?.aborted) throw error;
        // A refusal (unknown bot, hop limit, rate limit) is the model's to read and act on.
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    },
  });
  return {
    section: defineExtension({
      name: "hui-bots",
      sections: [section("bots", async (input, context) => {
        const bot = await conversationBot(input.read, input.conversationId, context);
        // A roster HUI cannot read (a broken bots.json) leaves the section out; it never fails the request.
        return bot ? await options.section(bot).catch(() => undefined) : undefined;
      })],
    }),
    tools: defineExtension({ name: "hui-bots-tools", tools: [messageBot] }),
  };
}
