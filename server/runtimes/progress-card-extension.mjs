/**
 * HUI-owned presentation signal. PI persists ordinary tool calls in its transcript; HUI projects the latest
 * arguments into the composer card.
 */
import { Type } from "typebox";

const Step = Type.Object({
  step: Type.String({ maxLength: 500 }),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
  ]),
});

export default function progressCardExtension(pi) {
  pi.registerTool({
    name: "progress_card",
    label: "Task progress",
    description: "Replace the current task progress card. Use only for substantial work with at least two meaningful sequential steps. Pass empty markdown and no plan to clear it.",
    promptSnippet: "Maintain the current task progress card for substantial multi-step work",
    promptGuidelines: [
      "Use progress_card for substantial work with at least two meaningful sequential steps; update it only when status meaningfully changes.",
      "Do not invent steps merely to show progress, and clear progress_card when the tracked work is finished.",
    ],
    parameters: Type.Object({
      markdown: Type.Optional(Type.String({ maxLength: 8_192 })),
      plan: Type.Optional(Type.Array(Step, { maxItems: 50 })),
    }),
    async execute(_toolCallId, params) {
      const completed = params.plan?.filter((step) => step.status === "completed").length ?? 0;
      const total = params.plan?.length ?? 0;
      return {
        content: [{ type: "text", text: total ? `Task progress updated: ${completed}/${total}` : params.markdown ? "Task progress updated" : "Task progress cleared" }],
        details: { markdown: params.markdown ?? "", plan: params.plan ?? [] },
      };
    },
  });
}
