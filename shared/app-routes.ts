/**
 * Browser paths that load HUI's app instead of a file. The production gateway
 * (server/static-files.ts) answers them with `index.html`, and every route the
 * browser router can show (src/lib/navigation.ts) must be one of them, or
 * reloading that page finds nothing (navigation.test.ts checks each kind).
 */

/** First segments of the app's two-segment deep links: `/sessions/<id>`,
 * `/settings/<page>` and a bot's chat, `/bots/<id>`. */
const DEEP_LINK_SECTIONS = ["sessions", "settings", "bots"] as const;

const PAGE = /^\/[a-z][a-z0-9-]*$/u;
const DEEP_LINK = new RegExp(`^/(?:${DEEP_LINK_SECTIONS.join("|")})/[^.]*$`, "u");

/** Whether a decoded pathname is an app route: Home, a top-level page (`/skills`,
 * `/kanban`) or a deep link. A deep link with a dot in it is a file request. */
export function isAppRoutePath(path: string): boolean {
  return path === "/" || PAGE.test(path) || DEEP_LINK.test(path);
}
