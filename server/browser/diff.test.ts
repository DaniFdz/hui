import assert from "node:assert/strict";
import { test } from "vitest";
import { describeDiff, diffSnapshots, MAX_DIFF_LINES } from "./diff.ts";

const page = [
  '- heading "Todo" [level=1]',
  "- list",
  '  - text "two left"',
  '- button "Add" [ref=e3]',
  '- button "Clear" [ref=e4]',
];

test("a diff lists what changed with a little context and keeps the snapshot's own lines", () => {
  const changed = [
    '- heading "Todo" [level=1]',
    "- list",
    '  - text "one left"',
    '- button "Add" [ref=e3]',
    '- button "Clear" [ref=e4]',
    '- button "Undo" [ref=e5]',
  ];
  const diff = diffSnapshots(page, changed);
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 1);
  assert.equal(diff.coarse, false);
  assert.deepEqual(diff.lines, [
    "  - heading \"Todo\" [level=1]",
    "  - list",
    '-   - text "two left"',
    '+   - text "one left"',
    '  - button "Add" [ref=e3]',
    '  - button "Clear" [ref=e4]',
    '+ - button "Undo" [ref=e5]',
  ]);
  assert.match(describeDiff(diff), /^Page changed since the previous snapshot: 2 lines added, 1 removed\.$/u);
  // A line an agent can act on keeps the ref the snapshot bound.
  assert.match(diff.lines.at(-1) ?? "", /\[ref=e5\]/u);
});

test("an identical snapshot reports no change and prints nothing", () => {
  const diff = diffSnapshots(page, [...page]);
  assert.deepEqual(diff.lines, []);
  assert.equal(diff.added, 0);
  assert.equal(diff.removed, 0);
  assert.equal(diff.unchanged, page.length);
  assert.equal(describeDiff(diff), "Nothing changed in the page since the previous snapshot.");
});

test("a long unchanged stretch between two changes is counted, not printed", () => {
  const before = Array.from({ length: 400 }, (_, index) => `- item ${index}`);
  const after = before.map((line, index) => (index === 2 ? '- item "two"' : index === 380 ? '- item "380"' : line));
  const diff = diffSnapshots(before, after);
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 2);
  assert.ok(diff.lines.length < 20, `expected a short diff, got ${diff.lines.length} lines`);
  assert.equal(diff.lines.filter((line) => line.startsWith("- ")).length, 2);
  assert.ok(diff.unchanged > 350);
});

test("a page that changed wholesale is reported as too large to match", () => {
  const before = Array.from({ length: 1_000 }, (_, index) => `- a${index}`);
  const after = Array.from({ length: 1_000 }, (_, index) => `- b${index}`);
  const diff = diffSnapshots(before, after);
  assert.equal(diff.coarse, true);
  assert.deepEqual(diff.lines, []);
  assert.match(describeDiff(diff), /too large to match line by line, so here is the whole snapshot\.$/u);
});

test("the printed diff is capped and says how much it left out", () => {
  const before = Array.from({ length: MAX_DIFF_LINES + 20 }, (_, index) => `- item ${index} old`);
  const after = Array.from({ length: MAX_DIFF_LINES + 20 }, (_, index) => `- item ${index} new`);
  const diff = diffSnapshots(before, after);
  assert.equal(diff.lines.length, MAX_DIFF_LINES);
  assert.equal(diff.added, MAX_DIFF_LINES + 20);
  assert.ok(diff.omitted >= 40);
});

test("an addition at the start and a removal at the end both show", () => {
  const before = ['- heading "A"', '- button "Go" [ref=e2]'];
  const after = ['- heading "B"', '- heading "A"'];
  const diff = diffSnapshots(before, after);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.deepEqual(diff.lines, ['+ - heading "B"', "  - heading \"A\"", '- - button "Go" [ref=e2]']);
});
