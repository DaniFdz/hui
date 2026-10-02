import assert from "node:assert/strict";
import test from "node:test";
import { renderWatcherCard, watcherTargetLabel, type WatcherCardProps } from "./watcher-card.ts";
import type { Watcher } from "../../lib/watchers.ts";

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + text(template.values[i])).join("");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const watcher: Watcher = {
  id: "w1",
  purpose: "Wait for #21532 approval",
  target: "https://github.com/ddoghq/web-ui/pull/21532",
  outcome: "post /merge",
  command: "bash ~/.local/state/pr-watch/merge-21532.sh",
  logPath: "/Users/dani/.config/hui/watchers/w1.log",
  state: "running",
  pid: 4242,
  startedAt: "2026-10-02T10:00:00.000Z",
  lastLine: "2026-10-02 10:05:00 OPEN REVIEW_REQUIRED",
};

function render(overrides: Partial<WatcherCardProps> = {}, watcherOverrides: Partial<Watcher> = {}): string {
  const noop = () => {};
  const props: WatcherCardProps = {
    watchers: [{ ...watcher, ...watcherOverrides }],
    pendingId: "",
    log: null,
    onStop: noop, onRestart: noop, onDismiss: noop, onViewLog: noop, onHideLog: noop,
    ...overrides,
  };
  return text(renderWatcherCard(props));
}

test("a running watcher shows its purpose, target, outcome, latest line and Stop", () => {
  const card = render();
  assert.match(card, /Wait for #21532 approval/u);
  assert.match(card, /github\.com\/ddoghq\/web-ui\/pull\/21532/u);
  assert.match(card, /Then: post \/merge/u);
  assert.match(card, /2026-10-02 10:05:00 OPEN REVIEW_REQUIRED/u);
  assert.match(card, /Running/u);
  assert.match(card, />Stop</u);
  assert.doesNotMatch(card, />Restart</u);
  assert.match(card, /View log/u);
});

test("a settled watcher offers Restart and Dismiss instead of Stop", () => {
  const card = render({}, { state: "dead", exitCode: undefined, lastLine: "" });
  assert.match(card, /Dead · no exit recorded/u);
  assert.match(card, /No output recorded\./u);
  assert.match(card, />Restart</u);
  assert.match(card, />Dismiss</u);
  assert.doesNotMatch(card, />Stop</u);
});

test("an open log shows its lines, truncation note and Close", () => {
  const card = render({ log: { id: "w1", lines: ["one", "two"], truncated: true, loading: false } });
  assert.match(card, /2 lines · earlier lines hidden/u);
  assert.match(card, /<pre[^>]*>one\ntwo<\/pre>/u);
  assert.match(card, />Close</u);
  assert.match(card, />Refresh</u);
  assert.doesNotMatch(card, /View log/u);
});

test("a pending action marks the card busy and an empty list renders nothing", () => {
  assert.match(render({ pendingId: "w1" }), /aria-busy=true/u);
  const noop = () => {};
  const empty: WatcherCardProps = {
    watchers: [], pendingId: "", log: null,
    onStop: noop, onRestart: noop, onDismiss: noop, onViewLog: noop, onHideLog: noop,
  };
  assert.equal(text(renderWatcherCard(empty)), "");
});

test("watcherTargetLabel strips the scheme and clamps long URLs", () => {
  assert.equal(watcherTargetLabel("https://www.github.com/o/r/pull/1"), "github.com/o/r/pull/1");
  assert.equal(watcherTargetLabel(`https://example.com/${"x".repeat(120)}`).length, 78);
});
