/**
 * The browser tool's schema against the calls HUI means to accept. A parameter
 * declared twice in the same object literal silently wins with the later
 * definition, which once narrowed `get`'s `what` to storage's values and broke
 * every `get` in the app while the manager's own tests (which bypass the schema)
 * stayed green. So this exercises the schema, not the manager.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { Value } from "typebox/value";

import browserToolExtension from "./browser-tool-extension.mjs";

type RegisteredTool = { name: string; parameters: unknown };

function registered(): RegisteredTool {
  let captured: RegisteredTool | undefined;
  const pi = { registerTool: (tool: RegisteredTool) => { captured = tool; } };
  browserToolExtension(pi as unknown as Parameters<typeof browserToolExtension>[0]);
  assert.ok(captured, "the extension registers its tool");
  return captured;
}

const tool = registered();

const calls: Array<Record<string, unknown>> = [
  { action: "status" },
  { action: "tabs" },
  { action: "open", url: "https://example.com" },
  { action: "navigate", url: "https://example.com/a" },
  { action: "back" },
  { action: "forward" },
  { action: "reload" },
  { action: "focus", tabId: "t2" },
  { action: "close", tabId: "t2" },
  { action: "snapshot" },
  { action: "snapshot", interactive: true, query: "sign", maxChars: 9000, selector: "main", depth: 3 },
  { action: "snapshot", diff: true },
  { action: "act", kind: "click", ref: "e3", double: true, dialog: "accept" },
  { action: "act", kind: "type", ref: "e4", text: "hello", append: true, submit: true },
  { action: "act", kind: "press", key: "Enter", ref: "e4" },
  { action: "act", kind: "hover", ref: "e5" },
  { action: "act", kind: "select", ref: "e6", values: ["Blue", "Red"] },
  { action: "act", kind: "upload", ref: "e7", files: ["notes.txt", "/tmp/other.md"] },
  { action: "act", kind: "upload", selector: "#hidden-input", files: ["notes.txt"] },
  { action: "act", kind: "scroll", deltaY: -400 },
  { action: "act", kind: "scroll", ref: "e8" },
  { action: "act", kind: "wait", state: "visible", selector: "#done" },
  { action: "act", kind: "wait", textGone: "Loading" },
  { action: "act", kind: "wait", url: "/inbox" },
  { action: "text", selector: "article", maxChars: 2000 },
  { action: "screenshot", path: "shots/a.png", fullPage: true },

  { action: "console", errorsOnly: true, clear: true },
  { action: "resize", width: 390, height: 844 },
  { action: "handoff", message: "Sign in, then click Continue.", timeoutMs: 120000 },
  { action: "secret", name: "GitHub", ref: "e9", submit: true },
  { action: "steps", steps: [{ kind: "click", ref: "e3" }, { kind: "wait", state: "visible", selector: "#ok" }] },
  { action: "get", what: "text", ref: "e10" },
  { action: "get", what: "html", selector: "main" },
  { action: "get", what: "value", ref: "e11", maxChars: 500 },
  { action: "get", what: "attr", ref: "e11", attribute: "href" },
  { action: "get", what: "box", ref: "e11" },
  { action: "get", what: "title" },
  { action: "get", what: "url" },
  { action: "get", what: "count", selector: "button" },
  { action: "is", what: undefined, state: "visible", ref: "e12" },
  { action: "is", state: "checked", selector: "#agree" },
  { action: "network", operation: "start" },
  { action: "network", operation: "requests", filter: "/api", type: "Fetch", method: "POST", status: "2xx" },
  { action: "network", operation: "request", id: "n3" },
  { action: "network", operation: "har", path: "net/run.har" },
  { action: "network", operation: "stop" },
  { action: "network", operation: "clear" },
  { action: "performance", operation: "metrics" },
  { action: "performance", operation: "timings" },
  { action: "storage", what: "cookies", filter: "sid" },
  { action: "storage", what: "local" },
  { action: "storage", what: "session" },
];

test("the browser tool's schema accepts a call for every action HUI documents", () => {
  for (const call of calls) {
    assert.equal(Value.Check(tool.parameters as never, call as never), true, `schema rejects ${JSON.stringify(call)}`);
  }
});

test("the schema still refuses what the manager would refuse", () => {
  // Per-action requirements (navigate needs a URL) are the manager's job; the
  // schema only guards shapes and value sets.
  const rejected: Array<Record<string, unknown>> = [
    { action: "wat" },
    { action: "act", kind: "click", ref: "3" },
    { action: "act", kind: "upload", files: [] },
    { action: "get", what: "cookbook" },
    { action: "storage", what: "indexeddb" },
    { action: "network", operation: "requests", id: "3" },
    { action: "snapshot", depth: 0 },

  ];
  for (const call of rejected) {
    assert.equal(Value.Check(tool.parameters as never, call as never), false, `schema accepts ${JSON.stringify(call)}`);
  }
});
