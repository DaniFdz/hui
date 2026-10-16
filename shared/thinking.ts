/** Reasoning levels HUI accepts for a session, cheapest first: PI's own list,
 * then HUI's `ultra` (OpenClaw's): the model's highest level plus the
 * instruction to plan, hand independent work to subagents and verify, which
 * only Durable sessions carry. A model may support only some of them
 * (`RuntimeModel.thinkingLevels`). Labels are what the composer and bot
 * settings show. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** The levels PI itself has: every one but `ultra`. */
export const PI_THINKING_LEVELS = THINKING_LEVELS.filter((level) => level !== "ultra");

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
  ultra: "Ultra",
};

export function isThinkingLevel(level: string): level is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(level);
}
