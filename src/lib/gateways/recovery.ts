/**
 * The rules behind the boot screen's way out of a gateway that cannot be reached: when the app has not painted and the
 * page's own gateway does not answer, the card says what happened and offers Retry, every other gateway this device
 * saved, and an Add form. This module is pure — no DOM, no fetch, no Lit — because `boot-recovery.ts` shares the page's
 * entry chunk with `main.ts` and runs before (and without) the app: on the web, in HUI's desktop window and in a phone's
 * WebView.
 * The addresses, the saved list, the handoff fragment and the wording are `gateway-list.ts`'s; the two probes are
 * `api/boot-health.ts`'s. Nothing here repeats either.
 */
import {
  GATEWAY_ALREADY_SAVED,
  GATEWAY_IS_CURRENT,
  GATEWAY_MIXED_CONTENT,
  GATEWAY_NOT_AN_ADDRESS,
  GATEWAY_REFUSED,
  adoptGateways,
  blockedFromHttpsPage,
  gatewayHandoffAddress,
  gatewayName,
  isLoopbackGateway,
  loopbackRefusal,
  normalizeGatewayAddress,
  type GatewayEntry,
} from "./gateway-list.ts";

/** When the boot screen checks whether the gateway it waits for answers at all: the slow line's own moment. */
export const RECOVERY_PROBE_AT_MS = 6_000;

/** When the page stops pretending to load: the card shows even if the probe is still pending. */
export const RECOVERY_DEADLINE_MS = 10_000;

/** The health probe's deadline; a gateway that needs longer than this is not one this page can wait for. */
export const RECOVERY_PROBE_TIMEOUT_MS = 4_000;

/** Another address's identity handshake deadline, the same as the Add dialog's probe (`api/gateways.ts`). */
export const RECOVERY_PROBE_DEADLINE_MS = 10_000;

/** What the page knows about its own gateway's health route: never asked, answered, or failed to answer. */
export type RecoveryProbe = "pending" | "reachable" | "unreachable";

/** Which of the boot screen's two states it is in: still waiting, or offering another gateway. */
export type RecoveryStage = "waiting" | "recovery";

/** A gateway the card offers, with the one name a person reads. */
export type RecoveryGateway = { url: string; name: string };

/**
 * The boot screen waits while a slow link may still deliver the app, and offers the recovery card once the page's
 * gateway did not answer at six seconds, or unconditionally at ten. A probe still pending at ten counts as no answer.
 */
export function recoveryStage(elapsedMs: number, probe: RecoveryProbe): RecoveryStage {
  if (elapsedMs >= RECOVERY_DEADLINE_MS) return "recovery";
  if (elapsedMs >= RECOVERY_PROBE_AT_MS && probe === "unreachable") return "recovery";
  return "waiting";
}

/** The card's heading: a gateway that answers but a slow download is a different problem from a dead one. */
export function recoveryHeadline(probe: RecoveryProbe): string {
  return probe === "reachable"
    ? "HUI is taking longer than usual to start."
    : "Can't reach this gateway.";
}

/**
 * The other gateways the card offers: the rows this page's address carried, merged into this device's stored list,
 * without the gateway serving this page. One row per address, newest first, named the way the rest of HUI names it.
 */
export function recoveryGateways(
  saved: readonly GatewayEntry[],
  carried: readonly GatewayEntry[],
  current: string,
): RecoveryGateway[] {
  return adoptGateways(saved, carried, current)
    .filter((entry) => entry.url !== current)
    .map((entry) => ({ url: entry.url, name: gatewayName(entry.name, entry.url) }));
}

export type RecoveryAdd = {
  /** The address as typed. */
  address: string;
  /** The gateway serving this page, normalized. */
  current: string;
  saved: readonly GatewayEntry[];
  /** This page's protocol (`https:` over TLS), so a request the browser would block says so first. */
  pageProtocol: string;
};

/**
 * What the Add form says about a typed address, or nothing when it may be probed. The wording is the Add dialog's, so
 * a gateway refused at boot is refused in the same words everywhere; an empty name is allowed and falls back to the
 * gateway's own.
 */
export function recoveryAddError({ address, current, saved, pageProtocol }: RecoveryAdd): string {
  const url = normalizeGatewayAddress(address);
  if (!url) return GATEWAY_NOT_AN_ADDRESS;
  if (url === current) return GATEWAY_IS_CURRENT;
  if (saved.some((entry) => entry.url === url)) return GATEWAY_ALREADY_SAVED;
  if (blockedFromHttpsPage(url, pageProtocol)) return GATEWAY_MIXED_CONTENT;
  return "";
}

/**
 * What the card says when an address did not answer as HUI, or nothing when it did. A loopback address is never
 * another machine's gateway, so it says that instead of blaming HUI.
 */
export function recoveryRefusal(probe: { ok: boolean }, url: string): string {
  if (probe.ok) return "";
  return isLoopbackGateway(url) ? loopbackRefusal(url) : GATEWAY_REFUSED;
}

/**
 * The address a switch opens: the target, carrying this device's rows, with the gateway this page is leaving first, so
 * it stays one tap away. Mirrors the rows the sidebar and Settings switch with (`GatewaysController`). The gateway left
 * carries `lastSeen: 0` — no sighting of its own — so `adoptGateways` lets a newer saved label for the same address win
 * instead of this card's hostname overwriting the name the person gave it.
 */
export function recoverySwitchAddress(
  target: string,
  current: { url: string; name: string },
  saved: readonly GatewayEntry[],
): string {
  return gatewayHandoffAddress(target, [
    { url: current.url, name: gatewayName(current.name, current.url), lastSeen: 0 },
    ...saved,
  ]);
}
