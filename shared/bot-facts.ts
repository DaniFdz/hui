/** Explicit operator-owned bot knowledge, separate from the conversation's OptChat memory. */
export const BOT_FACT_KINDS = ["fact", "preference", "decision"] as const;
export type BotFactKind = (typeof BOT_FACT_KINDS)[number];
export const BOT_FACT_LIMITS = { count: 40, text: 500, source: 200 } as const;
export type BotFactInput = { kind: BotFactKind; text: string; source?: string; pinned?: boolean };
export type BotFact = {
  id: string;
  kind: BotFactKind;
  text: string;
  pinned: boolean;
  /** Always manual; never an inferred claim or a model attribution. */
  source: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
};
export type BotFactPatch = { kind?: BotFactKind; text?: string; pinned?: boolean; revision: number };
/** Pinned first, then newest saved; stable identity breaks timestamp ties. */
export function orderedBotFacts(facts: readonly BotFact[]): BotFact[] {
  return [...facts].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
