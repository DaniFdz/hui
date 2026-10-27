/**
 * What the iOS app's JavaScriptCore core exports: pure functions the web already uses, which `scripts/ios-build.ts`
 * bundles into `hui-core.js` for the app to run in a JSContext. None of it may need a DOM, network or timers; Swift
 * owns I/O, ids and the clock (boundary rule R18 and `entry.test.ts` check it).
 */
export { navigationPath, resolveNavigation } from "../../src/lib/navigation.ts";
export { decodeSseFrame, reconnectDelay } from "../../src/lib/event-stream.ts";
export { sessionAccessibleName, sessionGlyph, sessionStatusLabel, sessionStatusText } from "../../src/lib/session/labels.ts";
export { normalizeCustomSessionIcon, SESSION_ICONS, sessionCopiedNotice, sessionGroupLabel, sessionMoveGroupOptions, transcriptAsMarkdown } from "../../src/lib/session/sessions.ts";
export { normalizeSidebarSessionOptions, sessionTreeRows, sidebarSessionGroups } from "../../src/lib/session/sidebar-sessions.ts";
export { appendPendingUser, dropDuplicateSend, failPendingUser, normalizeTranscript, reduceTranscript, settlePendingUser } from "../../src/lib/transcript-state.ts";
export { workingLabel } from "../../src/lib/chat-projection.ts";
export { chatRows } from "../../src/lib/chat-rows.ts";
export { SendRequests } from "../../src/lib/composer/send-requests.ts";
export { composerPlaceholder, queueRows } from "../../src/lib/composer/state.ts";
export { composerCommands, composerSendAction, slashMenu } from "../../src/lib/composer/slash-commands.ts";
export { CONTINUE_AFTER_ERROR_PROMPT, latestRunError } from "../../src/lib/run-error.ts";
export { replyDraft } from "../../src/lib/message-metadata.ts";
export { markdownTokens } from "../../src/lib/markdown/parser.ts";
export { filterSettingsPages, SETTINGS_COPY } from "../../src/lib/settings/pages.ts";
export { WORK_PANE_LABEL, WORK_PANE_OPEN_VIEW, WORK_PANE_SHOW } from "../../src/lib/work-pane.ts";
export { FILES_COPY, filesBytes, filesCreateIn, filesCreatedLabel, filesDeleteLabel, filesDeleteRisks, filesDeleteTitle, filesEditorLabel, filesNoMatch, filesTabTitle } from "../../src/lib/files/copy.ts";
export { ACCENTS, TYPEFACES, typefaceFamily } from "../../src/lib/theme/appearance.ts";
export { NERD_FONT_SYMBOLS, TERMINAL_FONTS, normalizeTerminalFont, terminalFontFamilies, terminalFontStack } from "../../src/lib/terminal/font.ts";
export { browserStatusLabel, browserVersionLabel, normalizeBrowserStatus } from "../../src/lib/browser-status.ts";
export { themePalettes } from "../../src/lib/theme/shadcn-theme.ts";
export { effectiveColorScheme } from "../../src/lib/theme/theme.ts";
