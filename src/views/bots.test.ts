import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const between = (source: string, start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("a bot shows its face, or its emoji while it has one, always decorative beside its name in text", () => {
  const source = read("./bots.ts");
  const avatar = between(source, "export function renderBotAvatar(", "function activityBadge(");
  assert.match(avatar, /const look = botLook\(bot\);/u);
  assert.match(avatar, /if \(look\.kind === "emoji"\)/u, "an emoji wins until someone switches the bot to its face");
  assert.match(avatar, /class="bot-avatar bot-avatar--\$\{size\} bot-avatar--emoji"[^>]*aria-hidden="true"/u);
  assert.match(avatar, /class="bot-avatar bot-avatar--\$\{size\} bot-avatar--face" aria-hidden="true"><hui-bot-face size=\$\{size\} shape=\$\{look\.shape\} \.color=\$\{look\.color\}/u);
  assert.match(avatar, /\.seed=\$\{look\.seed\} state=\$\{options\.state \?\? "idle"\} \.level=\$\{options\.level\}/u);
  assert.doesNotMatch(source, /botAvatar\(|data-tone=|initial/u, "the letter avatar is gone");
});

test("roster rows show each bot's state and keep their badges; archived bots sleep", () => {
  const source = read("./bots.ts");
  assert.match(between(source, "function botRow(", "function archivedRow("), /renderBotAvatar\(bot, "sm", \{ state: rosterFaceState\(bot\), badge: activityBadge\(bot\) \}\)/u);
  assert.match(between(source, "function archivedRow(", "function renderRosterToggles("), /renderBotAvatar\(bot, "sm", \{ state: "offline" \}\)/u);
});

test("the Settings tab's Look is Face (shape and color) or Emoji, as native radio groups, each choice saved on its own", () => {
  const source = read("./bot-settings.ts");
  const look = between(source, "function renderLook(", "/** Name, title and look, edited in place");
  assert.match(look, /<details class="settings-row bot-setting bot-look" data-setting="look">/u, "a row that opens into the editor");
  assert.match(look, /\$\{props\.face\(avatar\)\}/u, "the face as it will look, a pending choice included");
  assert.match(look, /role="radiogroup" aria-label="Look"/u);
  assert.match(look, /\[\["face", "Face"\], \["emoji", "Emoji"\]\]/u);
  assert.match(look, /if \(value === "face" && botSettingOf\(bot, "emoji"\)\) props\.onChange\("emoji", ""\);/u, "Face clears the emoji");
  assert.match(look, /role="radiogroup" aria-label="Shape"/u);
  assert.match(look, /aria-label=\$\{BOT_FACE_SHAPE_LABELS\[option\]\}/u, "each shape is named");
  assert.match(look, /@change=\$\{\(\) => props\.onChange\("shape", option\)\}/u);
  assert.match(look, /role="radiogroup" aria-label="Color"/u);
  assert.match(look, /@change=\$\{\(\) => props\.onChange\("color", entry\.hex\)\}/u);
  assert.match(look, /Custom \$\{custom\}/u, "a color set through the API stays choosable");
  assert.match(look, /name="emoji" type="text" maxlength="16"/u);
  assert.match(look, /onTextKeydown\(event, "emoji", props\)/u, "an emoji saves on Enter or blur");
  const css = readFileSync(new URL("../styles/bots.css", import.meta.url), "utf8");
  assert.match(css, /\.bot-look:has\(\.bot-look__kind input\[value="emoji"\]:checked\) \.bot-look__face \{ display: none; \}/u, "Emoji shows its field before one is saved");
});

test("the chat's header and empty chat show the open chat's state; the large face follows the pointer there", () => {
  const source = read("./home.ts");
  assert.match(source, /class="agent-chat__empty bot-chat-empty" data-face-stage>\$\{renderBotAvatar\(props\.bot\.bot, "lg", \{ state: botFaceState\(props\) \}\)\}/u);
  assert.match(source, /renderBotAvatar\(bot\.bot, "md", \{ state: face \}\)/u);
  const state = between(source, "function botFaceState(", "/** A bot's chat names the bot");
  assert.match(state, /question: Boolean\(props\.question\)/u);
  assert.match(state, /memoryWaiting: Boolean\(props\.bot\?\.bot\.memory\?\.waiting\)/u);
  assert.match(state, /toolRunning: props\.streaming && hasRunningTool\(props\.transcript\)/u);
  assert.match(state, /failed: Boolean\(props\.runError\)/u);
});

test("a call shows the bot's face listening to the microphone and speaking with its voice, tinted with its color", () => {
  const source = read("./bot-voice.ts");
  const view = between(source, "export function renderCallView(", "/** The minimized call");
  assert.match(view, /style=\$\{`--bot-color: \$\{look\.color\}`\} data-face-stage/u);
  assert.match(view, /renderBotAvatar\(bot, "xl", \{ state: callFaceState\(state, props\.summarizing\), \.\.\.\(props\.level \? \{ level: props\.level \} : \{\}\) \}\)/u);
  assert.match(view, /<p class="bot-call__status" role="status" aria-live="polite">\$\{callStatusLabel\(state, props\.summarizing, bot\.name\)\}<\/p>/u, "the status stays in text");
  const bar = between(source, "export function renderCallBar(", "\n}\n");
  assert.match(bar, /renderBotAvatar\(bot, "sm", \{ state: callFaceState\(state, props\.summarizing\) \}\)/u);
  assert.match(bar, /class="bot-call-bar__pulse"/u, "the bar keeps its live dot");
  const app = read("../hui-app.ts");
  assert.match(app, /this\.voice\.call\?\.state\.phase === "speaking" \? this\.voice\.voiceLevel\(\) : this\.voice\.micLevel\(\)/u);
  assert.match(app, /voiceLevel: \(\) => voicePlayer\(\)\.level\(\)/u);
});

test("faces are decorative, pause when unseen and keep still under reduced motion", () => {
  const component = read("../components/bot-face.ts");
  assert.match(component, /this\.setAttribute\("aria-hidden", "true"\);/u);
  assert.match(component, /<svg class="bot-face" viewBox=\$\{VIEW_BOX\[size\]\} focusable="false" aria-hidden="true"/u);
  assert.match(component, /const active = this\.#connected && !prefersReducedMotion\(\) && \(typeof document === "undefined" \|\| !document\.hidden\) && onScreen\.get\(this\) !== false;/u);
  assert.match(component, /this\.toggleAttribute\("data-paused", this\.#connected && !active\);/u);
  assert.match(component, /document\.addEventListener\("visibilitychange", notifyAll\)/u);
  assert.match(component, /new IntersectionObserver\(/u, "one observer for every face");
  const styles = read("../styles/bot-face.css");
  assert.match(styles, /hui-bot-face\[data-paused\] :is\(\.fx, \.bot-face__shadow, \.bot-face__thoughts circle\) \{ animation-play-state: paused; \}/u);
  const reduced = styles.slice(styles.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /:is\(\.fx, \.bot-face__shadow, \.bot-face__thoughts circle\) \{ animation: none !important; \}/u);
  assert.match(reduced, /:is\(\.bot-face__gaze, \.bot-face__eyes, \.e-open\) \{ transition: none; \}/u);
  assert.match(reduced, /svg\[data-state="waiting"\] \.bot-face__tilt \{ transform: rotate\(8deg\); \}/u, "waiting keeps its tilt, still");
  for (const state of ["idle", "thinking", "working", "waiting", "memory", "error", "done", "offline"]) assert.match(styles, new RegExp(`svg\\[data-state="${state}"\\]`, "u"), state);
});

test("emoji tiles take a face's width in rows, so names line up whichever look a bot has", () => {
  const css = readFileSync(new URL("../styles/bots.css", import.meta.url), "utf8");
  const faceCss = readFileSync(new URL("../styles/bot-face.css", import.meta.url), "utf8");
  const px = (pattern: RegExp, text: string) => Number(text.match(pattern)?.[1]);
  const tile = px(/\.bot-avatar \{[^}]*?\n  width: (\d+)px;/u, css);
  assert.equal(tile, 28);
  for (const size of ["sm", "md"]) {
    const face = px(new RegExp(String.raw`hui-bot-face\[size="${size}"\] \{ --bot-face-size: (\d+)px; \}`, "u"), faceCss);
    const margin = px(new RegExp(String.raw`\.bot-avatar--${size}\.bot-avatar--emoji \{ margin-inline: (\d+)px; \}`, "u"), css);
    assert.equal(tile + 2 * margin, face, size);
  }
});

test("+ creates a bot named New Bot at once and opens its chat, as in Grok Bot; no dialog is left", () => {
  const app = read("../hui-app.ts");
  const create = between(app, "private createNewBot = ", "/** The roster's Edit");
  assert.match(create, /if \(this\.botCreating\) return;/u, "one at a time");
  assert.match(create, /void createBot\(\{\}\)/u, "no name (the gateway calls it New Bot and its first turn asks for one), everything else on the defaults");
  assert.match(create, /this\.navigate\(\{ kind: "bot", id: bot\.id \}\);/u, "its chat opens");
  assert.match(create, /this\.botNotice = error instanceof Error \? error\.message : "Could not create a bot\.";\n\s+this\.botNoticeFailed = true;/u, "a refusal shows in the roster");
  assert.match(create, /_options: NewBotOptions = \{\}/u, "the hook for the workers pull request's runsOn");
  assert.match(app, /onNew: this\.createNewBot,\n\s+creating: this\.botCreating,/u);
  const shell = read("./shell.ts");
  assert.match(shell, /data-new-bot-trigger \?disabled=\$\{botsTab\.creating\}/u, "+ waits for the bot it is creating");
  const source = read("./bots.ts");
  assert.match(source, /props\.creating \? "Creating…" : "New bot"/u, "and so does the empty roster's New bot");
  for (const file of [source, app]) assert.doesNotMatch(file, /renderBotDialog\b|bot-dialog|botDialog|botDraft/u, "the New bot and Edit dialogs are gone");
  assert.match(read("../lib/bots.ts"), /export type NewBotInput = Omit<BotInput, "name"> & \{ name\?: string \};/u, "the create body may leave the name out");
});

test("the Settings tab: Profile, Model, Calls (with GPT-Live calls) and Workspace, each change saved on its own", () => {
  const source = read("./bot-settings.ts");
  const tab = between(source, "export function renderBotSettings(", "\n}\n");
  assert.ok(tab.indexOf("renderProfile(props)") < tab.indexOf("renderModels(props)") && tab.indexOf("renderModels(props)") < tab.indexOf("renderCalls(props)")
    && tab.indexOf("renderCalls(props)") < tab.indexOf("renderWorkspace(props)"), "Profile on top, then Model, Calls and Workspace");
  const profile = between(source, "/** Name, title and look, edited in place", "function renderModels(");
  assert.match(profile, /setting: "name", keys: \["name"\]/u);
  assert.match(profile, /setting: "title", keys: \["title"\]/u);
  assert.match(profile, /onTextKeydown\(event, "name", props\)\} @blur=\$\{\(event: FocusEvent\) => onTextBlur\(event, "name", props\)\}/u, "the name saves on Enter or blur");
  assert.match(profile, /\$\{renderLook\(props\)\}/u, "then the look");
  const models = between(source, "function renderModels(", "/** The call voice:");
  for (const [setting, key] of [["model", "model"], ["thinking", "thinking"], ["utility", "memoryModel"]]) {
    assert.match(models, new RegExp(`setting: "${setting}", keys: \\["${key}"\\]`, "u"));
    assert.match(models, new RegExp(`props\\.onChange\\("${key}", next\\)`, "u"), `${key} saves as it changes`);
  }
  assert.match(models, /"Applies from its next turn"/u);
  assert.match(models, /modelOptions\(props\.models, "Gateway default", model\)/u, "Gateway default clears the model");
  const calls = between(source, "/** The call voice:", "/** The text controls");
  assert.match(calls, /if \(!props\.call\) return nothing;/u, "Calls show while the call prop does (calls on GPT-Live)");
  assert.match(calls, /sectionHead\(props, "calls", "Calls"\)/u);
  assert.match(calls, /renderCallVoiceRow\(props, props\.call\)\}[\s\S]*renderLanguageRow\(props\)/u, "the call voice, then the language");
  assert.match(calls, /How it sounds on calls\. Default follows Settings → Models → Calls\./u);
  assert.doesNotMatch(source, /VoiceStudio|Read-aloud|Preview|voiceSpeed/u, "nothing of VoiceStudio");
  const workspace = between(source, "function renderWorkspace(", "export function renderBotSettings(");
  assert.match(workspace, /const busy = botIsBusy\(props\.bot\);/u);
  assert.match(workspace, /disabled: busy/u, "the directory can move only while the bot is idle");
  assert.match(source, /if \(event\.key === "Enter"\) \{\n\s+event\.preventDefault\(\);\n\s+commitText\(input, key, props, true\);/u, "Enter saves a text control, the directory too");
  assert.match(source, /@focusout=\$\{\(event: FocusEvent\) => onDirectoryFocusOut\(event, props\)\}/u, "and so does leaving it");
  assert.match(between(source, "function renderRow(", "function sectionHead("), /<span class="bot-setting__status" role="status">\$\{pending \? "Saving…" : ""\}<\/span>/u, "a pending save shows on its row");
  assert.match(between(source, "function renderRow(", "function sectionHead("), /<p class="bot-setting__error" role="alert">/u, "and so does a refusal");
  assert.doesNotMatch(source, /type="submit"|>Save</u, "no Save button");
  const app = read("../hui-app.ts");
  assert.match(app, /this\.botSettingsQueue = this\.botSettingsQueue\.then\(\(\) => this\.sendBotSetting\(botId, key\)\);/u, "one PATCH per change, in order");
  assert.match(between(app, "private async sendBotSetting(", "private dismissBotSetting("), /updateBot\(botId, patch\)/u, "through PATCH /__hui/bots/:id");
  assert.match(app, /return this\.settings\.calls\.engine === "gpt-live" \? \{ defaultVoice: this\.settings\.calls\.voice \} : undefined;/u);
});

test("the roster's Edit opens the bot's chat on its Settings tab, docked or as the sheet", () => {
  const source = read("./bots.ts");
  assert.match(source, /<span class="session-menu__text">Edit bot…<\/span>/u, "the ellipsis of a place to make choices, as Settings… has, and as the header's ⋯ menu says");
  const app = read("../hui-app.ts");
  assert.match(between(app, "private openEditBot = ", "private showBotSettings("), /this\.showBotSettings\(bot\.id\);/u);
  const show = between(app, "private showBotSettings(", "private toggleBotSettings(");
  assert.match(show, /this\.navigate\(\{ kind: "bot", id: botId \}\)/u);
  assert.match(show, /this\.botPanel = \{ open: this\.mobileNavLayout \? this\.botPanel\.open : true, tab: "settings" \};/u);
  assert.match(show, /if \(this\.mobileNavLayout\) this\.botSheetOpen = true;/u, "the sheet on narrow screens");
  assert.match(show, /\.bot-panel \[role="tab"\]\[aria-selected="true"\]'\)\?\.focus\(\)/u, "the focus lands on the tab");
  assert.doesNotMatch(app, /mode: "edit"/u, "the old Edit dialog is gone");
});

test("the panel's tabs take their own row under the header and keep their keys; Ctrl+Shift+, toggles Settings", () => {
  const source = read("./bots.ts");
  const panel = between(source, "export function renderBotPanel(", "/* ── New bot and Edit profile dialogs");
  assert.match(panel, /<header class="bot-panel__header">\s*<h2 class="bot-panel__title">\$\{props\.bot\.name\}<\/h2>\s*<button[^>]*bot-panel__close/u, "the header: the bot's name and Close");
  assert.match(panel, /<\/header>\s*<div class="bot-panel__tabs" role="tablist"/u, "the tabs right under it, a row of their own");
  assert.match(panel, /@keydown=\$\{\(event: KeyboardEvent\) => onPanelTabKeydown\(event, props\)\}/u, "arrows, Home and End");
  assert.match(panel, /title=\$\{tab === "settings" \? `Settings \(\$\{botSettingsShortcutLabel\(\)\}\)` : nothing\}/u);
  assert.match(source, /case "settings": return keyed\(props\.bot\.id, renderBotSettings\(/u, "another bot's Settings start afresh");
  const css = readFileSync(new URL("../styles/bots.css", import.meta.url), "utf8");
  const tabs = css.match(/\.bot-panel__tabs \{[^}]*\}/u)?.[0] ?? "";
  assert.match(tabs, /overflow-x: auto;/u, "a larger text scale scrolls the row instead of clipping a label");
  assert.match(tabs, /box-shadow: inset 0 -1px 0/u, "the divider is drawn inside, so the underline is not clipped");
  const tab = css.match(/\.bot-panel__tab \{[^}]*\}/u)?.[0] ?? "";
  assert.match(tab, /flex: 1 0 auto;/u, "tabs grow to fill the row and never shrink below their labels");
  assert.match(tab, /white-space: nowrap;/u);
  assert.doesNotMatch(tabs, /[\s;{]width: \d/u, "no fixed width");
  const app = read("../hui-app.ts");
  assert.match(app, /if \(isBotSettingsShortcut\(event\)\) \{\n\s+if \(this\.view !== "bot" \|\| this\.settingsOpen \|\| this\.commandPaletteOpen \|\| document\.querySelector\("dialog\[open\]"\)\) return;/u);
  assert.match(between(app, "private toggleBotSettings(", "private openEditProfile("), /if \(this\.botPanelVisible\(\) && this\.botPanel\.tab === "settings"\) this\.closeBotPanel\(\);\n\s+else this\.showBotSettings\(bot\.id\);/u);
});

test("the Settings tab uses no fixed heights that could clip it", () => {
  const css = readFileSync(new URL("../styles/bots.css", import.meta.url), "utf8");
  const tab = css.slice(css.indexOf("/* ── Settings tab"), css.indexOf("/* The Look:"));
  assert.doesNotMatch(tab, /(^|[\s;{])(max-)?height: \d/mu, "no fixed or maximum height");
  assert.match(tab, /\.bot-settings \.settings-row\.bot-setting \{[^}]*min-height: 0;/u, "compact rows");
  assert.match(tab, /\.bot-settings \.bot-setting--stacked \.settings-row__control \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/u, "a stacked control takes the row's width");
  assert.doesNotMatch(css, /\.bot-dialog/u, "no dialog styles are left");
});
