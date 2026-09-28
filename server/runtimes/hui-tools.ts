import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import agentToolsExtension from "./agent-tools-extension.mjs";
import browserToolExtension from "./browser-tool-extension.mjs";
import progressCardExtension from "./progress-card-extension.mjs";
import changesProposalExtension from "./changes-proposal-extension.mjs";

/** The same definitions power SDK registration, CLI extensions and the catalog.
 * Only HUI-owned code runs here; configured third-party extensions never do.
 * `browser` is omitted when Settings → Tools → Browser turns the tool off, and
 * `propose_changes` when Settings → Git → Changes card does: without the card
 * nothing could answer the call. */
export function huiToolDefinitions(options: { browser?: boolean; changes?: boolean } = {}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const registry = { registerTool: (tool: ToolDefinition) => { tools.push(tool); } };
  progressCardExtension(registry);
  if (options.changes !== false) changesProposalExtension(registry);
  agentToolsExtension(registry);
  if (options.browser !== false) browserToolExtension(registry);
  return tools;
}
