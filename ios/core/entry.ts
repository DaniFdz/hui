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
export { CONTINUE_AFTER_ERROR_PROMPT, latestRunError } from "../../src/lib/run-error.ts";
export { markdownTokens } from "../../src/lib/markdown/parser.ts";
export { filterSettingsPages } from "../../src/lib/settings/pages.ts";
