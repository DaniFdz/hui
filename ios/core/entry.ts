/**
 * What the iOS app's JavaScriptCore core exports: pure functions the web already uses, which `scripts/ios-build.ts`
 * bundles into `hui-core.js` for the app to run in a JSContext. None of it may need a DOM, network or timers; Swift
 * owns I/O, ids and the clock (boundary rule R18 and `entry.test.ts` check it).
 */
export { navigationPath, resolveNavigation } from "../../src/lib/navigation.ts";
export { decodeSseFrame, reconnectDelay } from "../../src/lib/event-stream.ts";
export { sessionAccessibleName, sessionStatusLabel, sessionStatusText } from "../../src/lib/session/labels.ts";
export { sessionGroupLabel } from "../../src/lib/session/sessions.ts";
export { DEFAULT_SIDEBAR_SESSION_OPTIONS, sessionTreeRows, sidebarSessionGroups } from "../../src/lib/session/sidebar-sessions.ts";
export { appendPendingUser, normalizeTranscript, reduceTranscript, settlePendingUser } from "../../src/lib/transcript-state.ts";
export { workingLabel } from "../../src/lib/chat-projection.ts";
export { chatRows } from "../../src/lib/chat-rows.ts";
export { SendRequests } from "../../src/lib/composer/send-requests.ts";
export { markdownTokens } from "../../src/lib/markdown/parser.ts";
