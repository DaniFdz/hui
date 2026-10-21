/**
 * What the iOS app's JavaScriptCore core exports: pure functions the web already uses, which `scripts/ios-build.ts`
 * bundles into `hui-core.js` for the app to run in a JSContext. None of it may need a DOM, network or timers; Swift
 * owns I/O, ids and the clock (boundary rule R18 and `entry.test.ts` check it).
 */
export { navigationPath, resolveNavigation } from "../../src/lib/navigation.ts";
export { decodeSseFrame, reconnectDelay } from "../../src/lib/event-stream.ts";
