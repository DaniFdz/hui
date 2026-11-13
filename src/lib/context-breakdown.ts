/** The context meter's breakdown: how a session's context splits between its system prompt, its tool definitions, the
 * conversation and the summaries compaction left, as shares of the total the runtime reported. */
import type { ContextUsagePart } from "../api/schema/session-events.ts";

export type ContextBreakdownRow = {
  id: ContextUsagePart["id"];
  label: string;
  tokens: number;
  percent: number;
  detail?: string;
};

const LABELS: Record<ContextUsagePart["id"], string> = {
  system: "System prompt",
  tools: "Tool definitions",
  conversation: "Conversation",
  summary: "Summarized conversation",
};

/**
 * The rows to draw, in the runtime's order. The runtime's parts are estimates of each kind of content, so they are
 * fitted to the total it reported by rounding where each part's share ends, one part at a time: the rows then add up to
 * the figure the meter shows. Each share is of the window, or of the total when the context holds more than the window,
 * which is what the bar draws. A part with no tokens is left out.
 */
export function contextBreakdown(parts: readonly ContextUsagePart[], total: number, window: number): ContextBreakdownRow[] {
  const shown = parts.filter((part) => part.tokens > 0);
  const estimated = shown.reduce((sum, part) => sum + part.tokens, 0);
  if (!estimated || !(total > 0)) return [];
  let fitted = 0;
  let seen = 0;
  return shown.map((part) => {
    seen += part.tokens;
    const upTo = Math.round((seen / estimated) * total);
    const tokens = Math.max(0, upTo - fitted);
    fitted += tokens;
    return {
      id: part.id,
      label: LABELS[part.id],
      tokens,
      percent: (tokens / Math.max(total, window)) * 100,
      ...(part.count === undefined ? {} : { detail: part.id === "tools" ? `${part.count.toLocaleString()} tools` : `${part.count.toLocaleString()} messages` }),
    };
  });
}
