/** The explicit-memory page's state and the actions its view calls; `controllers/bot-facts-controller.ts` keeps them
 * as the server confirms them. */
import type { BotFact, BotFactInput } from "../../../shared/bot-facts.ts";
export type BotFactsState = { botId: string; facts: BotFact[]; loading: boolean; loaded: boolean; pending: boolean; error: string; editing?: BotFact; removing?: BotFact };
export type BotFactsActions = {
  load(botId: string, force?: boolean): Promise<void>;
  edit(fact?: BotFact): void;
  remove(fact?: BotFact): void;
  save(input: BotFactInput): Promise<boolean>;
  pin(fact: BotFact): Promise<boolean>;
  confirmDelete(): Promise<boolean>;
};
