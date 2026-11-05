/**
 * The Usage page keeps HUI's own presentation: the shared card grid whose columns follow the number of cards, HUI's
 * picker for its two choices, and HUI's tooltip rather than the browser's for every hover or focus detail.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import type { UsageMetrics, UsageModel } from "../api/schema/diagnostics.ts";
import { cardGridStyle } from "../lib/card-grid.ts";
import { renderBarTip } from "./usage.ts";

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

/** A template's text with every nested template and value in place; handlers and directives drop out. */
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: readonly unknown[] };
    return template.strings.map((part, index) => part + (index < template.values.length ? text(template.values[index]) : "")).join("");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const number = new Intl.NumberFormat().format;
const metrics = (tokens: number, costUsd: number | null): UsageMetrics => ({ inputTokens: 40, outputTokens: 2, cacheReadTokens: 900, cacheWriteTokens: 60, totalTokens: tokens, costUsd, calls: 3, unpricedCalls: costUsd === null ? 3 : 0, userMessages: 1, assistantMessages: 2, toolResults: 1, errors: 1 });
const model = (name: string, usage: UsageMetrics): UsageModel => ({ provider: "fixture", model: name, metrics: usage });
const empty = { ...metrics(0, null), inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 0, unpricedCalls: 0, userMessages: 0, assistantMessages: 0, toolResults: 0, errors: 0 };

test("a bar's card names the day, every model it used and the period's own numbers", () => {
  const card = text(renderBarTip("Oct 19", metrics(300, 1.5), [model("large", metrics(200, 1.25)), model("swift", metrics(100, 0.25))]));
  assert.match(card, /Oct 19/u);
  assert.match(card, /fixture\/large/u, "a row names the provider as well as the model");
  assert.ok(card.includes(`${number(200)} tokens`), "each model carries its own tokens");
  assert.ok(card.includes(`${number(100)} tokens`));
  assert.ok(card.includes(`${number(300)} tokens`), "the period's own total sits below the models");
  assert.match(card, /\$\d/u, "a recorded price is shown in dollars");
  for (const detail of ["Input", "Output", "Cache write", "Cache read", "3 usage records", "1 error"]) assert.match(card, new RegExp(detail, "u"));
});

test("a long list of models stops at six, and an empty period says so once", () => {
  const many = Array.from({ length: 8 }, (_, index) => model(`m${index}`, metrics(10 - index, 0.1)));
  const card = text(renderBarTip("Oct 2026", metrics(80, 0.8), many));
  assert.match(card, /fixture\/m5/u);
  assert.doesNotMatch(card, /fixture\/m6/u);
  assert.match(card, /2 more models/u);
  const emptyCard = text(renderBarTip("Oct 20", empty, []));
  assert.match(emptyCard, /0 tokens · No recorded usage/u);
  assert.doesNotMatch(emptyCard, /fixture\//u);
});

test("a period's only model does not repeat its numbers as a total, unless something else spent too", () => {
  const spent = metrics(300, 1.5);
  const alone = text(renderBarTip("Nov 3", spent, [model("large", spent)]));
  assert.equal(alone.match(/300 tokens/gu)?.length, 1, "one model that accounts for the period is named once");
  const toolSpend = text(renderBarTip("Nov 3", { ...spent, totalTokens: 322, costUsd: 1.75 }, [model("large", spent)]));
  assert.match(toolSpend, /322 tokens · \$1\.75/u, "a tool's own model calls keep their total line");
});
