import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { agoLabel, COOLDOWN_CHOICES, whenLabel } from "./bot-triggers.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const between = (source: string, start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("Triggers is a section of the Routines tab, after the routines, self-contained with its own controller and styles", () => {
  const panel = read("./bots.ts");
  assert.match(panel, /import \{ renderBotTriggers, type BotTriggersProps \} from "\.\/bot-triggers\.ts";/u);
  assert.match(panel, /triggers: Omit<BotTriggersProps, "bot" \| "now">;/u);
  assert.match(between(panel, "function renderPanelTab(", "export function renderBotPanel("), /case "routines": return html`\$\{renderRoutinesTab\(props\)\}\$\{renderBotTriggers\(\{ bot: props\.bot, now: Date\.now\(\), \.\.\.props\.triggers \}\)\}`;/u);
  const app = read("../hui-app.ts");
  assert.match(app, /private botTriggers = new BotTriggersController\(this, \{ visible: \(\) => this\.botPanelVisible\(\) && this\.botPanel\.tab === "routines" \}\);/u);
  assert.match(app, /this\.botTools\.reset\(target\.id\);\n\s+this\.botTriggers\.reset\(target\.id\);/u, "another bot starts clean");
  assert.match(app, /this\.botTriggers\.sync\(visible && this\.botPanel\.tab === "routines" \? this\.activeBot\(\) : undefined\);/u, "read while the tab shows");
  assert.match(app, /triggers: this\.botTriggers\.props\(bot\),/u);
  assert.match(read("./bot-triggers.ts"), /await import\("\.\.\/styles\/bot-triggers\.css"\);/u);
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
  assert.match(card, /New URL/u, "a webhook trigger's URL can be replaced");
  assert.doesNotMatch(card, /tokenHash/u);
});

test("a webhook URL shows once with Copy, and the add form offers each source's fields", () => {
  const source = read("./bot-triggers.ts");
  const revealed = between(source, "function renderRevealed(", "function renderRun(");
  assert.match(revealed, /Copy it now: HUI keeps only a fingerprint of it and can't show it again\./u);
  assert.match(revealed, /props\.onCopy/u);
  const form = between(source, "function renderForm(", "/** The Triggers section");
  for (const source of ["github", "session", "webhook"]) assert.match(form, new RegExp(`bot-trigger-form__when--${source}`, "u"));
  assert.match(form, /name="githubEvents"/u);
  assert.match(form, /name="sessionEvents"/u);
  assert.match(form, /name="matchField"/u);
  assert.match(form, /Your own comments and reviews never wake/u);
  const styles = read("../styles/bot-triggers.css");
  assert.match(styles, /\.bot-trigger-form:has\(input\[name="source"\]\[value="webhook"\]:checked\) \.bot-trigger-form__when--webhook \{ display: flex; \}/u);
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
