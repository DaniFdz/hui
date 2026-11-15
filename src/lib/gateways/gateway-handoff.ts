/**
 * The switch handoff: the gateway this page leaves appends this device's list to the address it navigates to, and the
 * page that opens adopts it and drops it from its own address, so a switch can always be undone without retyping an
 * address. The rows themselves are `gateway-list.ts`'s rules; this is the browser seam that reads the fragment at boot
 * and clears it. HUI's desktop window and a phone's WebView load the same address unchanged, and a page with no bridge
 * behaves exactly as it did.
 */
import { readGatewayHandoff } from "./gateway-list.ts";
import type { GatewayStore } from "./gateway-store.ts";

/** The parts of the page this module reads, so a test needs no browser to run it. */
export type HandoffPage = Pick<Location, "hash" | "pathname" | "search">;

/** The part of `history` this module writes. */
export type HandoffHistory = Pick<History, "state" | "replaceState">;

/**
 * Saves the rows this page's fragment carries, then leaves the address without it, so a reload or a later navigation
 * starts from the gateway's own address. Answers whether it adopted anything. Storage that refuses the write still
 * gets the rows on screen for this page's life, which is what `GatewayStore` already promises.
 */
export function adoptGatewayHandoff(
  store: Pick<GatewayStore, "adopt">,
  page: HandoffPage | undefined = globalThis.location,
  history: HandoffHistory | undefined = globalThis.history,
): boolean {
  if (!page) return false;
  const carried = readGatewayHandoff(page.hash);
  if (!carried.length) return false;
  store.adopt(carried);
  try {
    history?.replaceState(history.state, "", `${page.pathname}${page.search}`);
  } catch {
    // The address keeps the fragment; the rows it carried are already this page's.
  }
  return true;
}
