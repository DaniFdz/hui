import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import type { Extension } from "@earendil-works/pi-durable";

import type { ExtensionTool } from "./registry.ts";
import { gatewayDurableExtension } from "./durable.ts";
import type { ExtensionsService } from "./service.ts";

const TOOL: ExtensionTool = {
  name: "greet",
  description: "Greets a person.",
  parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  promptSnippet: "Greets",
  promptGuidelines: ["Use it."],
  handle: async (args) => {
    const { name } = args as { name: string };
    return `hello, ${name}`;
  },
};

function source(tools = [{ extensionId: "hello", name: "ext_hello_greet", tool: TOOL }], live: ExtensionTool | null = TOOL): ExtensionsService {
  return {
    agentTools: () => tools,
    toolFor: (extensionId: string, name: string) => extensionId === "hello" && name === "greet" ? live ?? undefined : undefined,
  } as unknown as ExtensionsService;
}

function call(extension: Extension | undefined, args: unknown): Promise<{ output: { type: string; text: string }[]; isError?: boolean }> {
  const tool = extension?.tools?.[0] as unknown as { execute: (args: unknown, api: unknown, context: unknown) => Promise<{ output: { type: string; text: string }[]; isError?: boolean }> };
  assert.ok(tool, "the extension has a tool");
  return tool.execute(args, { conversationId: 7 }, { abortSignal: new AbortController().signal });
}

test("an enabled gateway tool is namespaced and runs with its handler", async () => {
  const extension = gatewayDurableExtension(source());
  assert.deepEqual(extension?.tools?.map((tool) => tool.name), ["ext_hello_greet"]);
  assert.deepEqual(await call(extension, { name: "Ada" }), { output: [{ type: "text", text: "hello, Ada" }] });
  assert.equal((await call(extension, { name: 3 })).isError, true, "arguments are checked against the schema");
  assert.equal((await call(extension, {})).isError, true);
});

test("a disabled or throwing tool answers isError instead of failing the turn", async () => {
  assert.match((await call(gatewayDurableExtension(source([{ extensionId: "hello", name: "ext_hello_greet", tool: TOOL }], null)), { name: "Ada" })).output[0]?.text ?? "", /not enabled/u);
  const throwing: ExtensionTool = { ...TOOL, handle: async () => { throw new Error("fixture failure"); } };
  const extension = gatewayDurableExtension(source([{ extensionId: "hello", name: "ext_hello_greet", tool: throwing }], throwing));
  const answer = await call(extension, { name: "Ada" });
  assert.equal(answer.isError, true);
  assert.match(answer.output[0]?.text ?? "", /fixture failure/u);
});

test("a tool whose name is too long or already taken is refused once", () => {
  const events: { action?: string; summary?: string }[] = [];
  const problems = new Set<string>();
  const duplicate = { extensionId: "hello", name: "ext_hello_greet", tool: { ...TOOL, name: "greet" } };
  const long = { extensionId: "hello", name: `ext_hello_${"x".repeat(60)}`, tool: { ...TOOL, name: "x".repeat(60) } };
  const record = (event: { action?: string; summary?: string }) => { events.push(event); };
  const extension = gatewayDurableExtension(source([duplicate, duplicate, long], TOOL), { problems, record });
  assert.deepEqual(extension?.tools?.map((tool) => tool.name), ["ext_hello_greet"]);
  assert.equal(events.filter((event) => event.action === "extension_tool_refused").length, 2);
  gatewayDurableExtension(source([duplicate, long], TOOL), { problems, record });
  assert.equal(events.length, 2, "the same refusal is reported once");
});

test("the gateway prompt section sits between the goal and Ultra", () => {
  const source = readFileSync(new URL("../runtimes/durable-prompt.ts", import.meta.url), "utf8");
  assert.match(source, /"hui_goal", "hui_extensions", "hui_ultra"/u);
});
