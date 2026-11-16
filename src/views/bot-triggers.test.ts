import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import type { BotView } from "../api/schema/bots.ts";
import type { BotTriggersState, RevealedHook } from "../lib/bots/triggers.ts";
import { agoLabel, COOLDOWN_CHOICES, renderBotTriggers, whenLabel, type BotTriggersProps } from "./bot-triggers.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const between = (source: string, start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("triggers show on the overview and have a page of their own, self-contained with their own controller and styles", () => {
  const panel = read("./bots.ts");
  assert.match(panel, /triggers: Omit<BotTriggersProps, "bot" \| "now">;/u);
  assert.match(between(panel, "function renderPanelView(", "/* ── size"), /case "triggers": return renderBotTriggers\(\{ bot: props\.bot, now: Date\.now\(\), \.\.\.props\.triggers, adding: props\.openedFrom === "triggers-add" \}\);/u, "the overview's + opens the page on its add form");
  assert.match(between(panel, "function renderTriggersSummary(", "function renderActivity("), /renderSettingsToggle\(`Enable \$\{trigger\.name\}`, trigger\.enabled, \(checked\) => props\.triggers\.onToggle\(trigger, checked\), state\.pending\)/u, "each one switches on the overview too");
  assert.match(read("./bot-triggers.ts"), /loadViewAssets\(\(\) => import\("\.\.\/styles\/bot-triggers\.css"\)\);/u);
});

test("each trigger shows its source, what it watches, when it last fired, its cooldown and a switch, with Test and Delete", () => {
  const card = between(read("./bot-triggers.ts"), "function renderTrigger(", "function renderRevealed(");
  assert.match(card, /renderSettingsToggle\(`Enable \$\{trigger\.name\}`, trigger\.enabled, \(checked\) => props\.onToggle\(trigger, checked\), state\.pending\)/u);
  assert.match(card, /botTriggerFilterSummary\(trigger\)/u);
  assert.match(card, /Last fired \$\{agoLabel\(trigger\.lastFiredAt, props\.now\)\}/u);
  assert.match(card, /cooldown \$\{cooldownLabel\(trigger\.cooldownSeconds\)\}/u);
  assert.match(card, /sent together at \$\{whenLabel\(trigger\.pending\.until, props\.now\)\}/u, "what waits for the cooldown");
  assert.match(card, /aria-label=\$\{`Test \$\{trigger\.name\}`\}/u);
  assert.match(card, /aria-label=\$\{`Delete \$\{trigger\.name\}`\}/u);
  assert.match(card, /New URL/u, "a trigger's URL can be replaced");
  assert.match(card, /URL …\/hooks\/\$\{trigger\.tokenHint \?\? ""\}…/u, "and told apart by its first characters");
  assert.doesNotMatch(card, /tokenHash/u);
});

test("a trigger's URL shows once with Copy and what to send it, and the add form offers a listener's filter", () => {
  const source = read("./bot-triggers.ts");
  const revealed = between(source, "function renderHookHint(", "function renderRun(");
  assert.match(revealed, /Copy it now: HUI keeps only a fingerprint of it and can't show it again\./u);
  assert.match(revealed, /Give it to your listener: after every check it POSTs/u);
  assert.match(revealed, /props\.onCopy/u);
  const form = between(source, "function renderForm(", "/** The Triggers section");
  for (const name of ["matchField", "matchOp", "matchValue", "prLinks", "external", "bots"]) assert.match(form, new RegExp(`name="${name}"`, "u"));
  assert.match(form, /Each event wakes \$\{name\} once, events from before the trigger never do, and an empty report only says the listener is alive\./u);
  assert.doesNotMatch(form, /name="source"/u, "one kind: nothing to choose");
  const styles = read("../styles/bot-triggers.css");
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/iu, "theme tokens only, dark and light alike");
  assert.deepEqual(COOLDOWN_CHOICES, [0, 60, 300, 900, 3_600]);
});

