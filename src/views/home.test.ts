import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("effort preview owns a textContent property without destroying Lit child markers", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  assert.match(source, /class="chat-controls__effort-value"[^>]*\.textContent=\$\{THINKING_LABELS\[level\]\}/);
  assert.doesNotMatch(source, /class="chat-controls__effort-value"[^>]*>\$\{/);
});

function readStyles(path: string): string {
  const url = new URL(path, import.meta.url);
  const source = readFileSync(url, "utf8");
  return source.replace(/@import "([^"]+)";/g, (_, child: string) => readStyles(new URL(child, url).href));
}

test("auto-follow and scroll-to-latest target the real reference transcript scroller", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");
  assert.match(app, /querySelector\?\.\("\.chat-thread"\)/);
  assert.doesNotMatch(app, /querySelector\?\.\("\.transcript__scroll"\)/);
  assert.match(source, /class="chat-scroll-to-bottom"[^>]*\?inert=\$\{!props\.showScrollToBottom\}/);
  assert.match(source, /aria-label="Scroll to latest">\$\{icons\.arrowDown\}/);
});

test("PI choices use the original question option buttons and focus visible controls", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");
  assert.match(source, /class="chat-question-panel__option" role="radio" aria-checked="false"/);
  assert.match(source, /class="chat-question-panel__option-marker"/);
  assert.match(source, /option\.setAttribute\("aria-checked", String\(selected\)\)/);
  assert.ok(app.includes('.session-question-card input:not([type="hidden"])'));
  assert.doesNotMatch(source, /input type="radio" name="answer"/);
});

test("the dynamic queue is announced as a polite live status", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");

  assert.match(source, /class="chat-queue"\s+role="status"/);
  assert.match(source, /role="status"\s+aria-live="polite"\s+aria-atomic="false"/);
  assert.match(source, /aria-label="Queued messages"/);
});

test("the composer routes Enter shortcuts through explicit steer and queue modes", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  assert.match(source, /composerEnterMode\(\{/u);
  assert.match(source, /submitPromptFromForm\(props, form, mode\)/u);
  assert.match(source, /@keydown=\$\{onPromptKeydown\(props\)\}/u);
  assert.match(source, /coarsePointer: hasCoarsePointer\(\)/u);
  assert.match(source, /touch and hold to enqueue/u);
  assert.match(source, />Enqueue</u);
  assert.match(source, /props\.streaming \? "steer" : "prompt"/u);
  assert.doesNotMatch(source, /Queue mode|Steer next|onFollowUpMode/u);
});

test("session history actions expose direct editable rewind and prompt-free continuation", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /aria-label="Rewind session"/u);
  assert.match(source, /class="chat-group-rewind" aria-label=\$\{props\.rewindPending \? "Rewinding…" : "Rewind to here"\}/u);
  assert.match(source, /renderActionTooltip\(rewindTooltipId, props\.rewindPending \? "Rewinding…" : "Rewind"/u);
  assert.match(source, /props\.onRewind\(rewindTo, last\?\.text \?\? ""\)/u);
  assert.doesNotMatch(source, /row\.role === "user" && !props\.streaming/u);
  assert.match(source, /aria-label="Continue without a prompt"/u);
  assert.doesNotMatch(source, /rewind-session-dialog|Rewind here|Rewind point/u);
  assert.doesNotMatch(app, /loadSessionCheckpoints/u);
  assert.doesNotMatch(app, /!session \|\| this\.streaming \|\| this\.opening \|\| this\.rewindPending/u);
  assert.match(app, /rewindSession\(session\.id, target, true\)/u);
  assert.match(app, /this\.draft = text/u);
  assert.match(app, /this\.composerTextarea\?\.focus\(\)/u);
  assert.match(app, /resumeSession\(session\.id\)/u);
});

test("runtime-owned queue rows cannot collide with the empty edit sentinel", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");

  assert.match(source, /const editing = row\.editable && row\.id === props\.queueEditingId/u);
});

