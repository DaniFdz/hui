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
  assert.match(read("../lib/voice-controller.ts"), /return this\.call \? this\.#session\?\.voiceLevel : 0;/u, "the bot's voice is GPT-Live's stream, as it plays");
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

test("with Settings → Labs → Bots off the sidebar has no Agents | Bots switch, bot addresses land home and nothing of bots shows; on, it all comes back", () => {
  const app = read("../hui-app.ts");
  assert.doesNotMatch(app, /settings\.bots\.showTab/u, "every bot surface asks botsTabShown or botsEnabled, which need Labs → Bots");
  // The switch, and with it every unread mark on the Bots tab, goes with the setting; the remembered choice stays put.
  assert.match(between(app, "private shellBotsProps(", "private createNewBot"), /^private shellBotsProps\(\): ShellBotsProps \| undefined \{\n\s+if \(!botsTabShown\(this\.settings\)\) return undefined;/u);
  assert.match(read("./shell.ts"), /\$\{props\.bots \? html`<div class="sidebar-switch">\$\{renderSidebarTabs\(props\.bots\)\}<\/div>` : nothing\}/u, "no props, no switch");
  assert.doesNotMatch(between(app, "private followBotsSetting(", "private shellBotsProps("), /writeSidebarTab/u, "a remembered Bots choice shows Agents while off, and Bots again once on");
  // /bots and /bots/:id land on the normal home; a bot's chat opens nowhere, even through a session address.
  assert.match(between(app, "private applyNavigation(", "private openPendingSession("), /if \(target\.kind === "bot"\) \{[\s\S]*?if \(this\.embeddedPane \|\| !botsTabShown\(this\.settings\)\) \{\n\s+this\.navigate\(\{ kind: "home" \}, true\);/u);
  assert.match(between(app, "private openPendingSession(", "private selectView"), /if \(session\.bot && !botsEnabled\(this\.settings\)\) \{\n\s+this\.navigate\(\{ kind: "home" \}, true\);\n\s+return;\n\s+\}/u);
  assert.match(app, /const wanted = botsTabShown\(this\.settings\) && !this\.botsStreamUnsupported;/u, "no bot stream while off");
  // Bot chats stay out of the Agents list on or off: it filters by the session's bot, not by a setting.
  assert.match(between(app, "private get listedGroups(", "private activeBot("), /if \(this\.listedGroupsSource !== this\.groups\) \{\n\s+this\.listedGroupsSource = this\.groups;\n\s+this\.listedGroupsCache = withoutBotSessions\(this\.groups\);/u);
  // Either way it applies at once: the setting's change follows here, and another screen's through the stream's 409.
  assert.match(app, /if \(changed\.has\("settings"\)\) \{\n\s+const before = changed\.get\("settings"\) as Settings \| undefined;\n\s+if \(before && \(botsEnabled\(before\) !== botsEnabled\(this\.settings\) \|\| botsTabShown\(before\) !== botsTabShown\(this\.settings\)\)\) this\.followBotsSetting\(\);/u);
  const follow = between(app, "private followBotsSetting(", "private shellBotsProps(");
  assert.match(follow, /if \(botsTabShown\(this\.settings\)\) \{\n\s+void settingsWritten\(\)\.then\(\(\) => this\.syncBotsStream\(\)\);\n\s+return;\n\s+\}\n\s+this\.syncBotsStream\(\);/u, "the stream starts once the gateway has the setting, and stops at once");
  assert.match(follow, /if \(!botsEnabled\(this\.settings\) && this\.voice\.call\) this\.voice\.hangUp\(\);/u, "a call ends with bots");
  assert.match(follow, /if \(this\.view === "bot" \|\| \(!botsEnabled\(this\.settings\) && this\.view === "home" && this\.selected\?\.bot\)\) this\.navigate\(\{ kind: "home" \}, true\);/u, "a bot's page goes home, and so does its chat open as a session");
  const off = between(app, "if (state === \"off\") {", "} else if (!wanted && this.botsStreamStop)");
  assert.match(off, /void settingsWritten\(\)\.then\(refreshSettings\)\.then\(\(settings\) => \{\n\s+if \(!settings\) return;\n\s+this\.settings = settings;/u, "a 409 reads the settings again once this screen's writes landed");
  assert.match(off, /if \(retry && botsTabShown\(settings\)\) \{\n\s+this\.botsStreamRetried = true;\n\s+this\.syncBotsStream\(\);/u, "still on: asked once more, never in a loop");
  assert.match(app, /if \(state === "live"\) this\.botsStreamRetried = false;/u);
  // Bot-only settings go too: Sessions → Bots, Models → Calls, and Automations' routines.
  const settings = read("./settings.ts");
  assert.match(between(settings, "function renderCallsSection(", "function renderModelsPage("), /if \(!botsEnabled\(props\.settings\)\) return nothing;/u);
  assert.match(between(settings, "function renderSessionsSettingsPage(", "function renderWorktreesSettingsPage("), /\$\{botsEnabled\(props\.settings\) \? renderSection\("Bots",/u);
  assert.match(between(settings, "function renderModelsPage(", "PI defaults"), /Two roles: the primary model does the real work and the utility model the quick work\./u, "the models' intro names no calls while they are hidden");
  assert.match(app, /sessions: this\.groups\.flatMap\(\(group\) => group\.sessions\),\n\s+bots: botsEnabled\(this\.settings\),/u);
});

test("+ creates a bot at once, without a name, and opens its chat, as in Grok Bot; no dialog is left", () => {
  const app = read("../hui-app.ts");
  const create = between(app, "private createNewBot = ", "/** The roster's Edit");
  assert.match(create, /if \(this\.botCreating\) return;/u, "one at a time");
  assert.match(create, /void createBot\(worker \? \{ worker \} : \{\}\)/u, "no name (the gateway calls it New Bot and its first turn asks for one), on the machine chosen, everything else on the defaults");
  assert.match(create, /this\.navigate\(\{ kind: "bot", id: bot\.id \}\);/u, "its chat opens");
  assert.match(create, /this\.botNotice = error instanceof Error \? error\.message : "Could not create a bot\.";\n\s+this\.botNoticeFailed = true;/u, "a refusal (an offline worker, say) shows in the roster");
  assert.match(create, /this\.botNotice = `Creating a bot on \$\{this\.launchWorkers\.find\(\(candidate\) => candidate\.id === worker\)\?\.name \?\? "the worker"\}…`;/u, "a worker can take a moment: the roster says where");
  assert.match(app, /onNew: \(\) => this\.createNewBot\(\),\n\s+workers: this\.launchWorkers,\n\s+onCreate: \(worker\) => this\.createNewBot\(worker\),\n\s+onWorkersMenu: \(\) => this\.loadLaunchWorkers\(\),\n\s+creating: this\.botCreating,/u, "+ and its menu create the same way");
  assert.doesNotMatch(app, /\bNEW_BOT_NAME\b|createBotOn/u, "one way to create a bot, without a name");
  const source = read("./bots.ts");
  const button = between(source, "export function renderNewBotButton(", "/** The menu item for this machine");
  assert.equal(button.match(/data-new-bot-trigger \?disabled=\$\{busy\} aria-busy=\$\{busy \? "true" : "false"\}/gu)?.length, 2, "+ waits for the bot it is creating, plain or as the menu's trigger");
  assert.match(read("./shell.ts"), /onCreate: botsTab\.onCreate, creating: botsTab\.creating,/u);
  assert.match(source, /props\.creating \? "Creating…" : "New bot"/u, "and so does the empty roster's New bot");
  for (const file of [source, app]) assert.doesNotMatch(file, /renderBotDialog\b|bot-dialog|botDialog|botDraft/u, "the New bot and Edit dialogs are gone");
  assert.match(read("../lib/bots.ts"), /export type NewBotInput = Omit<BotInput, "name"> & \{ name\?: string \};/u, "the create body may leave the name out");
});

test("a bot chat offers a call whenever GPT-Live can run, and nothing of VoiceStudio", () => {
  const app = read("../hui-app.ts");
  assert.match(between(app, "private callsAvailable(", "private isUpdateSession("), /return callsReady\(this\.callsStatus\);/u);
  assert.match(app, /if \(!this\.embeddedPane && this\.view === "bot" && !this\.callsStatus\) void this\.loadCallsStatus\(\);/u, "read on every bot page, whatever settings.json holds");
  assert.doesNotMatch(app, /VoiceStudio|voiceNotes|readAloud|paneVoice|VOICE_CONNECTION_EVENT|calls\.engine/u);
  const home = read("./home.ts");
  assert.match(home, /renderCallButton\(\{ botName: props\.bot\.bot\.name, inCall: props\.call\.inCall, onCall: props\.call\.onCall \}\)/u, "the phone button");
  assert.doesNotMatch(home, /renderVoiceNoteButton|renderVoiceNoteStatus|renderReadAloud|chat-read-aloud|chat-voice-btn/u, "no microphone in the composer, no Read aloud under replies");
});

test("the Settings tab: Profile, Model, Calls and Workspace, each change saved on its own", () => {
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
  assert.doesNotMatch(between(source, "function renderCalls(", "/** The text controls"), /return nothing/u, "Calls always show: calls run on GPT-Live");
  assert.match(calls, /sectionHead\(props, "calls", "Calls", props\.call\.ready === false \? "Needs a ChatGPT login" : undefined\)/u,
    "without a ChatGPT login the head says what calls need, and nothing while the gateway has not said");
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
  assert.match(between(app, "private botSettingsCall(", "private botSettingsSavesOf("),
    /return \{ defaultVoice: this\.settings\.calls\.voice, \.\.\.\(this\.callsStatus \? \{ ready: callsReady\(this\.callsStatus\) \} : \{\}\) \};/u,
    "Settings' voice, and whether calls can run once the gateway has said (callsReady, as Call uses)");
  assert.match(app, /\n\s+call: settingsCall,\n/u, "the tab always gets its Calls section");
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
  // An icon's size is no container's height.
  assert.doesNotMatch(tab.replace(/[^{}]*\bsvg \{[^}]*\}/gu, ""), /(^|[\s;{])(max-)?height: \d/mu, "no fixed or maximum height");
  assert.match(tab, /\.bot-settings \.settings-row\.bot-setting \{[^}]*min-height: 0;/u, "compact rows");
  assert.match(tab, /\.bot-settings \.bot-setting--stacked \.settings-row__control \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/u, "a stacked control takes the row's width");
  assert.doesNotMatch(css, /\.bot-dialog/u, "no dialog styles are left");
});

test("while a worker exists the roster's + is a menu, New bot on Local or on each worker, and a choice creates the bot there at once", () => {
  const source = read("./bots.ts");
  const button = between(source, "export function renderNewBotButton(", "/** The menu item for this machine");
  assert.match(button, /if \(!props\.workers\.length\) \{\n\s+return html`<button type="button" aria-label="New bot" title="New bot" data-new-bot-trigger [^\n]*@click=\$\{\(event: Event\) => \{\n\s+props\.onNew\(\);/u, "without workers, + is the plain New bot");
  assert.match(button, /<wa-dropdown class="session-menu new-bot-menu" placement="bottom-end"/u);
  assert.match(button, /<button slot="trigger" type="button" aria-label="New bot" title="New bot" data-new-bot-trigger /u, "the same + opens the menu");
  assert.match(button, /props\.onCreate\(value === NEW_BOT_LOCAL \? undefined : value\);/u, "a choice creates the bot there");
  assert.match(button, /New bot on Local<\/span><\/wa-dropdown-item>/u);
  assert.match(button, /New bot on \$\{worker\.name\}\$\{worker\.state === "connected"/u, "each worker, with its state while not connected");
  assert.match(button, /props\.onOpen\?\.\(\);/u, "opening it reads the workers again");
  const css = readFileSync(new URL("../styles/bots.css", import.meta.url), "utf8");
  assert.match(css, /\.sidebar-recent-sessions__toolbar \.new-bot-menu \{[^}]*text-transform: none;/u, "its items are not the toolbar's small caps");
  const shell = read("./shell.ts");
  assert.match(shell, /\$\{botsTab \? renderNewBotButton\(\{\n\s+workers: botsTab\.workers, onNew: botsTab\.onNew, onCreate: botsTab\.onCreate,/u);
  const app = read("../hui-app.ts");
  assert.match(app, /workers: this\.launchWorkers,\n\s+onCreate: \(worker\) => this\.createNewBot\(worker\),/u);
  const create = between(app, "private createNewBot = ", "/** The roster's Edit");
  assert.match(create, /createBot\(worker \? \{ worker \} : \{\}\)/u, "created at once, where it was chosen, without a name: its first conversation asks for one");
  assert.match(create, /this\.navigate\(\{ kind: "bot", id: bot\.id \}\);/u, "and its chat opens");
  assert.match(create, /this\.botNoticeFailed = true;/u, "a refusal (an offline worker) shows in the roster");
});

test("Settings → Workspace shows the machine a bot runs on, read-only, and offers only that machine's folders", () => {
  const source = read("./bot-settings.ts");
  assert.match(between(source, "export function renderBotMachine(", "/**\n * Runs on:"),
    /data-bot-machine>\$\{worker \? icons\.globe : icons\.terminal\}<span>\$\{worker\?\.name \?\? "Local"\}<\/span>/u, "a helper any view can show read-only");
  const field = between(source, "export function renderBotMachineField(", "/** What the directory row says");
  assert.match(field, /if \(!worker && !props\.workersExist\) return undefined;/u, "for a bot on a worker, and for one here while a worker exists");
  assert.match(field, /return html`Runs on \$\{renderBotMachine\(worker\)\}`;/u, "read-only: nothing to change it with");
  assert.match(field, /bot\.worker\n\s+\? html`<p class="bot-panel__hint bot-settings__machine-hint">A bot stays on the machine it was created on: its chat and memory live there\. Terminals, the browser and watchers stay on this machine, so it can't use them\.<\/p>`/u, "a remote bot's limits");
  assert.match(between(source, "function directoryHint(", "function renderWorkspace("), /A folder on \$\{bot\.worker\.name\}\. Can change only while it is idle\./u);
  const workspace = between(source, "function renderWorkspace(", "export function renderBotSettings(");
  assert.match(workspace, /\$\{sectionHead\(props, "workspace", "Workspace", renderBotMachineField\(props\)\)\}/u, "Runs on beside the heading, as Model's note: no height, so the tab still fits 1440×900 with a worker around");
  assert.match(workspace, /<\/div>\n\s+\$\{renderMachineHint\(props\.bot\)\}\n\s+<\/section>/u, "a bot on a worker says why under the section");
  assert.doesNotMatch(source, /renderPicker\(\{ label: "Runs on"/u, "a bot's machine is chosen with +, never changed");
  const app = read("../hui-app.ts");
  assert.match(app, /suggestions: this\.directorySuggestionsFrom === \(bot\.worker\?\.id \?\? ""\) \? this\.directorySuggestions : \[\],\n\s+onInput: \(value\) => this\.loadDirectorySuggestions\(value, bot\.worker\?\.id\),/u,
    "a bot on a worker is offered its worker's folders, never this machine's");
  assert.match(between(app, "private loadDirectorySuggestions(", "private requestDirectorySuggestions"), /this\.directorySuggestionsFrom = worker \?\? "";\n\s+this\.directorySuggestions = directories;/u, "each answer says which machine it came from");
  assert.match(app, /workersExist: this\.launchWorkers\.length > 0,/u);
});

test("a bot on a worker shows the machine compactly in its roster row, its chat header and its confirmations", () => {
  const source = read("./bots.ts");
  assert.match(between(source, "function botRow(", "function archivedRow("),
    /\$\{bot\.worker \? html`<span class="bot-row__tag bot-row__machine" title=\$\{`Runs on \$\{bot\.worker\.name\}`\}>\$\{icons\.globe\}<span>\$\{bot\.worker\.name\}<\/span><\/span>` : nothing\}/u);
  assert.match(read("../lib/bot-roster.ts"), /\.\.\.\(bot\.worker \? \[`on \$\{bot\.worker\.name\}`\] : \[\]\)/u, "the row's accessible name says where it runs");
  const identity = between(read("./home.ts"), "function renderBotIdentity(", "function renderHeader(");
  assert.match(identity, /<span class="bot-chat-identity__machine" title=\$\{`Runs on \$\{worker\.name\}`\}><span class="sr-only">on <\/span>\$\{icons\.globe\}<span>\$\{worker\.name\}<\/span><\/span> · /u);
  assert.match(identity, /title=\$\{worker \? `\$\{worker\.name\}:\$\{session\.cwd\}` : session\.cwd\}/u, "its folder reads devbox:/path");
  const css = readFileSync(new URL("../styles/bots.css", import.meta.url), "utf8");
  assert.match(css, /\.app-shell \.bot-row__machine \{[^}]*max-width: 45%;/u, "a long name never crowds the preview out");
  assert.match(css, /\.bot-chat-identity__machine svg \{ flex: none; width: 11px; height: 11px; \}/u);
  assert.match(between(source, "export function renderBotArchiveDialog(", "/* ── delete confirmation"), /stay on \$\{bot\.worker\?\.name \?\? "this machine"\}/u);
  assert.match(between(source, "function renderMemoryTab(", "export function renderBotPanel("), /Summarizer since HUI started on \$\{props\.bot\.worker\.name\}/u, "a worker's compactor counts since its host opened the memory");
  const deleting = source.slice(source.indexOf("export function renderBotDeleteDialog("));
  assert.match(deleting, /its memory and its folder\$\{bot\.worker \? ` on \$\{bot\.worker\.name\}` : ""\} \(SOUL\.md and every file in it\) go/u, "its folder on the worker");
  assert.match(deleting, /bot\.status === "disconnected" \? `; HUI is not connected to \$\{bot\.worker\.name\} now, so those go there when it reconnects` : ""/u, "and when they go while the worker is offline");
});
