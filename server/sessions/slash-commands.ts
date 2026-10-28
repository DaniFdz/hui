/** Parsers for HUI's reserved session and update commands. */
export function parseUpdateCommand(text: string): "update" | "check" | "invalid" | null {
  const trimmed = text.trim();
  if (!/^\/update(?:\s|$)/u.test(trimmed)) return null;
  if (trimmed === "/update") return "update";
  if (/^\/update\s+--check$/u.test(trimmed)) return "check";
  return "invalid";
}

function parseBareCommand<Name extends string>(text: string, name: Name): Name | "invalid" | null {
  const trimmed = text.trim();
  if (!new RegExp(`^/${name}(?:\\s|$)`, "u").test(trimmed)) return null;
  return trimmed === `/${name}` ? name : "invalid";
}
export const parseClearCommand = (text: string) => parseBareCommand(text, "clear");
export const parseReloadCommand = (text: string) => parseBareCommand(text, "reload");

export function parseCompactCommand(text: string): { instructions?: string } | undefined {
  const match = /^\/compact(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (!match) return undefined;
  const instructions = match[1]?.trim();
  return instructions ? { instructions } : {};
}

export type GoalCommand = { action: "start"; objective: string } | { action: "pause" | "resume" | "clear" } | "usage";

/** `/goal <objective>` starts (or re-words) a goal; the three status actions are exact words so an objective that
 * begins with one still reads as an objective to the operator's eye. */
export function parseGoalCommand(text: string): GoalCommand | null {
  const trimmed = text.trim();
  if (!/^\/goal(?:\s|$)/u.test(trimmed)) return null;
  const rest = trimmed.slice("/goal".length).trim();
  if (!rest) return "usage";
  if (rest === "pause" || rest === "resume" || rest === "clear") return { action: rest };
  if (/^(?:pause|resume|clear)\b/u.test(rest)) return "usage";
  return { action: "start", objective: rest };
}
