import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
export const CHANGES_DECISION_TITLE: string;
export function changesDecisionText(raw: string | undefined): string;
export default function changesProposalExtension(pi: { registerTool(tool: ToolDefinition): void }): void;
