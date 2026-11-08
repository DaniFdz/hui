/**
 * Gateway extensions as a Durable extension: one tool per declared handler, with its prompt snippet and guidelines,
 * validated arguments and an isError answer instead of a failed turn. The host offers it to every Durable conversation
 * when it starts; a disabled extension's tool answers nothing because the handler is looked up at call time.
 */
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import Value from "typebox/value";

import { recordDiagnosticEvent } from "../observability.ts";
import type { ExtensionsService } from "./service.ts";

export type GatewayExtensionOptions = {
  /** Names already reported, so one refused tool warns once per process. */
  problems?: Set<string>;
  record?: typeof recordDiagnosticEvent;
};

/** The extension of every enabled gateway tool, or undefined when none is loaded. */
export function gatewayDurableExtension(source: ExtensionsService, options: GatewayExtensionOptions = {}): Extension | undefined {
  const record = options.record ?? recordDiagnosticEvent;
  const problems = options.problems ?? new Set<string>();
  const tools = [];
  const seen = new Set<string>();
  for (const entry of source.agentTools()) {
    const problem = entry.name.length > 64 ? "its name is too long" : seen.has(entry.name) ? "another extension tool already uses that name" : undefined;
    if (problem) {
      if (!problems.has(entry.name)) {
        problems.add(entry.name);
        record({
          area: "gateway",
          level: "warning",
          action: "extension_tool_refused",
          summary: `extension tool ${entry.name} was not offered: ${problem}`,
        });
      }
      continue;
    }
    seen.add(entry.name);
    tools.push(defineTool({
      name: entry.name,
      description: entry.tool.description,
      parameters: entry.tool.parameters as never,
      replay: "unsafe",
      execute: async (args, api, context) => {
        const live = source.toolFor(entry.extensionId, entry.tool.name);
        if (!live) return { output: [{ type: "text" as const, text: `Extension ${entry.extensionId} is not enabled.` }], isError: true };
        if (!Value.Check(live.parameters as never, args)) {
          return { output: [{ type: "text" as const, text: "The arguments do not match this tool's schema." }], isError: true };
        }
        try {
          const result = await live.handle(args, { conversationId: String(api.conversationId), signal: context.abortSignal ?? new AbortController().signal });
          const text = typeof result === "string" ? result : result.text;
          const details = typeof result === "string" ? undefined : result.details;
          return { output: [{ type: "text" as const, text }], ...(details === undefined ? {} : { details: details as never }) };
        } catch (error) {
          if (context.abortSignal?.aborted) throw error;
          return { output: [{ type: "text" as const, text: error instanceof Error ? error.message : "The extension tool failed." }], isError: true };
        }
      },
    }));
  }
  return tools.length ? defineExtension({ name: "gateway-extensions", tools }) : undefined;
}
