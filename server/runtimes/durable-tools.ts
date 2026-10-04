/**
 * HUI-owned tools for Durable conversations. The definitions are the same ones
 * the PI worker registers; here they run inside the gateway and reach HUI's
 * agent-tool handler directly, as the conversation's bound HUI session.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineExtension, defineTool, type ConversationId, type Extension, type ToolRegistration } from "@earendil-works/pi-durable";
import type { AgentToolInvocation } from "../agent-tools-bridge.ts";
import { directHuiBridge } from "./bridge-client.mjs";
import { huiToolDefinitions } from "./hui-tools.ts";

export type DurableToolInvoker = (invocation: AgentToolInvocation) => Promise<unknown>;
type ConversationInvoker = (conversationId: ConversationId, action: string, params: Record<string, unknown>) => Promise<unknown>;

/** Whether an interrupted call may rerun after a crash. HUI actions can have
 * taken effect (a spawned child, a typed terminal line), so none are replayed:
 * the model is told the call was interrupted and decides what to do. */
const REPLAY: "unsafe" = "unsafe";

function durableTool(tool: ToolDefinition, invoke: ConversationInvoker): ToolRegistration {
  return defineTool({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as never,
    replay: REPLAY,
    execute: async (args, api, context) => {
      const result = await directHuiBridge.run(
        (action, params) => invoke(api.conversationId, action, params),
        () => tool.execute(api.callId, args as never, context.abortSignal, undefined, undefined as never),
      );
      return {
        content: result.content,
        ...(result.details === undefined ? {} : { details: result.details as never }),
      };
    },
  });
}

export function huiDurableTools(options: { invoke: ConversationInvoker }): Extension {
  return defineExtension({
    name: "hui-tools",
    // Settings → Tools → Browser removes `browser` per conversation at start.
    tools: huiToolDefinitions({ browser: true }).map((tool) => durableTool(tool, options.invoke)),
  });
}
