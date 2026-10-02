import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PullRequestRiskVerdict } from "../../shared/pull-requests.ts";
export function parsePullRequestRisk(value: unknown): { verdict: PullRequestRiskVerdict } | { error: string };
export default function prRiskExtension(pi: { registerTool(tool: ToolDefinition): void }): void;
