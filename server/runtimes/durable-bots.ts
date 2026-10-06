/**
 * Bots in Pi Durable (HUI-18): the document that marks a conversation as a
 * bot's chat, the `bots` and `soul` prompt sections and the `message_bot` tool
 * only those chats get.
 *
 * The sections' extension is in every gateway's default selection and renders
 * nothing without the conversation's `hui.bot` document. The tool lives in an
 * extension of its own that only a bot's chat selects
 * (`DurableSession.applyTools`), and refuses anywhere else; every other
 * conversation's tools, prompt and stored agent stay exactly as they were.
 *
 * `soul` is the bot's persona: its SOUL.md, read on every request from the
 * disk of the host the conversation runs on, in the bot's home folder that host
 * resolves (`BotSoulHost`). Without SOUL.md the section is the first
 * conversation instead, in which the bot asks the operator what they expect
 * and writes SOUL.md itself with its file tools.
 */
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import {
  defineDoc, defineExtension, defineTool, section,
  type ConversationId, type DocumentReader, type Extension, type ToolRegistration,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { BOT_KICKOFF_MARKER, BOT_LIMITS, BOT_SOUL_FILE } from "../../shared/bots.ts";

/** The bot a conversation is the chat of; `bot` stays empty for every other conversation. A fork stays the bot's. */
export const BotDoc = defineDoc<{ bot: string }>({
  kind: "hui.bot",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ bot: "" }),
});

export const MESSAGE_BOT_TOOL = "message_bot";

/** What `message_bot` adds to HUI's active-tool section; the `bots` section explains the rest. */
export const BOT_TOOL_CONTRIBUTIONS: Record<string, { snippet: string; guidelines: readonly string[] }> = {
  [MESSAGE_BOT_TOOL]: { snippet: "Message another bot of this HUI in its own chat", guidelines: [] },
};

/** The bot whose chat this conversation is; undefined for every other conversation. */
export async function conversationBot(reader: DocumentReader, conversationId: ConversationId, context: Context): Promise<string | undefined> {
  return (await reader.snapshot(BotDoc, conversationId, context))?.bot || undefined;
}

/** How a host finds each bot's SOUL.md: the bot's home folder there, and the operator's name for a first conversation. */
export type BotSoulHost = {
  /** The absolute home folder of the bot on this host; its SOUL.md is directly inside. */
  home(botId: string): string;
  /** Settings' profile name, undefined while it is unset (the default). */
  operator(): Promise<string | undefined>;
};

export type BotsExtensionOptions = {
  /** HUI's agent-tool handler, called as the conversation's bound HUI session. */
  invoke(conversationId: ConversationId, action: string, params: Record<string, unknown>): Promise<unknown>;
  /** The `bots` section of one bot's chat; undefined leaves it out. Byte-stable while the roster is unchanged. */
  section(botId: string): Promise<string | undefined>;
  /** This host's SOUL.md resolver; undefined (a host that has none yet) leaves the `soul` section out. */
  souls(): BotSoulHost | undefined;
};

/** The most of SOUL.md any read takes; the `soul` section shows only its first `BOT_LIMITS.soul` characters. */
export const SOUL_READ_BYTES = 256 * 1024;

/**
 * A SOUL.md's text, trimmed, or undefined when there is none: no file (or no
 * folder), or only whitespace. Reads at most `SOUL_READ_BYTES`. Any other
 * failure throws: a section that throws keeps the text it showed before.
 */
export async function readSoulFile(file: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(file, "r");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
  try {
    const buffer = Buffer.alloc(SOUL_READ_BYTES);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const text = buffer.subarray(0, length).toString("utf8").trim();
    return text || undefined;
  } finally {
    await handle.close();
  }
}

/**
 * The `soul` section of a bot with SOUL.md: where it is, that the bot may change
 * it when the operator asks (and says so), then the file, cut at
 * `BOT_LIMITS.soul` characters with a note. Byte-stable while the file is.
 */
