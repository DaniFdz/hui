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

test("the dialog's Look is Face (shape, color, live preview) or Emoji, as native radio groups", () => {
  const source = read("./bots.ts");
  const look = between(source, "function renderLookField(", "/** Every language's English name");
  assert.match(look, /<fieldset class="field input-dialog__field bot-dialog__look" data-face-stage>/u, "the preview's eyes follow the pointer over the field");
  assert.match(look, /<legend class="bot-dialog__look-legend">Look<\/legend>/u);
  assert.match(look, /role="radiogroup" aria-label="Look"/u);
  assert.match(look, /\[\["face", "Face"\], \["emoji", "Emoji"\]\]/u);
  assert.match(look, /<input type="radio" name="look" value=\$\{value\} \.checked=\$\{look\.kind === value\}/u);
  assert.match(look, /role="radiogroup" aria-label="Shape"/u);
  assert.match(look, /<input type="radio" name="shape" value=\$\{shape\}/u);
  assert.match(look, /role="radiogroup" aria-label="Color"/u);
  assert.match(look, /<input type="radio" name="color" value=\$\{color\.hex\} aria-label=\$\{color\.label\}/u, "each swatch is named");
  assert.match(look, /Custom \$\{custom\}/u, "a color set through the API stays choosable");
  assert.match(look, /<hui-bot-face size="lg" shape=\$\{look\.shape\} \.color=\$\{look\.color\} \.seed=\$\{look\.seed\} state="idle">/u);
  assert.match(look, /name="emoji" type="text" maxlength="16"/u);
  assert.match(between(source, "export function renderBotDialog(", "/* ── archive confirmation"), /\$\{renderLookField\(props\.look, props\.pending\)\}/u);
  const app = read("../hui-app.ts");
  assert.match(app, /if \(this\.botDraftLook === "emoji" && !this\.botDraftEmoji\.trim\(\)\) \{\n\s+this\.botDialogError = "Type an emoji, or choose Face\.";/u);
  assert.match(app, /const look = botLook\(bot\);\n\s+this\.botDraftLook = look\.kind;/u, "an edit opens on the look the bot shows");
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

test("with GPT-Live calls, VoiceStudio's picker is the read-aloud voice and the call voice says why", () => {
  const source = read("./bots.ts");
  assert.match(source, /\$\{props\.voice \? renderVoiceField\(props\.voice, props\.pending, !props\.call\) : nothing\}/u, "calls use VoiceStudio's voice only while GPT-Live does not run them");
  const voice = between(source, "function renderVoiceField(", "const THINKING_LABELS");
  assert.match(voice, /const label = calls \? "Voice" : "Read-aloud voice";/u);
  assert.match(voice, /Calls use the Call voice below\./u);
  assert.match(voice, /renderPicker\(\{ label, value: voice\.profile/u, "the picker's accessible name follows the label");
  assert.match(between(source, "function renderCallVoiceField(", "function renderLanguageField("), /GPT-Live speaks with its own voices, so calls can't use a VoiceStudio voice\./u);
});

test("the dialog's Model and Thinking pickers line up although only Model has a hint", () => {
  const css = readFileSync(new URL("../styles/bots.css", import.meta.url), "utf8");
  assert.match(css, /\.bot-dialog__row \{[^}]*\balign-items: start;/u, "each field keeps its own height instead of stretching to the row");
  assert.match(read("./bots.ts"), /<div class="bot-dialog__row">\s*<div class="field input-dialog__field"><span>Model<\/span>/u);
});

test("while a worker exists the roster's + is a menu, New bot on Local or on each worker, and a choice creates the bot there at once", () => {
  const source = read("./bots.ts");
  const button = between(source, "export function renderNewBotButton(", "/** The menu item for this machine");
  assert.match(button, /if \(!props\.workers\.length\) \{\n\s+return html`<button type="button" aria-label="New bot" title="New bot" data-new-bot-trigger @click=\$\{\(event: Event\) => \{\n\s+props\.onNew\(\);/u, "without workers, + is the plain New bot");
  assert.match(button, /<wa-dropdown class="session-menu new-bot-menu" placement="bottom-end"/u);
  assert.match(button, /<button slot="trigger" type="button" aria-label="New bot" title="New bot" data-new-bot-trigger>/u, "the same + opens the menu");
  assert.match(button, /props\.onCreate\(value === NEW_BOT_LOCAL \? undefined : value\);/u, "a choice creates the bot there");
  assert.match(button, /New bot on Local<\/span><\/wa-dropdown-item>/u);
  assert.match(button, /New bot on \$\{worker\.name\}\$\{worker\.state === "connected"/u, "each worker, with its state while not connected");
  assert.match(button, /props\.onOpen\?\.\(\);/u, "opening it reads the workers again");
  const css = readFileSync(new URL("../styles/bots.css", import.meta.url), "utf8");
  assert.match(css, /\.sidebar-recent-sessions__toolbar \.new-bot-menu \{[^}]*text-transform: none;/u, "its items are not the toolbar's small caps");
  const shell = read("./shell.ts");
  assert.match(shell, /\$\{botsTab \? renderNewBotButton\(\{\n\s+workers: botsTab\.workers, onNew: botsTab\.onNew, onCreate: botsTab\.onCreate,/u);
  const app = read("../hui-app.ts");
  assert.match(app, /workers: this\.launchWorkers,\n\s+onCreate: this\.createBotOn,/u);
  const create = between(app, "private createBotOn = ", "/** The worker the bot being edited runs on");
  assert.match(create, /createBot\(\{ name: NEW_BOT_NAME, \.\.\.\(worker \? \{ worker \} : \{\}\) \}\)/u, "created at once, where it was chosen");
  assert.match(create, /this\.navigate\(\{ kind: "bot", id: bot\.id \}\);/u, "and its chat opens");
  assert.match(create, /this\.botNoticeFailed = true;/u, "a refusal (an offline worker) shows in the roster");
});

test("an existing bot shows the machine it runs on, read-only, beside its workspace, whose folders are that machine's", () => {
  const source = read("./bots.ts");
  assert.match(between(source, "export function renderBotMachine(", "/**\n * Runs on, for a bot that exists"),
    /data-bot-machine>\$\{worker \? icons\.globe : icons\.terminal\}<span>\$\{worker\?\.name \?\? "Local"\}<\/span>/u, "a helper any view can show read-only");
  const field = between(source, "export function renderBotMachineField(", "/** What the workspace field says");
  assert.match(field, /if \(!bot\.worker && !workersExist\) return nothing;/u);
  assert.match(field, /A bot stays on the machine it was created on: its chat and memory live there\./u);
  assert.match(field, /Terminals, the browser and watchers stay on this machine, so it can't use them\./u, "a remote bot's limits");
  assert.match(between(source, "function workspaceHint(", "/** One Language field"), /A folder on \$\{editing\.worker\.name\}\. Can change only while the bot is idle\./u);
  const dialog = between(source, "export function renderBotDialog(", "/* ── archive confirmation");
  assert.match(dialog, /\$\{editing \? renderBotMachineField\(editing, Boolean\(props\.workersExist\)\) : nothing\}\n\s+<div class="field input-dialog__field"><label for="bot-dialog-cwd">Workspace directory<\/label>/u);
  assert.doesNotMatch(dialog, /renderPicker\(\{ label: "Runs on"/u, "a new bot's machine is chosen with +, not in the dialog");
  const app = read("../hui-app.ts");
  assert.match(app, /onDirectoryInput: this\.botDialogWorker\(\) \? \(input\) => this\.loadDirectorySuggestions\(input, this\.botDialogWorker\(\)\) : this\.requestDirectorySuggestions/u,
    "a bot on a worker is offered its worker's folders, never this machine's");
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
  assert.match(source.slice(source.indexOf("export function renderBotDeleteDialog(")), /Its chat stays in the Durable store on \$\{bot\.worker\.name\}, which HUI no longer opens, and the files in its workspace stay there\./u);
});

