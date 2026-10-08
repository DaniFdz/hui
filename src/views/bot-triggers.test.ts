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
  assert.match(app, /this\.followBotTools\(\);\n\s+this\.followBotTriggers\(\);/u, "on every bots frame: a bot loaded after the tab opened, or woken");
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

test("the form offers Slack with the Review requests preset, and a Slack card says when Slack was read", () => {
  const source = read("./bot-triggers.ts");
  const form = between(source, "function renderForm(", "/** The Triggers section");
  assert.match(form, /bot-trigger-form__when--slack/u);
  assert.match(form, /name="slackEvents"/u);
  assert.match(form, /name="slackPrLinks"/u);
  assert.match(form, /name="slackFrom"/u);
  assert.match(form, /name="slackIn"/u);
  assert.match(form, /name="slackExternal"/u);
  assert.match(form, /name="slackBots"/u);
  assert.match(form, /@click=\$\{applyReviewPreset\}>\$\{icons\.messageSquare\}<span>Review requests<\/span>/u);
  assert.match(form, /nothing is ever posted/u);
  assert.match(form, /BOT_TRIGGER_SOURCES\.map/u, "every source, Slack included");
  const preset = between(source, "function applyReviewPreset(", "function renderForm(");
  assert.match(preset, /input\[name="source"\]\[value="slack"\]/u);
  assert.match(preset, /REVIEW_REQUESTS_PRESET\.prLinks/u);
  assert.match(preset, /!name\.value\.trim\(\)/u, "a name already typed stays");
  const card = between(source, "function renderTrigger(", "function renderRevealed(");
  assert.match(card, /trigger\.source === "github" \|\| trigger\.source === "slack"/u);
  assert.match(card, /Waiting for the first read of/u);
  assert.match(read("../styles/bot-triggers.css"), /\.bot-trigger-form:has\(input\[name="source"\]\[value="slack"\]:checked\) \.bot-trigger-form__when--slack \{ display: flex; \}/u);
});
