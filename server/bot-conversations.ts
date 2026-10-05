/**
 * The Durable side of bots' chats (HUI-18): creating a bot's conversation in
 * one commit with its agent, its `hui.bot` document and OptChat; changing its
 * instructions or directory; the model and thinking level a new chat would get;
 * and reading its newest message while no session has it loaded. The gateway
 * is the store's only writer, so these run in it.
 */
import { clampThinkingLevel, type Message, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { ResetEntry, SystemEntry, type Conversation, type EntryRecord } from "@earendil-works/pi-durable";
import { previewLine } from "../shared/bots.ts";
import type { BotMemory } from "./bot-memory.ts";
import type { BotConversations, BotStoredMessage } from "./bot-service.ts";
import { BotInputError, BotNotFoundError } from "./bots.ts";
import { BotDoc } from "./runtimes/durable-bots.ts";
import { ExtensionMessageEntry, isCustomInput } from "./runtimes/durable-extensions.ts";
import { durableContext, type DurableHost } from "./runtimes/durable-host.ts";
import { defaultThinking, durableConversationId, durableReference, initialModel, modelRef, textOf } from "./runtimes/durable.ts";
import { restoreAttachmentNames } from "./runtimes/pi.ts";

/** Entries a cold read looks back through for the newest message. */
const LAST_MESSAGE_ENTRIES = 50;

export function durableBotConversations(host: DurableHost, memory: BotMemory): BotConversations {
  const conversation = async (reference: string): Promise<Conversation> => {
    const id = durableConversationId(reference);
    const found = id === undefined ? undefined : await (await host.open()).conversation(id, durableContext);
    if (!found) throw new BotNotFoundError("This bot's conversation is not in this gateway's Durable store.");
    return found;
  };
  const checkModel = async (value: string): Promise<void> => {
    await host.open();
    await host.refreshModels();
    const ref = modelRef(value);
    if (!ref || !host.models.getModel(ref.provider, ref.modelId)) throw new BotInputError(`Unknown model: ${value}`);
  };
  return {
    checkModel,

    async create(input) {
      const harness = await host.open();
      if (input.model) await checkModel(input.model);
      else await host.refreshModels();
      if (input.memory.model) await checkModel(input.memory.model);
      const model = await initialModel(host, input.cwd, input.model);
      const known = model ? host.models.getModel(model.provider, model.modelId) : undefined;
      const thinking = input.thinking ?? defaultThinking(host, input.cwd);
      // One commit: no prompt can reach the chat before its persona, its bot document and its memory are in place.
      const created = await harness.createConversation({
        ownership: { kind: "ownerless" },
        agent: {
          cwd: input.cwd,
          ...(model ? { model } : {}),
          ...(thinking && known ? { thinkingLevel: clampThinkingLevel(known, thinking as ModelThinkingLevel) } : {}),
          ...(input.instructions ? { instructions: input.instructions } : {}),
        },
        init: async (tx, conversationId) => {
          const doc = await tx.doc(BotDoc, conversationId);
          doc.bot = input.botId;
          await memory.enable(tx, conversationId, input.memory);
        },
      }, durableContext);
      return durableReference(created.id);
    },

    async configure(reference, change) {
      await (await conversation(reference)).configure({
        ...(change.instructions !== undefined ? { instructions: change.instructions } : {}),
        ...(change.cwd !== undefined ? { cwd: change.cwd } : {}),
      }, durableContext);
    },

    // As `startDurable` chooses them for a new conversation.
    async defaultModel(cwd) {
      await host.open();
      await host.refreshModels();
      const model = await initialModel(host, cwd, undefined);
      return model ? `${model.provider}/${model.modelId}` : undefined;
    },

    async defaultThinking(cwd, model) {
      await host.open();
      const ref = modelRef(model);
      const known = ref ? host.models.getModel(ref.provider, ref.modelId) : undefined;
      const requested = defaultThinking(host, cwd);
      // A new conversation without a level stored runs at Durable's "off".
      return requested && known ? clampThinkingLevel(known, requested as ModelThinkingLevel) : "off";
    },

    async lastMessage(reference) {
      const page = await (await conversation(reference)).entries({}, LAST_MESSAGE_ENTRIES, undefined, durableContext);
      // Newest first; a reset starts a new context the transcript shows from.
      for (const entry of page.items) {
        if (ResetEntry.is(entry)) return undefined;
        const message = shownMessage(entry);
        if (message) return message;
      }
      return undefined;
    },
  };
}

/** The newest user or assistant text an entry shows in the transcript, as the transcript projects it. */
function shownMessage(entry: EntryRecord): BotStoredMessage | undefined {
  if (SystemEntry.is(entry) || ExtensionMessageEntry.is(entry)) return undefined;
  for (const message of [...entry.model ?? []].reverse() as Message[]) {
    if ((message.role !== "user" && message.role !== "assistant") || isCustomInput(message)) continue;
    const raw = textOf(message);
    const text = previewLine(message.role === "user" ? restoreAttachmentNames(raw).text : raw);
    if (!text) continue;
    const timestamp = (message as { timestamp?: unknown }).timestamp;
    return {
      role: message.role,
      text,
      ...(typeof timestamp === "number" && Number.isFinite(timestamp) ? { at: new Date(timestamp).toISOString() } : {}),
    };
  }
  return undefined;
}
