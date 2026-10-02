import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import agentToolsExtension from "./agent-tools-extension.mjs";
import browserToolExtension from "./browser-tool-extension.mjs";
import progressCardExtension from "./progress-card-extension.mjs";
import prRiskExtension from "./pr-risk-extension.mjs";

/** The same definitions power SDK registration, CLI extensions and the catalog.
 * Only HUI-owned code runs here; configured third-party extensions never do.
 * `browser` is omitted when Settings → Tools → Browser turns the tool off;
 * `report_pr_risk` exists only in temporary pull-request risk-review sessions
 * (`prReview`). */
export function huiToolDefinitions(options: { browser?: boolean; prReview?: boolean } = {}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const registry = { registerTool: (tool: ToolDefinition) => { tools.push(tool); } };
  progressCardExtension(registry);
  agentToolsExtension(registry);
  if (options.browser !== false) browserToolExtension(registry);
  if (options.prReview) prRiskExtension(registry);
  return tools;
}
