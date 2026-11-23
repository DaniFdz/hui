/**
 * Links in chat that point back into the app: a Markdown link whose target is one of HUI's own routes
 * (`/sessions/<id>`, `/bots/<id>`, `/settings/models`, `/kanban`, `/`) navigates through the app's own route instead of
 * reloading the document. Every other link, and every click that asks the browser for something else (a modifier key,
 * another button, a new tab, a download, a selection the drag across the link just made), is left to the browser. Here
 * is the rule for one click, kept a pure read so it is testable without a DOM, the one delegated listener the shell
 * installs for the page and for an embedded pane (`hui-app.ts`), and the decision its callback hands back
 * (`inAppLinkHandled`). An app that cannot open a target — an embedded pane has only its own chat — answers `false` and
 * the click stays the browser's. Which links the Markdown parser keeps as anchors is `markdown/parser.ts`'s call.
 */
import { resolveNavigation, type NavigationTarget } from "./navigation.ts";

/** What a click hands the rule: a browser's `MouseEvent` satisfies it, and so does a test's plain object. */
export type LinkClick = Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented" | "target">;

/** One slash and not two: `//example.com` is another site and stays the browser's. */
const ROOTED_PATH_RE = /^\/(?!\/)/u;
const QUERY_OR_FRAGMENT_RE = /[?#]/u;

/**
 * The target a path into this app names, or `undefined` when it is not one of HUI's routes. Only a rooted path
 * qualifies, and a `?query` or `#hash` is ignored. A route with an older canonical form is in-app too (`/worktrees` is
 * Settings → Worktrees): callers navigate to the returned target, never to the href.
 */
export function inAppLinkTarget(pathname: string): NavigationTarget | undefined {
  if (!ROOTED_PATH_RE.test(pathname)) return undefined;
  const path = pathname.split(QUERY_OR_FRAGMENT_RE)[0] ?? "";
  const { target } = resolveNavigation(path);
  // Home is a real route at "/"; every other path that resolves there is unknown, so it reloads as before.
  return target.kind === "home" && path !== "/" ? undefined : target;
}

/**
 * The in-app link a click means, or `undefined` when the browser keeps the click: a plain left click, not already
 * prevented by something else in the app, on a link (or anything inside one) with a rooted HUI route as its `href`.
 * The caller scopes `event.target` to its own subtree.
 */
export function linkClickTarget(event: LinkClick): { anchor: HTMLAnchorElement; target: NavigationTarget } | undefined {
  if (event.defaultPrevented || event.button !== 0) return undefined;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return undefined;
  const origin: unknown = event.target;
  if (!origin || typeof (origin as { closest?: unknown }).closest !== "function") return undefined;
  const anchor = (origin as Element).closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.hasAttribute("download")) return undefined;
  // An empty target and `_self` both name this same browsing context, so the click stays in place.
  const frame = anchor.getAttribute("target");
  if (frame !== null && frame !== "" && frame !== "_self") return undefined;
  const href = anchor.getAttribute("href");
  const target = href === null ? undefined : inAppLinkTarget(href);
  return target ? { anchor, target } : undefined;
}

/**
 * Whether this app opens `target` itself: the shell handles every one of its own routes, and an embedded pane only the
 * chat it can open, which it needs a pane navigator for. A target nobody handles keeps the browser's own navigation, so
 * the page the link names loads as it would have.
 */
export function inAppLinkHandled(target: NavigationTarget, options: { embedded: boolean; paneNavigates: boolean }): boolean {
  if (!options.embedded) return true;
  return options.paneNavigates && target.kind === "session";
}

/** Whether a selection the reader made reaches into `anchor`. A drag that selects text and releases over the link was
 * selecting, not clicking: the click and the selection stay the browser's. */
function selectionReaches(anchor: Element): boolean {
  const selection = globalThis.getSelection?.();
  if (!selection || selection.isCollapsed) return false;
  const nodes: readonly (Node | null)[] = [selection.anchorNode, selection.focusNode];
  return nodes.some((node) => node !== null && anchor.contains(node));
}

/**
 * Handles clicks on HUI's own routes under `root` through `navigate`, and returns the function that stops doing so. The
 * callback answers `false` for a target this app does not handle — an embedded pane has only its own chat — and the
 * browser then loads the page as it would have. The rule does not check containment, so the caller passes the subtree
 * that holds the links.
 */
export function installInAppLinkNavigation(root: EventTarget, navigate: (target: NavigationTarget) => boolean | void): () => void {
  const onClick = (event: Event): void => {
    // A browser's click is a MouseEvent: the rule reads only the fields `LinkClick` names.
    const hit = linkClickTarget(event as Event & LinkClick);
    if (!hit) return;
    // A click that ends a drag across the link was selecting its text: neither the link nor the selection is touched.
    if (selectionReaches(hit.anchor)) return;
    // Asked first, so a refused target reaches the browser untouched; preventing afterwards still cancels this click's
    // own navigation once the app has moved with `pushState`.
    if (navigate(hit.target) === false) return;
    event.preventDefault();
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
