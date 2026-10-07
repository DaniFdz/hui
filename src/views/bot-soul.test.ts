import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const between = (source: string, start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("nothing asks for Instructions: no New or Edit dialog is left, and + creates a bot that starts by asking", () => {
  for (const file of ["./bots.ts", "./bot-settings.ts"]) {
    assert.doesNotMatch(read(file), /Instructions|instructions/u, `${file}: the persona is the SOUL.md the bot writes`);
  }
  assert.doesNotMatch(read("./bots.ts"), /renderBotDialog\b|BotFormValues/u, "the New and Edit dialogs are gone");
  assert.match(read("../hui-app.ts"), /void createBot\(worker \? \{ worker \} : \{\}\)/u, "no name: the bot is New Bot and asks what to call it, here or on the worker chosen");
  assert.doesNotMatch(read("../styles/bots.css"), /bot-dialog__instructions/u);
});

test("the bot panel is Routines | Memory | Soul | Settings, one tablist with the same keys and remembered tab", () => {
  const source = read("./bots.ts");
  assert.match(source, /const PANEL_TAB_LABELS: Record<BotPanelTab, string> = \{ routines: "Routines", memory: "Memory", soul: "Soul", settings: "Settings" \};/u);
  const panel = between(source, "export function renderBotPanel(", "/* ── archive confirmation");
  assert.match(panel, /\$\{BOT_PANEL_TABS\.map\(\(tab\) => html`<button type="button" role="tab"/u);
  assert.match(panel, /@keydown=\$\{\(event: KeyboardEvent\) => onPanelTabKeydown\(event, props\)\}/u);
  assert.match(panel, /\$\{renderPanelTab\(props\)\}/u);
  assert.match(between(source, "function renderPanelTab(", "export function renderBotPanel("), /case "soul": return renderSoulTab\(props\);/u);
  assert.match(panel, /aria-label=\$\{`\$\{props\.bot\.name\}: bot panel`\}/u, "named for the bot, whatever its tabs");
  assert.match(read("../lib/bot-roster.ts"), /tab: BOT_PANEL_TABS\.find\(\(tab\) => tab === raw\["tab"\]\) \?\? "routines"/u, "the stored tab may be Soul or Settings");
  assert.match(read("./home.ts"), /aria-label=\$\{props\.bot\.panelOpen \? "Hide the bot panel" : "Show the bot panel"\} title="Bot panel"/u);
});

test("Soul shows SOUL.md through the chat's markdown renderer, with Edit; without one, what the first conversation does", () => {
  const tab = between(read("./bots.ts"), "function renderSoulTab(", "export function renderBotPanel(");
  assert.match(tab, /<div class="chat-text bot-soul__body">\$\{renderMarkdown\(state\.soul\)\}<\/div>/u, "the chat's renderer and its text styles");
  assert.match(tab, /<p class="bot-soul__empty-title">\$\{name\} writes its soul in your first conversation<\/p>/u);
  assert.match(tab, /\$\{icons\.edit\}<span>Write it yourself<\/span>/u);
  assert.match(tab, /aria-label=\$\{`Edit \$\{name\}'s soul`\} @click=\$\{soul\.onEdit\}>\$\{icons\.edit\}<span>Edit<\/span>/u);
  assert.match(tab, /Reading \$\{name\}'s soul…/u);
  assert.match(tab, /role="alert">\$\{state\.error\} <button type="button" class="btn btn--sm" @click=\$\{soul\.onRetry\}>Retry<\/button>/u);
  assert.match(tab, /Refresh failed: \$\{state\.error\}/u, "a failed refresh keeps what was shown");
  assert.match(tab, /state\.soul\.length > BOT_LIMITS\.soul/u, "a longer SOUL.md says how much the bot reads");
});

test("Edit is a textarea with Save and Cancel: the count against the limit, errors inline, Escape cancels inside the sheet", () => {
  const editor = between(read("./bots.ts"), "function renderSoulEditor(", "/** SOUL.md as markdown with Edit;");
  assert.match(editor, /<textarea class="settings-input bot-soul__textarea" name="soul"/u);
  assert.match(editor, /\$\{soul\.saveError \? html`<p class="bot-field__error" role="alert">\$\{soul\.saveError\}<\/p>` : nothing\}/u);
  assert.match(editor, /\?disabled=\$\{soul\.saving \|\| over\}>\$\{soul\.saving \? "Saving…" : "Save"\}/u);
  assert.match(editor, />Cancel<\/button>/u);
  assert.match(editor, /if \(event\.key !== "Escape" \|\| soul\.saving\) return;\n\s+event\.preventDefault\(\);\n\s+event\.stopPropagation\(\);\n\s+soul\.onCancel\(\);/u, "the sheet's own Escape stays out of it");
  assert.match(editor, /Saved empty, SOUL\.md goes and \$\{props\.bot\.name\} asks what you expect from it again\./u);
  const app = read("../hui-app.ts");
  assert.match(app, /\.catch\(\(error: unknown\) => \{\n\s+this\.botSoulSaveError = error instanceof Error \? error\.message : "Could not save the soul\.";/u, "a refusal stays in the editor");
  assert.match(app, /this\.botSoulDraft = this\.botSoul\.soul \?\? "";/u, "Write it yourself opens it empty");
});

test("the open Soul tab follows SOUL.md from the bots stream, once the bot's turn is over, without a timer", () => {
  const app = read("../hui-app.ts");
  const follow = between(app, "private followBotSoul()", "private resetBotSoul(");
  assert.match(follow, /bot\.status === "running" \|\| bot\.status === "waiting"\) return;/u);
  assert.match(follow, /if \(botSoulKey\(bot\) !== this\.botSoulSeen\) void this\.refreshBotSoul\(\);/u);
  assert.match(app, /this\.followBotMemory\(\);\n\s+this\.followBotSoul\(\);/u, "on every bots frame");
  assert.match(app, /if \(this\.botSoulTabVisible\(\)\) void this\.refreshBotSoul\(\);/u, "on opening the tab");
  assert.match(app, /this\.resetBotMemory\(target\.id\);\n\s+this\.resetBotSoul\(target\.id\);/u, "another bot starts clean");
  assert.doesNotMatch(follow, /setInterval|setTimeout/u);
});

test("HUI's kickoff of a new bot shows as a small centered note, not the operator's bubble", () => {
  const home = read("./home.ts");
  assert.match(home, /if \(row\.kind === "botCreated"\) return renderBotCreated\(props, row\);/u);
  const note = between(home, "function renderBotCreated(", "/** OpenClaw's completed compaction marker");
  assert.match(note, /const name = row\.name \|\| props\.bot\?\.bot\.name \|\| "This bot";/u);
  assert.match(note, /<div class="chat-notice chat-bot-created" data-chat-row-key=\$\{row\.id\}>\$\{compactionRule\(`\$\{name\} was created`\)\}<\/div>/u, "the chat's divider, as for a compaction");
  assert.match(read("./chat/projection.ts"), /const created = botKickoffName\(item\.text\);\n\s+if \(created !== undefined\) \{\n\s+rows\.push\(\{ kind: "botCreated", id: item\.id, name: created \}\);/u);
});

test("the Soul tab has its own styles, reusing the panel's cards, fields and buttons", () => {
  const styles = read("../styles/bots.css");
  for (const selector of [".bot-soul__toolbar", ".bot-soul__body", ".bot-soul__empty", ".bot-soul__editor", ".bot-field textarea.bot-soul__textarea", ".bot-soul__actions"]) {
    assert.ok(styles.includes(`${selector} `) || styles.includes(`${selector},`), selector);
  }
  assert.match(styles, /\.bot-soul__body \{[^}]*background: var\(--card\);/u, "theme tokens only: dark and light alike");
});
