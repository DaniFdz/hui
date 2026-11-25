import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { commandBinary, renderToolCallRows, toolCallLabel, toolCallMeta } from "./tool-call-group.ts";

/** A Lit template's markup, with bound values written out. */
function markup(value: unknown): string {
  if (Array.isArray(value)) return value.map(markup).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + markup(template.values[i])).join("");
  }
  return ["string", "number", "boolean"].includes(typeof value) ? String(value) : "";
}

const rows = (items: readonly unknown[], expanded: ReadonlySet<string> = new Set()) => markup(renderToolCallRows(items as never, {
  expansionId: (item: { id: string }) => `s:${item.id}`,
  expandedIds: expanded,
  onRowToggle: () => {},
  onCopy: () => {},
})).replace(/\s+/gu, " ");

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
  assert.equal(toolCallLabel(tool("search_chat", { query: "deploy window" })).done, "Searched for deploy window");
  assert.equal(toolCallLabel(tool("web_fetch", { url: "https://www.uiarc.dev/docs" })).done, "Fetched uiarc.dev");
  assert.equal(toolCallLabel(tool("mystery_tool")).done, "Used mystery tool");
  assert.equal(toolCallLabel(tool("bash", {})).done, "Used bash");
});

test("the row's meta reports only what the output proves", () => {
  assert.equal(toolCallMeta(tool("read", { path: "a.ts" }, { output: "a\nb\nc\n" })), "3 lines");
  assert.equal(toolCallMeta(tool("grep", { pattern: "a" }, { output: "a.ts:1\nb.ts:2\n" })), "2 results");
  assert.equal(toolCallMeta(tool("grep", { pattern: "a" })), undefined);
  // A bot's chat search counts the lines it found, never its header or the note of what it read.
  assert.equal(toolCallMeta(tool("search_chat", { query: "deploy" }, { output: `2 lines mention "deploy", newest first:\n3+1|user: the deploy window\n1+1|talk: deployed\n[at most 2 shown]\n` })), "2 results");
  assert.equal(toolCallMeta(tool("search_chat", { query: "nil" }, { output: `No line mentions "nil" in the chat.` })), undefined, "no hit, no count");
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

/** The group's emoji fill their ring at the row's size; they read as three different sizes instead of one stack. */
test("a group's emoji marks sit inside their ring, smaller than a row's", () => {
  const css = readFileSync(new URL("../../styles/openclaw-chat.css", import.meta.url), "utf8");
  const size = (selector: string) => Number(new RegExp(`${selector.replaceAll(".", "\\.")} \\{ font-size: (\\d+)px; \\}`, "u").exec(css)?.[1]);
  assert.ok(size(".tool-call-group__emoji") < size(".tool-call-row__icon--emoji"), "the group's marks are smaller than a row's");
  assert.ok(size(".tool-call-group__emoji") <= 11, "and leave the 24px ring clear");
});

test("a settled call's row adds its measured duration to the meta, and a running one shows none", () => {
  const settled = rows([tool("read", { path: "a.ts" }, { status: "succeeded", output: "a\nb\nc\n", metrics: { timestamp: 1_000, completedAt: 13_000, durationMs: 12_000 } })]);
  assert.match(settled, /<span class="tool-call-row__meta">3 lines · 12s<\/span>/u);
  // Its own duration alone is still a meta.
  const alone = rows([tool("read", { path: "a.ts" }, { status: "succeeded", output: "", metrics: { durationMs: 184_000 } })]);
  assert.match(alone, /<span class="tool-call-row__meta">3m 04s<\/span>/u);
  // A call that is still working has not measured itself yet, even when an earlier frame carried a number.
  const running = rows([tool("read", { path: "a.ts" }, { status: "running", output: "a\n", metrics: { durationMs: 0 } })]);
  assert.match(running, /<span class="tool-call-row__meta">1 line<\/span>/u, "what its output proves still shows");
  assert.doesNotMatch(running, /0s/u, "a running call reports no duration");
  const unmeasured = rows([tool("read", { path: "a.ts" }, { status: "succeeded", output: "a\n" })]);
  assert.match(unmeasured, /<span class="tool-call-row__meta">1 line<\/span>/u, "a call with no reported timing adds none");
});

test("a row's proven file, pull request and session chips sit beside its toggle, never inside it", () => {
  const html = rows([tool("bash", {
    command: "gh pr view 580",
  }, {
    status: "succeeded",
    output: "https://github.com/DaniFdz/HUI/pull/580 session:8f14e45f-ceea-467a-9b1d-000000000001",
  })]);
  const chips = html.slice(html.indexOf('<div class="tool-call-row__chips">'));
  assert.match(chips, /<a class="tool-call-chip tool-call-chip--pr" href=https:\/\/github\.com\/DaniFdz\/HUI\/pull\/580 target="_blank" rel="noopener">PR #580<\/a>/u);
  assert.match(chips, /<hui-session-ref class="tool-call-chip tool-call-chip--session" data-query=8f14e45f-ceea-467a-9b1d-000000000001>session:8f14e45f-ceea-467a-9b1d-000000000001<\/hui-session-ref>/u);
  // The toggle keeps its own label and closes before the chips line: a link inside a button would be neither valid nor
  // reachable from the keyboard.
  const toggle = html.slice(html.indexOf("<button"), html.indexOf("</button>"));
  assert.doesNotMatch(toggle, /tool-call-chip/u);
  assert.ok(html.indexOf("</button>") < html.indexOf("tool-call-row__chips"));
  // A call that proved nothing draws no chips line at all.
  assert.doesNotMatch(rows([tool("bash", { command: "true" }, { status: "succeeded", output: "ok" })]), /tool-call-row__chips/u);
});
