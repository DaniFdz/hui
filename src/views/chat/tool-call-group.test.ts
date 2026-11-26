import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { commandBinary, renderToolCallGroup, renderToolChips, toolCallLabel, toolCallMeta, type ToolItem } from "./tool-call-group.ts";

/** A Lit template's markup, with bound values written out. */
function markup(value: unknown): string {
  if (Array.isArray(value)) return value.map(markup).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + markup(template.values[i])).join("");
  }
  return ["string", "number", "boolean"].includes(typeof value) ? String(value) : "";
}

const group = (items: readonly unknown[], expanded = true, expandedIds: ReadonlySet<string> = new Set()) =>
  markup(renderToolCallGroup(items as never, {
    expanded,
    onToggle: () => {},
    expansionId: (item: { id: string }) => `s:${item.id}`,
    expandedIds,
    onRowToggle: () => {},
    onCopy: () => {},
  })).replace(/\s+/gu, " ");

const chips = (items: readonly unknown[], limit?: number) =>
  markup(renderToolChips(items as never, limit)).replace(/\s+/gu, " ");

const tool = (name: string, args?: unknown, extra: Record<string, unknown> = {}) =>
  ({ kind: "tool" as const, id: name, name, ...(args === undefined ? {} : { args }), ...extra });

/** The titles of every call row the card drew, in the order it drew them. */
const titles = (html: string) => [...html.matchAll(/class=tool-call-row__title(?: tool-call-row__title--live)?>([^<]*)</gu)].map((match) => match[1]);

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

test("a run of calls is one card: its own disclosure header over one row per call, in transcript order", () => {
  const html = group([
    tool("read", { path: "a.ts" }, { id: "t1", status: "succeeded", output: "a\nb\nc\n", metrics: { durationMs: 12_000 } }),
    tool("bash", { command: "npm test" }, { id: "t2", status: "succeeded" }),
    tool("edit", { path: "b.ts" }, { id: "t3", status: "succeeded" }),
  ]);
  // The base app's box: its own disclosure, its own header, and its rows only once it is open.
  assert.match(html, /<div class="tool-call-group"> <details class="tool-call-group__disclosure" .open=true @toggle=/u);
  assert.match(html, /<summary class="tool-call-group__head"> <span class="tool-call-group__marks" aria-hidden="true">/u);
  assert.match(html, /<span class=tool-call-group__label>Used 3 tools<\/span>/u);
  assert.match(html, /<span class="tool-call-group__chevron" aria-hidden="true">/u);
  assert.equal(html.split('class="tool-call-row"').length - 1, 3, "one row per call");
  assert.deepEqual(titles(html), ["Read a.ts", "Ran npm test", "Edited b.ts"], "the rows keep the transcript's order");
  assert.ok(html.indexOf("Read a.ts") < html.indexOf("Ran npm test"));
  assert.match(html, /<span class="tool-call-row__meta">3 lines · 12s<\/span>/u, "a settled call's own measurement joins its result size");
});

test("a closed card draws its header and none of its rows", () => {
  const html = group([
    tool("read", { path: "a.ts" }, { id: "t1", status: "succeeded", output: "a\n" }),
    tool("bash", { command: "npm test" }, { id: "t2", status: "succeeded" }),
  ], false);
  assert.match(html, /class=tool-call-group__label>Used 2 tools</u);
  assert.doesNotMatch(html, /class="tool-call-row"/u, "no row waits behind a closed card");
  assert.doesNotMatch(html, /chat-tool-msg-body/u, "and no body either");
});

test("a run still working says so in the header and keeps its spin", () => {
  const html = group([tool("bash", { command: "npm test" }, { status: "running" })]);
  assert.match(html, /<span class=tool-call-group__label tool-call-group__label--live>Using 1 tool<\/span>/u);
  assert.match(html, /<span class="tool-call-group__spin" aria-hidden="true"><\/span>/u);
  assert.match(html, /1 tool<\/span>/u, "one tool is singular");
});