test("the composer attachment button exposes camera, photo and file pickers", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");

  assert.match(source, /aria-label="Add attachment"/);
  assert.match(source, /accept="image\/\*" capture="environment"/);
  assert.match(source, />Take photo</);
  assert.match(source, />Photo</);
  assert.match(source, />File</);
  assert.match(source, /openAttachmentInput\(event, "\.agent-chat__camera-input"\)/);
  assert.match(source, /input\.closest\("details"\)\?\.removeAttribute\("open"\)/);
});

test("sent file cards retain original compact geometry and the empty action slot", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  assert.match(source, /chat-assistant-attachment-card chat-assistant-attachment-card--compact/);
  assert.match(source, /<span class="chat-assistant-attachment-card__actions"><\/span>/);
  assert.match(source, /chat-assistant-attachment-card__title" title=\$\{attachmentName\(attachment\)\}/);
});

test("sent attachments do not render stray template syntax", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const attachmentList = source.match(/<div class="chat-assistant-attachments" role="list" aria-label="Attachments">([\s\S]*?)<\/div>`/u)?.[1] ?? "";

  assert.match(attachmentList, /item\.attachments\.map\(\(attachment\) => renderMessageAttachment\(attachment\)\)/u);
  assert.doesNotMatch(attachmentList, /\n\s*\)\}\s*$/u);
});

test("the composer ports OpenClaw input interactions without unsupported controls", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const styles = readStyles("../styles/openclaw-chat.css");

  assert.match(source, /import \{ adjustTextareaHeight as syncComposerTextarea \} from "\.\.\/lib\/composer-textarea\.ts"/);
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");
  assert.match(app, /observeTextareaOverflow\(textarea\)/);
  assert.match(app, /disconnectTextareaOverflowObserver\(this\.composerTextarea\)/);
  assert.match(app, /changed\.has\("draft"\)/);
  assert.doesNotMatch(source, /@scroll=\$\{[^\n]*syncComposerTextarea/);
  assert.match(source, /@paste=\$\{onComposerPaste\(props\)\}/);
  assert.match(source, /PASTED_TEXT_ATTACHMENT_THRESHOLD/);
  assert.match(source, /data-attachment-drop-active/);
  assert.match(source, /@click=\$\{focusComposerFromSurface\}/);
  assert.match(source, /id="launch-prompt" class="new-session-page__message" name="prompt" rows="1" dir="auto"/);
  assert.match(source, /aria-keyshortcuts="Enter Control\+Enter Meta\+Enter"/);
  assert.match(styles, /textarea\[data-scroll-fade-top\]/);
  assert.match(styles, /\.chat\[data-attachment-drop-active\]/);
  assert.doesNotMatch(source, /Full Access/);
  assert.doesNotMatch(source, /aria-label="Dictate"/);
});

test("chat and New Session expose cursor-aware local path completion", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");
  assert.match(source, /renderLocalPathMenu\(\{ \.\.\.props\.localPathMenu/u);
  assert.match(source, /localPathQuery\(textarea\.value, textarea\.selectionStart, textarea\.selectionEnd\)/u);
  assert.match(source, /props\.onLocalPathKeydown\(event\)/u);
  assert.match(app, /loadLocalPathSuggestions\(workspace, query\.input\)/u);
  assert.match(app, /completeLocalPath\(this\.draft, query, suggestion\)/u);
});

test("the primary chat uses the OpenClaw transcript and composer hierarchy", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const styles = readStyles("../styles/openclaw-chat.css");

  assert.match(source, /class="chat-thread chat-thread--direct"/);
  assert.match(source, /props\.mobileNavLayout \? html`<button/);
  assert.match(source, /class="chat-tool-card__header"/);
  assert.match(source, /class="chat-tool-card__block-content"/);
  assert.doesNotMatch(styles, /\.chat-tool-msg-body pre\s*\{/);
  assert.match(source, /class="chat-group \$\{row\.role\} chat-group--with-footer \$\{row\.id === latestAssistantRowId/);
  assert.match(source, /<div class="agent-chat__composer-shell \$\{props\.question \? "agent-chat__composer-shell--question-composer" : ""\}"/);
  assert.match(source, /<form class="agent-chat__input agent-chat__input--chat/);
  assert.match(source, /agent-chat__input--chat agent-chat__input--mobile-toolbar/);
  assert.match(source, /chat-send-control chat-mobile-primary-action chat-desktop-primary-action/);
  assert.match(source, /const showStop = props\.streaming && !props\.draft\.trim\(\) && !props\.attachments\.some/);
  assert.match(source, /showStop \? html`<button[^>]*chat-send-btn--stop/);
  assert.match(source, /chat-controls__inline-select-trigger chat-controls__effort-trigger/);
  assert.match(source, /class="chat-controls__effort-gauge-needle" d="M12 12V6"/);
  assert.match(source, /class="agent-chat__composer-footer"/);
  assert.match(source, /class="chat-controls__inline-select chat-controls__model-picker"/);
  assert.match(styles, /\.agent-chat__composer-combobox > :is\(textarea, input\):focus-visible\s*\{\s*box-shadow: none;/);
  assert.match(styles, /--chat-turn-gap: 28px;/);
  assert.match(styles, /\.chat-group\.user \.chat-bubble\s*\{[^}]*--chat-bubble-background: var\(--accent-subtle\);/s);
  assert.match(styles, /--chat-composer-surface: var\(--popover\);/);
  assert.match(styles, /--chat-composer-hairline: color-mix\(in srgb, var\(--text-strong\) 16%, transparent\);/);
  assert.match(styles, /\.agent-chat__input:has\(\.agent-chat__composer-combobox > :is\(textarea, input\):focus\)/);
  assert.match(styles, /\.chat-text\s*\{[^}]*font-family: var\(--font-chat\);[^}]*color: var\(--chat-text\);/s);
  assert.doesNotMatch(styles, /--focus-ring-color/);
  assert.match(styles, /\.chat-text\s*\{[^}]*font-size: var\(--chat-text-size\);[^}]*line-height: 1\.5;/s);
});

test("user messages preserve explicit line breaks", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const styles = readStyles("../styles/openclaw-chat.css");

  assert.match(source, /item\.role === "user" \? renderUserText\(props, item\)/);
  assert.match(source, /class="chat-text chat-text--plain"/);
  assert.match(styles, /\.chat-text--plain\s*\{\s*white-space:\s*pre-wrap;\s*\}/);
});

test("long user prompts collapse and user rows offer Copy prompt", async () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const { isLongPrompt } = await import("./home.ts");
  assert.equal(isLongPrompt("short"), false);
  assert.equal(isLongPrompt("x".repeat(701)), true);
  assert.equal(isLongPrompt(Array(12).fill("a").join("\n")), true);
  assert.match(source, /"Copy prompt"/);
  assert.match(source, /Show more/);
});

test("the latest assistant copy action stays reachable on touch layouts", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const styles = readStyles("../styles/openclaw-chat.css");
  assert.match(source, /latestAssistantRowId = rows\.findLast/);
  assert.match(source, /row\.id === latestAssistantRowId \? "chat-group--latest-assistant"/);
  assert.match(styles, /@media \(hover: none\)[\s\S]*:where\(\.chat-thread\) \.chat-group--latest-assistant\s*\{[\s\S]*--chat-footer-disclosure-pointer-events: auto;/u);
});

test("chat and New Session share the OpenClaw composer surface", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const chatStyles = readStyles("../styles/openclaw-chat.css");
  const workspaceStyles = readStyles("../styles/openclaw-workspaces.css") + readStyles("../styles/openclaw-launch.css");

  assert.match(chatStyles, /--chat-composer-surface:\s*var\(--popover\)/);
  assert.match(chatStyles, /\.agent-chat__input\s*\{[^}]*border-radius:\s*calc\(20px \* var\(--openclaw-corner-radius-scale\)\)/s);
  assert.match(source, /class="agent-chat__composer-shell new-session-page__composer"/);
  assert.match(source, /class="agent-chat__input agent-chat__input--mobile-toolbar"/);
  assert.match(workspaceStyles, /\.new-session-page__composer\.agent-chat__composer-shell\s*\{[^}]*margin-top: 0;/s);
  assert.doesNotMatch(workspaceStyles, /\.new-session-page \.launch__submit/);
  assert.doesNotMatch(chatStyles, /--chat-composer-(?:surface|hairline):[^;]*var\(--primary\)/);
});

test("the composer send control uses OpenClaw's SVG geometry and state colors", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const styles = readStyles("../styles/openclaw-chat.css");

  assert.match(source, /const arrowUpIcon = icons\.arrowUp/);
  assert.match(source, /chat-send-btn chat-send-btn--send launch__submit/);
  assert.doesNotMatch(source, /\? "…" : "↑"/);
  assert.match(styles, /--chat-composer-send-size:\s*32px/);
  assert.match(styles, /\.agent-chat__input \.chat-send-btn--send > svg\s*\{[^}]*width:\s*21px;[^}]*height:\s*21px;/s);
  assert.match(styles, /\.agent-chat__input \.chat-send-btn:disabled\s*\{[^}]*background:\s*var\(--chat-composer-hover\);[^}]*color:\s*var\(--chat-composer-tertiary\);[^}]*opacity:\s*1;/s);
  assert.match(styles, /\.agent-chat__input \.chat-send-btn\s*\{[^}]*height:\s*var\(--chat-composer-send-size\);[^}]*color:\s*var\(--primary-foreground\);[^}]*box-shadow:\s*none;/s);
});

test("Task progress projects the durable progress_card signal above the composer", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const styles = readStyles("../styles/openclaw-chat.css");

  assert.match(source, /progressCardFromTranscript\(props\.transcript\)/);
  assert.match(source, /class="session-progress-card session-progress-card--composer"/);
  assert.match(source, /item\.name !== "progress_card"/);
  assert.match(styles, /\.agent-chat__progress-float\s*\{[^}]*--chat-progress-underlap:\s*18px;/s);
  assert.ok(source.indexOf("${renderTaskProgress(props)}") > source.indexOf('<div class="agent-chat__composer-shell'));
  assert.match(source, /class="agent-chat__question-dock"/);
  assert.match(source, /agent-chat__composer-shell--question-composer/);
});

test("model and thinking reuse one exclusive composer picker pattern", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const styles = readStyles("../styles/openclaw-chat.css");

  assert.match(source, /function prepareComposerPicker/);
  assert.match(source, /querySelectorAll<HTMLDetailsElement>\("details\[open\]"\)/);
  assert.match(source, /@click=\$\{prepareComposerPicker\}/);
  assert.match(source, /@keydown=\$\{closeComposerPicker\}/);
  assert.match(source, /class="chat-controls__reasoning-range"/);
  assert.match(source, /class="chat-controls__reasoning-dots"/);
  assert.match(source, /@input=\$\{/);
  assert.match(source, /xhigh: "Maximum"/);
  assert.match(source, /options\.onSelect\(next\)/);
  assert.match(styles, /\.chat-controls__effort-menu\s*\{[^}]*width: min\(330px,/s);
  assert.match(styles, /\.chat-controls__reasoning-range::-webkit-slider-thumb\s*\{[^}]*width: 28px;[^}]*height: 20px;/s);
  assert.doesNotMatch(source, /Fast mode/);
  assert.doesNotMatch(styles, /\.chat-controls__effort-picker\s*\{\s*display:\s*none;\s*\}/);
  assert.match(styles, /--chat-composer-chip-height:/);
  assert.match(source, /@toggle=\$\{positionComposerPicker\}/);
});

test("the model control remains visible while PI has no model catalog", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const styles = readStyles("../styles/openclaw-chat.css");

  assert.match(source, /const label = current\?\.name \?\? "PI default"/);
  assert.match(source, /aria-disabled="true"/);
  assert.match(source, /No model catalog available/);
  assert.doesNotMatch(source, /Default \(Full Access\)/);
  assert.match(styles, /\.chat-controls__inline-select-trigger--disabled/);
});

test("the launch directory picker uses the themed combobox instead of a native datalist", () => {
  const source = readFileSync(new URL("./directory-picker.ts", import.meta.url), "utf8");
  for (const path of ["./home.ts", "../hui-app.ts"]) {
    const consumer = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(consumer, /renderDirectoryPicker\(/);
    assert.doesNotMatch(consumer, /<datalist id="(?:launch-directories|group-default-directories)"/);
  }
  const styles = readStyles("../styles/openclaw-workspaces.css") + readStyles("../styles/openclaw-launch.css");

  assert.match(source, /role="combobox"/);
  assert.match(source, /class="new-session-page__directory-menu" role="listbox"/);
  assert.match(source, /role="option"/);
  assert.doesNotMatch(source, /<datalist id="launch-directories"/);
  assert.match(styles, /\.new-session-page__directory-menu/);
});

test("the composer exposes PI context usage beside the model", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const styles = readStyles("../styles/openclaw-chat.css");

  assert.match(source, /renderContextPicker\(props\.usage, props\.streaming \? undefined : props\.onCompact\)/);
  assert.match(source, />Compact now<\/button>/);
  assert.match(source, /Context window/);
  assert.match(source, /Latest run tokens/);
  assert.match(styles, /\.context-ring__dial/);
  assert.match(source, /stroke-dashoffset/);
});

test("PI questions use the inline OpenClaw card instead of a modal", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const styles = readStyles("../styles/openclaw-chat.css");

  assert.match(source, /class="session-question-card chat-question-panel"/);
  assert.match(source, /Type your own answer here/);
  assert.match(source, />Skip</);
  assert.match(source, />Submit</);
  assert.doesNotMatch(source, /class="question-dialog"/);
  assert.match(styles, /\.chat-question-panel\s*\{[^}]*gap: 12px;[^}]*padding: 14px;/s);
  assert.match(styles, /\.chat-question-panel__option\s*\{[^}]*padding: 10px 11px;/s);
});

test("New Session uses the dedicated PI mascot", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");

  assert.match(source, /src="\/pi-logo-3d\.png"/);
  assert.doesNotMatch(source, /src="\/apple-touch-icon\.png"/);
});

test("New Session exposes real model and effort controls without a permission fiction", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");

  assert.match(source, /launchModels: readonly RuntimeModel\[\]/);
  assert.match(source, /onSelectLaunchModel/);
  assert.match(source, /onSelectLaunchThinking/);
  assert.match(source, /class="agent-chat__composer-controls new-session-page__launch-controls chat-controls__model-settings"/);
  assert.match(source, /model: modelValue\(props\.launchModel\)/);
  assert.match(source, /thinking: props\.launchThinking/);
  assert.doesNotMatch(source, /Default \(Full Access\)/);
  assert.doesNotMatch(source, /new-session-page__permission/);
  assert.doesNotMatch(source, /<select[^>]*new-session-page__runtime/);
});

test("run details stay collapsed until the user asks to inspect them", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const styles = readStyles("../styles/openclaw-chat.css");

  assert.match(source, /const expansionId = `\$\{props\.session\?\.id/);
  assert.match(source, /\.open=\$\{props\.expandedActivityIds\.has\(expansionId\)\}/);
  assert.match(source, /props\.onActivityExpanded\(expansionId, details\.open\)/);
  assert.doesNotMatch(source, /\?open=\$\{props\.streaming/);
  assert.match(styles, /\.chat-activity-group:not\(\[open\]\) \.chat-activity-group__body\s*\{\s*display: none;/);
});

test("thinking renders as plain intermediate text without a reasoning label", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");

  assert.match(source, /item\.kind === "thinking"[\s\S]*?class="chat-activity-message"/);
  assert.doesNotMatch(source, /_Reasoning:_/);
  assert.doesNotMatch(source, /class="chat-thinking"/);
  assert.doesNotMatch(source, /class="chat-thinking"/);
});

test("the primary runtime working state is contextual and child activity remains explicit", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");

  assert.match(source, /renderWorkingIndicator\(props\)/);
  assert.match(source, /class="chat-working-indicator__label"/);
  assert.match(source, /role="status"/);
  assert.doesNotMatch(source, /hui-run-elapsed/);
  assert.match(source, /class="chat-subagents__row/);
  assert.doesNotMatch(source, /subagentClawIcon/);
  assert.match(source, /props\.onSelectSubagent\(task\.sessionId\)/);
});

test("text inputs do not inherit the global focus halo", () => {
  const appStyles = readFileSync(new URL("../styles/app.css", import.meta.url), "utf8");
  const workspaceStyles = readStyles("../styles/openclaw-workspaces.css") + readStyles("../styles/openclaw-launch.css");

  assert.doesNotMatch(appStyles, /:where\(input, textarea, select\):focus-visible\s*\{[^}]*box-shadow:\s*var\(--focus-ring\)/s);
  assert.match(readStyles("../styles/openclaw-chat.css"), /\.agent-chat__composer-combobox > :is\(textarea, input\):focus-visible\s*\{\s*box-shadow: none;/);
  assert.match(readStyles("../styles/openclaw-reference/components.css"), /\.data-table-search input:focus-visible\s*\{\s*border-color: var\(--border-strong\);\s*box-shadow: var\(--focus-ring\);/);
  assert.doesNotMatch(workspaceStyles, /\.sessions-toolbar__search input:focus\s*\{/);
  assert.doesNotMatch(workspaceStyles, /\.settings-shell \.settings-sidebar__search-input:focus\s*\{[^}]*var\(--focus-ring\)/s);
});

test("recent chats on New Session reopen an existing session", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");

  assert.match(source, /class="agent-chat__recent new-session-page__recent-row"/);
  assert.match(source, /props\.onSelectSession\(session\)/);
  assert.match(readStyles("../styles/openclaw-chat.css"), /\.agent-chat__recent\s*\{[^}]*padding: 8px 12px;/s);
});

test("session actions live in the sidebar instead of the chat header", () => {
  const homeSource = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");

  assert.doesNotMatch(homeSource, /chat-pane__desktop-actions/);
  assert.doesNotMatch(homeSource, /chat-pane__mobile-actions/);
  assert.doesNotMatch(homeSource, /aria-label="Session actions"/);
  assert.match(shellSource, /<wa-dropdown-item value="rename"[\s\S]*?Rename/);
  assert.match(shellSource, /<wa-dropdown-item value="delete"[\s\S]*?Delete/);
  assert.match(shellSource, /aria-label="New session"/);
});

test("the chat header exposes original same-session split controls and pane-local close", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");

  assert.match(source, /aria-label="Open split view"/);
  assert.match(source, /aria-label="Split right"/);
  assert.match(source, /aria-label="Split down"/);
  assert.match(source, /aria-label="Pane actions"/);
  assert.doesNotMatch(source, /splitCandidates/);
  assert.doesNotMatch(source, /onSplitSession\?: \(session: SessionView\) => void/);
  assert.match(source, /aria-label="Close session pane"/);
  assert.match(source, /@click=\$\{props\.onClosePane\}/);
});

test("session rename mirrors the Control UI single title field without a group editor", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");
  const editor = source.slice(source.indexOf("function renderSessionEditor"), source.indexOf("function renderDeleteConfirmation"));
  assert.match(editor, /class="chat-pane__session-title-input"/);
  assert.match(editor, /event\.key === "Enter"/);
  assert.match(editor, /event\.key === "Escape"/);
  assert.match(editor, /@blur=/);
  assert.doesNotMatch(editor, /name="group"|<button|<form/);
  assert.match(source, /onRename: \(title: string\) => void;/);
  assert.match(app, /renameSession\(targetId, \{ title \}\)/);
});

test("composer notices render above the progress card and queue, which underlap their next sibling", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  const order = ["${renderRunError(", "agent-chat__interrupted-recovery\" role", "${renderTaskProgress(", "${renderQueue(", "<form class=\"agent-chat__input"]
    .map((marker) => source.indexOf(marker));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1]!)), String(order));
});
