/**
 * HUI-owned tool definitions, gathered from their extension modules. The same definitions power SDK
 * registration, CLI extensions and the catalog. Only HUI-owned code runs here; configured third-party extensions
 * never do.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import agentToolsExtension from "./agent-tools-extension.mjs";
import browserToolExtension from "./browser-tool-extension.mjs";
import progressCardExtension from "./progress-card-extension.mjs";
import showWidgetExtension from "./show-widget-extension.mjs";

/** `browser` is omitted when Settings → Tools → Browser turns the tool off. */
export function huiToolDefinitions(options: { browser?: boolean } = {}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const registry = { registerTool: (tool: ToolDefinition) => { tools.push(tool); } };
  progressCardExtension(registry);
  agentToolsExtension(registry);
  showWidgetExtension(registry);
  if (options.browser !== false) browserToolExtension(registry);
  return tools;
}
