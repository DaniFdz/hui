import { Type } from "typebox";

const RISKS = new Set(["low", "medium", "high"]);
const text = (value, limit) => typeof value === "string" && value.trim() && value.trim().length <= limit ? value.trim() : undefined;
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : undefined;

/** Validates `report_pr_risk` arguments (the tool and the Pull Requests row both
 * use it): `{ risk, summary ≤ 600, reasons ≤ 10 × 300, focusAreas? ≤ 10 }`. */
export function parsePullRequestRisk(value) {
  const input = record(value);
  if (!input) return { error: "Arguments must be an object." };
  if (!RISKS.has(input.risk)) return { error: "risk must be low, medium or high." };
  const summary = text(input.summary, 600);
  if (!summary) return { error: "summary must be 1–600 characters." };
  if (!Array.isArray(input.reasons) || input.reasons.length > 10) return { error: "reasons must be a list of at most 10." };
  const reasons = input.reasons.map((reason) => text(reason, 300));
  if (reasons.some((reason) => !reason)) return { error: "Each reason must be 1–300 characters." };
  let focusAreas;
  if (input.focusAreas !== undefined) {
    if (!Array.isArray(input.focusAreas) || input.focusAreas.length > 10) return { error: "focusAreas must be a list of at most 10." };
    focusAreas = input.focusAreas.map((area) => ({ path: text(record(area)?.path, 500), note: text(record(area)?.note, 300) }));
    if (focusAreas.some((area) => !area.path || !area.note)) return { error: "Each focus area needs a path (≤ 500) and a note (≤ 300)." };
  }
  return { verdict: { risk: input.risk, summary, reasons, ...(focusAreas ? { focusAreas } : {}) } };
}

/** Registered only in temporary `pr-review` sessions. The call returns at once;
 * HUI projects the latest valid call onto the Pull Requests row. */
export default function prRiskExtension(pi) {
  pi.registerTool({
    name: "report_pr_risk",
    label: "Report pull request risk",
    description: "Report the risk verdict of the pull request under review to the operator's Pull Requests page. The latest call wins; it returns immediately.",
    promptSnippet: "Report the risk verdict of the pull request under review",
    promptGuidelines: [
      "Call report_pr_risk once the read-only review is done, with the overall risk, a short summary, the concrete reasons and the files that deserve the closest look.",
      "Never approve, comment on or review the pull request yourself; the operator decides from the verdict.",
    ],
    parameters: Type.Object({
      risk: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
      summary: Type.String({ minLength: 1, maxLength: 600 }),
      reasons: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 10 }),
      focusAreas: Type.Optional(Type.Array(Type.Object({
        path: Type.String({ minLength: 1, maxLength: 500 }),
        note: Type.String({ minLength: 1, maxLength: 300 }),
      }), { maxItems: 10 })),
    }),
    async execute(_toolCallId, params) {
      const parsed = parsePullRequestRisk(params);
      if ("error" in parsed) throw new Error(`Invalid report_pr_risk call: ${parsed.error}`);
      return {
        content: [{ type: "text", text: `Recorded a ${parsed.verdict.risk} risk verdict for the operator.` }],
        details: parsed.verdict,
      };
    },
  });
}
