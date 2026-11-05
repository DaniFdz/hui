/**
 * The Usage page keeps HUI's own presentation: the shared card grid whose columns follow the number of cards, HUI's
 * picker for its two choices, and HUI's tooltip rather than the browser's for every hover or focus detail.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { cardGridStyle } from "../lib/card-grid.ts";

const source = readFileSync(new URL("./usage.ts", import.meta.url), "utf8");
const grid = readFileSync(new URL("../styles/card-grid.css", import.meta.url), "utf8");

test("the overview cards and the rankings take their columns from the number of cards they draw", () => {
  assert.match(source, /class="usage-summary-grid hui-card-grid" style=\$\{cardGridStyle\(cards\.length\)\}/u);
  assert.match(source, /class="usage-insights-grid hui-card-grid" style=\$\{cardGridStyle\(rankings\.length\)\}/u);
  assert.equal(cardGridStyle(7), "--hui-card-grid-columns:4;--hui-card-grid-columns-compact:2;--hui-card-grid-columns-phone:1", "seven cards make four columns and three, never six and one");
  for (const property of ["--hui-card-grid-columns", "--hui-card-grid-columns-compact", "--hui-card-grid-columns-phone"]) {
    assert.match(grid, new RegExp(`repeat\\(var\\(${property}, 1\\), minmax\\(0, 1fr\\)\\)`, "u"), property);
  }
});

test("the time zone and the session order are HUI's picker, never the browser's select", () => {
  assert.doesNotMatch(source, /<select/u);
  for (const label of ["Time zone", "Sort sessions"]) {
    assert.match(source, new RegExp(`renderPicker\\(\\{ label: "${label}"`, "u"), label);
  }
  assert.equal(source.match(/showOptionTooltips: false/gu)?.length, 2, "option values never surface as browser tooltips");
});

test("every hover or focus detail opens HUI's tooltip, never the browser's", () => {
  assert.doesNotMatch(source, /\btitle=/u, "a native title would open the browser's own tooltip");
  assert.match(source, /element.className = "usage-tip"/u, "a chart bar and a calendar day explain themselves in HUI's card");
  assert.match(source, /setAttribute\("role", "tooltip"\)/u);
  assert.match(source, /data-hui-tooltip=\$\{`Show only sessions with \$\{row\.label\}`\}/u, "a ranked row explains itself");
  assert.match(source, /data-hui-tooltip="Download these sessions as a CSV"/u);
});

test("a donut slice and its legend row name the model, and the rest of the models keep one neutral slice", () => {
  assert.match(source, /const detail = \(segment: \(typeof segments\)\[number\]\) => `\$\{segment\.label\} · \$\{compact\(segment\.metrics\.totalTokens\)\} tokens · \$\{Math\.round\(segment\.share \* 100\)\}%`/u);
  assert.match(source, /class="usage-donut__segment"[^`]*@pointerenter=\$\{\(event: PointerEvent\) => \{ if \(event\.pointerType !== "touch"\) this\.#showTip\(event\.currentTarget as Element, detail\(segment\)\); \}\}/u, "a slice opens HUI's card instead of nothing");
  assert.match(source, /data-hui-tooltip=\$\{`\$\{detail\(segment\)\} · Click to show only these sessions`\}/u, "a legend row keeps its truncated name readable and says what pressing it does");
  assert.match(source, /index === rows\.length - 1 \? "var\(--muted\)"/u, "the other models' slice never reuses a model's colour");
});