test("a call's own toggle opens its card body, and only its own row", () => {
  const items = [
    tool("mystery", { input: "x" }, { id: "t1", status: "succeeded", output: "done" }),
    tool("read", { path: "a.ts" }, { id: "t2", status: "succeeded", output: "a\n" }),
  ];
  const open = group(items, true, new Set(["s:t1"]));
  assert.match(open, /<button type="button" class=tool-call-row__toggle aria-expanded=false @click=> <span class="tool-call-row__icon/u);
  assert.match(open, /<button type="button" class=tool-call-row__toggle is-open aria-expanded=true @click=> <span class="tool-call-row__icon/u);
  // The first call's body is the one open: the second waits for its own toggle.
  const firstOpen = open.indexOf("class=tool-call-row__toggle is-open");
  const secondClosed = open.indexOf("class=tool-call-row__toggle aria-expanded=false");
  const bodyAt = open.indexOf("chat-tool-msg-body");
  assert.ok(firstOpen >= 0 && secondClosed > firstOpen, "the first call is open and the second is folded");
  assert.ok(bodyAt > firstOpen && bodyAt < secondClosed, "the one body belongs to the open row, before the next call");
  assert.equal(open.split("chat-tool-msg-body").length - 1, 1, "one call is open, so one body is drawn");
  assert.match(open, /data-testid="tool-call-body"/u);
  assert.match(open, /aria-label="Copy output"/u);
  assert.doesNotMatch(group(items), /chat-tool-msg-body/u, "no row open, no body");
  // A call with a card of its own opens that card: a command's terminal is its body too.
  const command = group([tool("bash", { command: "echo hi" }, { id: "t1", status: "succeeded", output: "hi" })], true, new Set(["s:t1"]));
  assert.match(command, /chat-tool-term__out" data-testid="tool-call-output"><code>hi<\/code>/u);
});

test("the chips a stretch's calls proved are one row of marks, deduplicated and capped", () => {
  const call = (id: string, name: string, args: unknown, output: string) => tool(name, args, { id, status: "succeeded", output });
  const html = chips([
    call("a", "bash", { command: "gh pr view 580" }, "https://github.com/DaniFdz/HUI/pull/580 session:8f14e45f-ceea-467a-9b1d-000000000001"),
    call("b", "bash", { command: "gh pr view 580" }, "https://github.com/DaniFdz/HUI/pull/580"),
    call("c", "read", { path: "/repo/a.ts" }, "a\n"),
  ]);
  // The file the call named opens in Files with its full path; the pull request it printed is the pill it always was.
  assert.match(html, /<span class="tool-call-chip tool-call-chip--file"><hui-file-ref data-path=\/repo\/a\.ts>\/repo\/a\.ts<\/hui-file-ref><\/span>/u);
  assert.match(html, /<a class="tool-call-chip tool-call-chip--pr" href=https:\/\/github\.com\/DaniFdz\/HUI\/pull\/580 target="_blank" rel="noopener">PR #580<\/a>/u);
  // The session element carries its query and no child: `components/session-ref.ts` writes the words it shows, so no Lit
  // child part sits where the chip's own `replaceChildren` would eject it.
  assert.match(html, /<hui-session-ref class="tool-call-chip tool-call-chip--session" data-query=8f14e45f-ceea-467a-9b1d-000000000001><\/hui-session-ref>/u);
  assert.doesNotMatch(html, /hui-session-ref[^>]*>[^<]/u, "the chip starts empty and writes its own text");
  assert.equal(html.split("PR #580").length - 1, 1, "two calls that printed the same pull request draw one chip");
  assert.equal(html.split("tool-call-chip--file").length - 1, 1);
  // Capped: a stretch that proved a wall of references keeps the three it read first.
  const many = chips(["https://github.com/a/b/pull/1", "https://github.com/a/b/pull/2", "https://github.com/a/b/pull/3", "https://github.com/a/b/pull/4"]
    .map((href, index) => call(`l${index}`, "bash", { command: "echo" }, href)));
  assert.equal(many.split("tool-call-chip--pr").length - 1, 3, "the summary shows at most three chips");
  assert.match(many, /PR #1<\/a>[\s\S]*PR #2<\/a>[\s\S]*PR #3<\/a>/u);
  assert.doesNotMatch(many, /PR #4/u);
  // A call that proved nothing draws no chip at all.
  assert.equal(chips([tool("bash", { command: "true" }, { status: "succeeded", output: "ok" })]), "");
});

test("a redraw of the same call reuses what it proved instead of scanning its text again", () => {
  // A live turn redraws every second. Each call's chips are read from its own arguments and output, which cannot change
  // under the same item object, so a redraw must not re-run that scan.
  let reads = 0;
  const item = {
    kind: "tool" as const, id: "t1", name: "bash", status: "succeeded" as const,
    get args() { reads += 1; return { command: "echo https://github.com/DaniFdz/HUI/pull/580 session:abc12345" }; },
    output: "",
  } satisfies ToolItem;
  const first = chips([item]);
  assert.match(first, /PR #580/u, "the first draw reads the call and proves its chips");
  const scanned = reads;
  const second = chips([item]);
  assert.equal(second, first, "the redrawn chips are the chips it drew");
  assert.ok(reads - scanned < scanned,
    `a redraw read the call's data ${reads - scanned} times, the first draw ${scanned}: the reference scan must be the part it skips`);
});

test("a settled call's row adds its measured duration to the meta, and a running one shows none", () => {
  const settled = group([tool("read", { path: "a.ts" }, { status: "succeeded", output: "a\nb\nc\n", metrics: { timestamp: 1_000, completedAt: 13_000, durationMs: 12_000 } })]);
  assert.match(settled, /<span class="tool-call-row__meta">3 lines · 12s<\/span>/u);
  // Its own duration alone is still a meta.
  const alone = group([tool("read", { path: "a.ts" }, { status: "succeeded", output: "", metrics: { durationMs: 184_000 } })]);
  assert.match(alone, /<span class="tool-call-row__meta">3m 04s<\/span>/u);
  // A call that is still working has not measured itself yet, even when an earlier frame carried a number.
  const running = group([tool("read", { path: "a.ts" }, { status: "running", output: "a\n", metrics: { durationMs: 0 } })]);
  assert.match(running, /<span class="tool-call-row__meta">1 line<\/span>/u, "what its output proves still shows");
  assert.doesNotMatch(running, /0s/u, "a running call reports no duration");
  const unmeasured = group([tool("read", { path: "a.ts" }, { status: "succeeded", output: "a\n" })]);
  assert.match(unmeasured, /<span class="tool-call-row__meta">1 line<\/span>/u, "a call with no reported timing adds none");
});
