/**
 * What the web installs once when it runs inside the phone shell (WP3 of `docs/mobile-app-plan.md`): links to other
 * origins go to the shell's browser instead of a WebView that cannot navigate there, and a resumed shell runs the same
 * reconnect checks the web already runs when the network comes back.
 *
 * Both are no-ops in a browser (`nativeShell()` is `null`), so a page that is not in the app keeps the browser's own
 * link behaviour and its own reconnect listeners.
 */
import { nativeShell } from "./native-shell.ts";

/** The URL a click or `window.open` hands to the shell, or `undefined` when the page itself owns the target: its own
 * origin, a fragment, or anything that is not `http:`/`https:`. A `mailto:` or `tel:` link is the native layer's: the
 * shell opens the mail or dialer app with it, which a web page cannot do. */
export function externalLink(href: string, base: string): string | undefined {
  let target: URL;
  let home: URL;
  try {
    home = new URL(base);
    target = new URL(href, home);
  } catch {
    return undefined;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return undefined;
  // HUI's own pages stay in the page, including a link to the gateway by its full address.
  return target.origin === home.origin ? undefined : target.href;
}

/** Routes a link the WebView cannot follow (`openExternal`) and reconnects on resume. Returns the uninstall. */
export function installNativeShell(): () => void {
  const shell = typeof window === "undefined" ? null : nativeShell();
  if (!shell) return () => {};

  const handOff = (url: string) => {
    void shell.openExternal(url);
  };
  const onClick = (event: MouseEvent) => {
    // A press the page already handled, or one asking for a window, keeps its own meaning.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    // A download is the shell's own file handling, not a navigation: the page keeps the press.
    if (anchor.hasAttribute("download")) return;
    const url = externalLink(anchor.getAttribute("href") ?? "", window.location.href);
    if (!url) return;
    event.preventDefault();
    handOff(url);
  };
  document.addEventListener("click", onClick, true);

  // "Open in a new tab" has no tab to land in: the shell's browser is the only place it can open.
  const open = window.open;
  window.open = function routedOpen(url?: string | URL, target?: string, features?: string) {
    const external = typeof url === "string" ? externalLink(url, window.location.href) : undefined;
    if (!external) return open.call(window, url, target, features);
    handOff(external);
    return null;
  } as typeof window.open;

  // A resumed shell is the phone's "the connection may be back": the same event every reconnect listener already
  // watches, so there is one retry path rather than a second one for the phone.
  const stopResume = shell.onResume(() => { window.dispatchEvent(new Event("online")); });

  return () => {
    document.removeEventListener("click", onClick, true);
    window.open = open;
    stopResume();
  };
}
