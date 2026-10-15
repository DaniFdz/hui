/** Reasoning levels HUI accepts for a session, cheapest first: PI's own list,
 * with the labels the composer and bot settings show. A model may support only
 * some of them (`RuntimeModel.thinkingLevels`). */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export function isThinkingLevel(level: string): level is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(level);
}

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
};