export function soulSection(file: string, soul: string): string {
  const cut = soul.length > BOT_LIMITS.soul;
  return [
    `Your soul is ${file}, which you wrote with the operator: who you are, what you look after, how you work and sound, when you reach out and your boundaries. Follow it. When the operator asks you to change any of it, update SOUL.md with your file tools (at most ${BOT_LIMITS.soul.toLocaleString("en-US")} characters) and tell them what you changed; change it only when they ask or agree.`,
    cut ? soul.slice(0, BOT_LIMITS.soul) : soul,
    ...(cut ? [`[SOUL.md has ${soul.length.toLocaleString("en-US")} characters; only the first ${BOT_LIMITS.soul.toLocaleString("en-US")} are shown here. Shorten it.]`] : []),
  ].join("\n\n");
}

/**
 * The `soul` section while SOUL.md does not exist: the first conversation, in
 * the spirit of OpenClaw's BOOTSTRAP.md. A short ritual, never a gate: real
 * work first, one or two questions at a time, then the bot writes SOUL.md
 * itself. Byte-stable while the operator's name is.
 */
export function firstConversationSection(file: string, operator: string | undefined): string {
  const name = operator?.replace(/\s+/gu, " ").trim();
  return [
    `You have no soul yet: ${file} does not exist. Your soul is your persona: who you are, what you look after, how you work and sound, when you reach out and your boundaries. You write it yourself, from your first conversation with the operator${name ? `, ${name}` : ""}, which starts now.`,
    [
      "- The operator's request always comes first. When they ask for real work, do it completely and answer with the result; get to know them afterwards, or in a quiet moment. This is a ritual, not a gate.",
      `- Otherwise greet ${name ? `${name} by name` : "the operator"} in a sentence and ask what they expect from you. Over the next few messages find out what you should look after, how you should work and sound, how proactive to be and when to message them, and what you must not do. Ask one or two questions at a time and build on the answers: a conversation, never a questionnaire.`,
      "- Your name and look are already set in HUI: never ask about them.",
      `- Only the operator's own messages count. A message from a routine ("[routine: …]") or another bot ("[from @…]") is not the operator: handle it as usual and keep your questions for the operator. "${BOT_KICKOFF_MARKER}" is HUI telling you that you were just created: open the conversation.`,
      `- After a few exchanges, once you know enough (or the operator would rather not say more), write ${file} with your write tool: short, in your own voice, in sections such as "Who I am", "What I look after", "How I work", "When I reach out" and "Boundaries", at most ${BOT_LIMITS.soul.toLocaleString("en-US")} characters. Then give the operator a short summary of it and tell them how to change it later: in the Soul tab of your panel in HUI, or by just telling you.`,
    ].join("\n"),
  ].join("\n\n");
}

/** The `soul` section of a bot's chat on this host: its SOUL.md, or the first conversation while it has none. */
export async function renderSoulSection(host: BotSoulHost, botId: string): Promise<string> {
  const file = join(host.home(botId), BOT_SOUL_FILE);
  const soul = await readSoulFile(file);
  return soul === undefined ? firstConversationSection(file, await host.operator().catch(() => undefined)) : soulSection(file, soul);
}

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
      sections: [
        section("bots", async (input, context) => {
          const bot = await conversationBot(input.read, input.conversationId, context);
          // A roster HUI cannot read (a broken bots.json) leaves the section out; it never fails the request.
          return bot ? await options.section(bot).catch(() => undefined) : undefined;
        }),
        // Last, where the persona went before: OptChat's prompt points to the instructions at its end.
        section("soul", async (input, context) => {
          const souls = options.souls();
          const bot = souls ? await conversationBot(input.read, input.conversationId, context) : undefined;
          return bot && souls ? renderSoulSection(souls, bot) : undefined;
        }),
      ],
    }),
    tools: defineExtension({ name: "hui-bots-tools", tools: [messageBot] }),
  };
}