test("times read as people say them", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(agoLabel("2026-10-07T11:59:40Z", now), "just now");
  assert.equal(agoLabel("2026-10-07T11:55:00Z", now), "5 min ago");
  assert.equal(agoLabel("2026-10-07T09:00:00Z", now), "3 h ago");
  assert.equal(agoLabel("2026-10-05T12:00:00Z", now), "2 d ago");
  assert.equal(agoLabel(undefined, now), "");
  assert.match(whenLabel("2026-10-07T12:05:00Z", now), /\d{1,2}:\d{2}/u);
});

test("a card says when its listener last reported, or the problem it or its silence reported", () => {
  const card = between(read("./bot-triggers.ts"), "function renderTrigger(", "function renderRevealed(");
  assert.match(card, /\$\{renderWatch\(trigger, props\.now\)\}/u);
  assert.match(card, /Listener reported /u);
  assert.match(card, /bot-trigger__meta--error/u);
});

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + text(template.values[i])).join("");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const BOT = { id: "b1", name: "Ada", handle: "ada" } as BotView;

/** The Triggers page with a URL just revealed, as the controller hands it to the view. */
const revealedPage = (revealed: RevealedHook): string => {
  const state: BotTriggersState = {
    botId: BOT.id, loading: false, error: "", pending: false, actionError: "", formError: "", notice: "", revealed,
    list: { triggers: [], runs: [], deliveries: { lastHour: 0, perHour: 12 } },
  };
  const actions: Omit<BotTriggersProps, "bot" | "now" | "state"> = {
    onCreate: async () => true, onFormError: () => {}, onToggle: () => {}, onTest: () => {}, onDelete: () => {}, onRotate: () => {},
    onCopy: () => {}, onDismissUrl: () => {}, onRetry: () => {},
  };
  return text(renderBotTriggers({ bot: BOT, now: Date.parse("2026-10-07T12:00:00Z"), state, ...actions }));
};

test("a URL on this machine reads as it always did; one on a worker says the listener runs there, and a worker with none shows its reason and no Copy", () => {
  const local = revealedPage({ triggerId: "t1", name: "Reviews", url: "http://gateway.test/__hui/hooks/abc", copied: false });
  assert.match(local, /Reviews: its URL/u);
  assert.match(local, /Copy it now: HUI keeps only a fingerprint of it and can't show it again\. Give it to your listener: after every check it POSTs <code>\{ "events": \[\.\.\.\] \}<\/code> to it from this machine or your tailnet, the list empty when nothing happened\./u);
  assert.match(local, /http:\/\/gateway\.test\/__hui\/hooks\/abc/u);
  assert.match(local, /aria-label=URL of Reviews/u, "the address keeps its own accessible name");
  assert.match(local, /bot-trigger-url__copy/u, "Copy is offered");

  const worker = revealedPage({ triggerId: "t1", name: "Reviews", url: "http://127.0.0.1:4180/__hui/hooks/abc", copied: false, note: "Your listener runs on devbox: it reports to this address there." });
  assert.match(worker, /Your listener runs on devbox: it reports to this address there\./u);
  assert.match(worker, /After every check it POSTs <code>\{ "events": \[\.\.\.\] \}<\/code> to it there, the list empty when nothing happened\./u);
  assert.doesNotMatch(worker, /from this machine or your tailnet|Give it to your listener/u, "the clause is the worker's, not this machine's");
  assert.match(worker, /http:\/\/127\.0\.0\.1:4180\/__hui\/hooks\/abc/u, "that machine's address, as it came");
  assert.match(worker, /bot-trigger-url__copy/u);

  const missing = revealedPage({ triggerId: "t1", name: "Reviews", copied: false, note: "HUI is not connected to devbox: connect it to take its listener URL." });
  assert.match(missing, /Reviews: its URL/u);
  assert.match(missing, /HUI is not connected to devbox: connect it to take its listener URL\./u, "the server's own sentence");
  assert.doesNotMatch(missing, /bot-trigger-url__copy|URL of Reviews|Copy it now|\{ "events"/u, "no address, nothing to copy");
  assert.match(missing, /Done/u);
});
