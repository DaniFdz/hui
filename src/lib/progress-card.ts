/** Formats the Task progress card HUI's utility model keeps for a session, as the sidebar hovercard shows it. */
import type { ProgressCard, ProgressStep } from "../api/schema/sessions.ts";
export type { ProgressCard, ProgressStep } from "../api/schema/sessions.ts";
export type ProgressStepStatus = ProgressStep["status"];

/** Compact sidebar label; only explicit plan state supplies a count. */
export function progressCardSummary(card: ProgressCard): { label: string; count: string } {
  const completed = card.steps.filter((step) => step.status === "completed").length;
  const current = card.steps.find((step) => step.status === "in_progress")
    ?? card.steps.find((step) => step.status === "pending");
  return {
    label: current?.step ?? (card.steps.length ? "Completed" : "Agent notes"),
    count: card.steps.length ? `${completed}/${card.steps.length}` : "",
  };
}
