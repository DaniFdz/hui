/**
 * The one place bots touch OptChat (PR 1's memory engine for Pi Durable).
 *
 * Bots never reach the engine, its files or its Durable document directly:
 * everything goes through `BotMemory`, so the bot lifecycle is tested with a
 * fake and the real adapter stays a thin mapping onto OptChat's manager.
 * Conversations are named by their HUI resume reference (`durable:<id>`).
 *
 * Until OptChat is wired into this build, `unavailableBotMemory` stands in: a
 * bot's chat is then a plain Durable conversation (Durable compacts it as any
 * other), its view reports no `memory` and the memory routes answer 503.
 */
import type { ConversationId, Tx } from "@earendil-works/pi-durable";
import type { BotMemoryStatus } from "../shared/bots.ts";

/** OptChat settings of one bot's chat: the agent name its prompts use, and the compactor's model. */
export type BotMemorySettings = {
  name: string;
  /** `provider/id`; absent: the conversation's own model. */
  model?: string;
  thinking?: string;
};

export interface BotMemory {
  /** False when this build has no OptChat: the memory routes answer 503 and views carry no `memory`. */
  readonly available: boolean;
  /** Turns OptChat on inside the commit that creates the bot's conversation, so no prompt reaches it first. */
  enable(tx: Tx, conversationId: ConversationId, settings: BotMemorySettings): Promise<void>;
  /** Changes the agent name or compactor model of an existing bot's memory. */
  configure(reference: string, settings: BotMemorySettings): Promise<void>;
  status(reference: string): Promise<BotMemoryStatus | undefined>;
  /** The rendered current view, `<chat>…</chat>`. */
  view(reference: string): Promise<string>;
  /** OptChat's `zoom(id, n)` output, its own errors included as text. */
  zoom(reference: string, id: number, n: number): Promise<string>;
  /** The self-contained browse page. */
  html(reference: string): Promise<string>;
  /** Status changes of one memory, for live views. */
  subscribe(reference: string, listener: (status: BotMemoryStatus) => void): () => void;
}

/** The memory routes answer 503 with this message. */
export class BotMemoryUnavailableError extends Error {
  override name = "BotMemoryUnavailableError";
  constructor(message = "OptChat memory is not available in this build of HUI.") {
    super(message);
  }
}

/** This build's adapter until OptChat lands: nothing to enable, nothing to read. */
export const unavailableBotMemory: BotMemory = {
  available: false,
  enable: async () => {},
  configure: async () => {},
  status: async () => undefined,
  view: async () => { throw new BotMemoryUnavailableError(); },
  zoom: async () => { throw new BotMemoryUnavailableError(); },
  html: async () => { throw new BotMemoryUnavailableError(); },
  subscribe: () => () => {},
};
