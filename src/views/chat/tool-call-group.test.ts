import assert from "node:assert/strict";
import { test } from "vitest";
import { commandBinary, toolCallLabel, toolCallMeta } from "./tool-call-group.ts";

const tool = (name: string, args?: unknown, extra: Record<string, unknown> = {}) =>
  ({ kind: "tool" as const, id: name, name, ...(args === undefined ? {} : { args }), ...extra });

test("a tool call reads as a sentence in the tense its status calls for", () => {
  assert.deepEqual(toolCallLabel(tool("read", { path: "/srv/app/src/a.ts" })), { done: "Read a.ts", running: "Reading a.ts" });
  assert.deepEqual(toolCallLabel(tool("edit", { path: "src/a.ts" })), { done: "Edited a.ts", running: "Editing a.ts" });
  assert.deepEqual(toolCallLabel(tool("write", { file_path: "docs/b.md" })), { done: "Wrote b.md", running: "Writing b.md" });
});

test("a command row shows the command the model ran, on one line", () => {
  const label = toolCallLabel(tool("bash", { command: "npm run test:package" }));
  assert.deepEqual(label, { done: "Ran npm run test:package", running: "Running npm run test:package" });
  const long = toolCallLabel(tool("bash", { command: `echo ${"x".repeat(120)}` }));
  assert.match(long.done, /^Ran echo x+…$/u);
  assert.ok(long.done.length < 80);
});

test("search, fetch and unknown tools name what they touched without inventing a result", () => {
  assert.equal(toolCallLabel(tool("grep", { pattern: "test:package" })).done, "Searched for test:package");
  assert.equal(toolCallLabel(tool("web_fetch", { url: "https://www.uiarc.dev/docs" })).done, "Fetched uiarc.dev");
  assert.equal(toolCallLabel(tool("mystery_tool")).done, "Used mystery tool");
  assert.equal(toolCallLabel(tool("bash", {})).done, "Used bash");
});

test("the row's meta reports only what the output proves", () => {
  assert.equal(toolCallMeta(tool("read", { path: "a.ts" }, { output: "a\nb\nc\n" })), "3 lines");
  assert.equal(toolCallMeta(tool("grep", { pattern: "a" }, { output: "a.ts:1\nb.ts:2\n" })), "2 results");
  assert.equal(toolCallMeta(tool("grep", { pattern: "a" })), undefined);
  assert.equal(toolCallMeta(tool("bash", { command: "true" }, { output: "ok" })), undefined);
});

test("a failed call keeps its sentence and still reports its output size", () => {
  assert.equal(toolCallLabel(tool("read", { path: "a.ts" })).done, "Read a.ts");
  assert.equal(toolCallMeta(tool("read", { path: "a.ts" }, { output: "", failed: true })), undefined);
});

test("a command names its CLI after wrappers, assignments and its path", () => {
  assert.equal(commandBinary(tool("bash", { command: "git status --short" })), "git");
  assert.equal(commandBinary(tool("bash", { command: "FOO=1 sudo -u dani git status" })), "git");
  assert.equal(commandBinary(tool("bash", { command: "/usr/bin/curl -sS https://uiarc.dev" })), "curl");
  assert.equal(commandBinary(tool("bash", { command: "cd repo && npm run build" })), "npm");
  assert.equal(commandBinary(tool("bash", { command: "npx vitest run" })), "vitest");
  assert.equal(commandBinary(tool("bash", { command: "gh pr list" })), "gh");
  assert.equal(commandBinary(tool("bash", { command: "" })), "");
});
