/** The `?open=app` hand-off: a chat link minted outside HUI asks macOS to bring the desktop app forward instead of
 * staying in the browser. Phones and the desktop window itself never hand off. */
import { resolveNavigation } from "./navigation.ts";

/** The `hui://` address that opens this page in the desktop app, or nothing when this device stays on the page.
 * The marker is a query parameter rather than the referrer, which browsers and Slack drop. */
export function appHandoffUrl(location: { pathname: string; search: string; userAgent: string }): string | undefined {
  const target = resolveNavigation(location.pathname).target;
  if (target.kind !== "session" && target.kind !== "bot") return;
  if (new URLSearchParams(location.search).get("open") !== "app") return;
  // Only macOS has a handler for it, and the desktop window shows this page already: handing off there would loop.
  const agent = location.userAgent;
  if (!agent.includes("Macintosh") || agent.includes("Mobile") || agent.includes("Electron")) return;
  return `hui://${target.kind === "session" ? "sessions" : "bots"}/${encodeURIComponent(target.id)}`;
}
