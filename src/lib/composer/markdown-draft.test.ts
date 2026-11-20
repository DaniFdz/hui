/**
 * The draft formatter's contract: every source character survives, the markup a source means is what it paints with,
 * and nothing the operator typed can reach the mirror as markup.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { MAX_FORMATTED_LENGTH, draftPlainText, formatDraft, renderDraftHtml, type DraftInline } from "./markdown-draft.ts";

/** The text a painted draft shows, read back out of the HTML the mirror receives. */
function paintedText(html: string): string {
  return html
    .replaceAll('<i class="hui-draft-marker__dot"></i>', "")
    .replace(/<span class="[^"]*">/gu, "")
    .replaceAll("</span>", "")
    .replace(/<div class="[a-z- ]+">/gu, "\n")
    .replaceAll("</div>", "")
    .slice(1)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

const inlinesOf = (source: string): DraftInline[] => formatDraft(source).flatMap((line) => [...line.inlines]);
const kinds = (source: string): string[] => inlinesOf(source).map((token) => token.kind);
const textOf = (source: string, kind: DraftInline["kind"]): string => inlinesOf(source).filter((token) => token.kind === kind).map((token) => token.text).join("");

const LONG = `**bold** *italic* \`code\`\n- item\n## ${"x".repeat(4_900 - 40)}`;

const DRAFTS = [
  ["bold", "Make it **really** clear"],
  ["italic", "an *unfinished* thought"],
  ["nested emphasis", "**bold *and italic* bold** and ***both***"],
  ["inline code inside emphasis", "**see `npm test` run**"],
  ["inline code outside emphasis", "run `npm run typecheck` first"],
  ["a fenced block with a language line", "```ts\nconst answer = 42;\n```"],
  ["a tilde fence with an info string", "~~~ bash -e\necho *hi*\n~~~"],
  ["an unterminated fence", "```md\n**still code**\n"],
  ["bullets and an ordered list at three levels", "- one\n   - two\n      - three\n1. first\n2) second"],
  ["mixed text and list", "Here is the plan:\n- step **one**\n- step `two`\n\nThen stop."],
  ["escapes", "\\*not italic\\* and \\`not code\\` and \\\\*still literal*"],
  ["unterminated markers mid-word", "2 * 3 and 4 ** 5 and a `tick"],
  ["an empty draft", ""],
  ["whitespace only", "   \n\t\n"],
  ["a trailing newline", "one line\n"],
  ["CRLF", "first\r\n- second\r\n"],
  ["emoji", "🐱 **bold 🐱** and `🐱` and *🐱 🐱*"],
  ["a cross-line emphasis run", "**bold\nstill bold** and `code\nspan`"],
  ["a list item whose emphasis crosses its line break", "- **a\n  b**"],
  ["blank lines between paragraphs", "**a**\n\n**b**"],
  ["a 5,000-character draft", LONG],
] as const;

test("a painted draft shows exactly the source the operator typed", () => {
  for (const [name, source] of DRAFTS) {
    assert.equal(draftPlainText(formatDraft(source)), source, name);
    assert.equal(paintedText(renderDraftHtml(formatDraft(source))), source, name);
  }
});

test("the draft's own markup is what it paints with, and nothing else", () => {
  assert.deepEqual(kinds("**b**"), ["marker", "bold", "marker"]);
  assert.equal(textOf("**b**", "bold"), "b");
  assert.deepEqual(kinds("*i*"), ["marker", "italic", "marker"]);
  assert.deepEqual(kinds("***both***"), ["marker", "bold-italic", "marker"]);
  assert.deepEqual(kinds("`c`"), ["marker", "code", "marker"]);
  // A code span is never parsed again, and neither is a fence.
  assert.equal(textOf("`**not bold**`", "code"), "**not bold**");
  assert.doesNotMatch(kinds("`**not bold**`").join(" "), /bold/u);
  const fenced = formatDraft("```\n**not bold**\n```").map((line) => line.kind);
  assert.deepEqual(fenced, ["fence-open", "code", "fence-close"]);
  assert.equal(textOf("```\n**not bold**\n```", "bold"), "");
  // Unmatched delimiters stay literal text.
  assert.deepEqual(kinds("2 * 3"), ["text"]);
  // A name is not emphasis, but its peers still are.
  assert.deepEqual(kinds("read_text_file"), ["text"]);
  assert.equal(textOf("_one_ and read_text_file", "italic"), "one");
  // Words lean one at a time so the space between them can still wrap.
  assert.deepEqual(inlinesOf("*two words*"), [
    { kind: "marker", text: "*" },
    { kind: "italic", text: "two" },
    { kind: "text", text: " " },
    { kind: "italic", text: "words" },
    { kind: "marker", text: "*" },
  ]);
});

test("lines carry the kind, indent and marker the composer paints", () => {
  const lines = formatDraft("- one\n   1. two\n\n```js\ncode\n```");
  assert.deepEqual(lines.map((line) => [line.kind, line.indent, line.marker ?? null, line.markerKind ?? null]), [
    ["list", "", "-", "bullet"],
    ["ordered", "   ", "1.", "ordered"],
    ["blank", "", null, null],
    ["fence-open", "", "```", "fence"],
    ["code", "", null, null],
    ["fence-close", "", "```", "fence"],
  ]);
  assert.equal((formatDraft("~~~js")[0]!.marker), "~~~");
  assert.equal(draftPlainText(formatDraft("- one\n   1. two")), "- one\n   1. two");
});

test("a crossing run keeps its style on both lines", () => {
  assert.deepEqual(formatDraft("**a\nb**").map((line) => line.inlines.map((token) => `${token.kind}:${token.text}`)), [
    ["marker:**", "bold:a"],
    ["bold:b", "marker:**"],
  ]);
});

test("nothing a draft holds can become markup", () => {
  const source = `<script>alert("x & y")</script> 'single' <img onerror=alert(1)> **<b>bold</b>** \`<i>\``;
  const html = renderDraftHtml(formatDraft(source));
  assert.doesNotMatch(html, /<(?:script|img|b|i)[\s>]/iu);
  assert.doesNotMatch(html, /<\/b>/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /&lt;img/u);
  assert.match(html, /&quot;/u);
  assert.match(html, /&#39;/u);
  assert.match(html, /&amp;/u);
  // Every class the mirror draws comes from this module's constants, never from the draft.
  for (const [, value] of html.matchAll(/class="([^"]*)"/gu)) assert.match(value!, /^hui-draft-[a-z- ]+$/u);
  assert.equal(paintedText(html), source);
});

test("a draft above the cap paints plain until it drops back below it", () => {
  const head = "**bold** ";
  const atCap = `${head}${"a".repeat(MAX_FORMATTED_LENGTH - head.length)}`;
  const overCap = `${head}${"a".repeat(MAX_FORMATTED_LENGTH - head.length + 1)}`;
  assert.equal(atCap.length, MAX_FORMATTED_LENGTH);
  assert.deepEqual(kinds(atCap), ["marker", "bold", "marker", "text"]);
  assert.deepEqual(kinds(overCap), ["text"]);
  assert.equal(draftPlainText(formatDraft(overCap)), overCap);
  assert.deepEqual(formatDraft(overCap).map((line) => line.kind), ["text"]);
  assert.deepEqual(kinds(overCap.slice(0, -1)), ["marker", "bold", "marker", "text"]);
});

/** How long a formatting pass took, so a quadratic matcher cannot hide behind a passing invariant. */
function timedFormat(source: string): { ms: number; lines: ReturnType<typeof formatDraft> } {
  const started = performance.now();
  const lines = formatDraft(source);
  return { ms: performance.now() - started, lines };
}

test("an adversarial draft of unmatched runs formats in linear time and keeps the invariant", () => {
  // 5,000 `*` runs that pair up, then 2,400 `**` runs: a closer that scans every opener it cannot use is quadratic on
  // this draft, so the matcher keeps one stack per run kind and drops the openers a match already passed, lazily.
  const draft = "*a".repeat(5000) + " **".repeat(2400);
  assert.ok(draft.length <= MAX_FORMATTED_LENGTH, "the draft is formatted, not painted plain");
  const { ms, lines } = timedFormat(draft);
  assert.equal(draftPlainText(lines), draft);
  assert.ok(ms < 200, `formatted ${draft.length} characters in ${ms.toFixed(1)}ms`);
});

test("a full-length ordinary draft formats every run it holds", () => {
  const paragraph = "Ship **this** and *that* with `npm test`:\n- one\n  1. nested\n\n";
  const draft = paragraph.repeat(Math.ceil(MAX_FORMATTED_LENGTH / paragraph.length)).slice(0, MAX_FORMATTED_LENGTH);
  assert.equal(draft.length, MAX_FORMATTED_LENGTH);
  const { ms, lines } = timedFormat(draft);
  assert.equal(draftPlainText(lines), draft);
  assert.ok(ms < 200, `formatted ${draft.length} characters in ${ms.toFixed(1)}ms`);
  // It is formatted, not plain: the bold, the code span and the lists are all still recognised at the cap.
  const flat = lines.flatMap((line) => [...line.inlines]);
  assert.ok(flat.some((token) => token.kind === "bold" && token.text === "this"));
  assert.ok(flat.some((token) => token.kind === "code" && token.text === "npm test"));
  assert.deepEqual([...new Set(lines.map((line) => line.kind))].sort(), ["blank", "list", "ordered", "text"]);
});
