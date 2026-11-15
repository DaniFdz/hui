/**
 * The gateways this device knows, as pure rules: the address a typed value names, the one key the list is saved under,
 * what a corrupt or absent list reads as, how an entry joins, is edited, marked seen, removed or carried to the page a
 * switch opens, and what each row shows (current, known with its last sighting, or offline). The current gateway is the
 * one that served the page: it names itself through `/__hui/health` and is never stored, renamed or removed here
 * (SPEC.md "A device keeps a list of gateways"). `gateway-store.ts` is the thin storage adapter around these rules and
 * `gateway-handoff.ts` appends and adopts the fragment a switch carries.
 */

/** One gateway this device has added by address. */
export type GatewayEntry = {
  /** Normalized: an http(s) origin and optional path, never a trailing slash, query, fragment or credentials. */
  url: string;
  /** This device's own label for it, chosen when it was added or edited; empty means show its hostname. */
  name: string;
  /** When this device last probed it, in epoch milliseconds. */
  lastSeen: number;
};

/** The single localStorage key holding the whole list. */
export const GATEWAY_LIST_KEY = "hui.gateways";

/** The fragment parameter a switch carries this device's list in, so the page it opens can get back. */
export const GATEWAY_HANDOFF_PARAM = "hui-gateways";

/** How many rows a carried list holds: this device's own list is far shorter. */
export const MAX_GATEWAY_HANDOFF = 32;

/** The saved shape's version, so a later change can migrate instead of guessing. */
export const GATEWAY_LIST_VERSION = 1;

/** What this device reports when a typed address is not one. */
export const GATEWAY_NOT_AN_ADDRESS = "Enter an http:// or https:// address.";
/** What it reports when an address answers with something that is not a HUI gateway. */
export const GATEWAY_REFUSED = "This address doesn't answer as a HUI gateway.";
/** What it reports when an http:// gateway is out of reach of the https page asking: a browser blocks that request. */
export const GATEWAY_MIXED_CONTENT = "This page is on https, so it can't reach an http:// gateway. Use the gateway's own https:// address.";
/** What it reports when the address is the gateway already serving the page. */
export const GATEWAY_IS_CURRENT = "This is the gateway serving this page.";
/** What it reports when the address already belongs to another saved gateway. */
export const GATEWAY_ALREADY_SAVED = "That gateway is already in your list.";
/** What the editor reports when this gateway's own name did not save. */
export const GATEWAY_NAME_UNSAVED = "Could not save the name. Try again.";

/** A host a gateway can be reached at: a name, an IPv4 address or a bracketed IPv6 address. */
const HOST = /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/iu;

/** A gateway's name for display: what it calls itself, else the host it is reached at. */
export function gatewayName(name: string, url: string): string {
  const saved = name.trim();
  if (saved) return saved;
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/**
 * The address a typed value names, without trailing slashes, or `null` when it is not an http(s) gateway address.
 * A missing scheme means http, so `192.168.1.4:8787` is the gateway on this network. A query, a fragment or
 * credentials are refused rather than dropped, mirroring the phone app's own address check.
 */
export function normalizeGatewayAddress(raw: string): string | null {
  const value = raw.trim();
  // A pasted sentence is not an address: the URL parser would percent-encode its spaces into a host nobody has.
  if (!value || /\s/u.test(value)) return null;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//iu.exec(value)?.[0];
  if (scheme && !/^https?:\/\//iu.test(scheme)) return null;
  let parsed: URL;
  try {
    parsed = new URL(scheme ? value : `http://${value}`);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (!HOST.test(parsed.hostname)) return null;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, "")}`;
}

/** Whether `url` is this device's own loopback: `127.0.0.1` and `localhost` name the machine running the page, so a
 * gateway on another machine is not at that address. */
export function isLoopbackGateway(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    return host === "localhost" || host === "::1" || /^127\./u.test(host);
  } catch {
    return false;
  }
}

/**
 * Whether a browser would block this page from reaching `url`: an https page may not fetch an http one, except at
 * loopback, which a browser treats as this device. The answer is what the dialog says instead of blaming the address
 * for a request that never left.
 */
export function blockedFromHttpsPage(url: string, pageProtocol: string): boolean {
  if (pageProtocol !== "https:") return false;
  try {
    return new URL(url).protocol === "http:" && !isLoopbackGateway(url);
  } catch {
    return false;
  }
}

/** What it reports when nothing answered a loopback address, which is never another machine's gateway. */
export function loopbackRefusal(url: string): string {
  return `Nothing answered at ${url}. 127.0.0.1 and localhost name the device running this app, not another machine.`;
}

/** The saved list, newest sighting first. Corrupt, absent or unknown-version storage reads as an empty list. */
export function readGatewayList(raw: string | null): GatewayEntry[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  const saved = Array.isArray(value) ? value : (value as { gateways?: unknown } | null)?.gateways;
  if (!Array.isArray(saved)) return [];
  const entries: GatewayEntry[] = [];
  for (const item of saved) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = typeof record["url"] === "string" ? normalizeGatewayAddress(record["url"]) : null;
    if (!url || entries.some((entry) => entry.url === url)) continue;
    const lastSeen = Number(record["lastSeen"]);
    entries.push({
      url,
      name: typeof record["name"] === "string" ? record["name"].trim().slice(0, 60) : "",
      lastSeen: Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : 0,
    });
  }
  return newestFirst(entries);
}

/** The list as storage holds it under `GATEWAY_LIST_KEY`. */
export function writeGatewayList(entries: readonly GatewayEntry[]): string {
  return JSON.stringify({ version: GATEWAY_LIST_VERSION, gateways: newestFirst(entries) });
}

/** Newest sighting first, ties by address, so the list reads the same whatever order it was saved in. */
function newestFirst(entries: readonly GatewayEntry[]): GatewayEntry[] {
  return [...entries].sort((left, right) => right.lastSeen - left.lastSeen || left.url.localeCompare(right.url));
}

/**
 * `entries` with `entry` added or refreshed. One address is one row, and the gateway serving this page is not stored:
 * its name comes from its own health route, so a probe of it never rewrites anything.
 */
export function addGateway(entries: readonly GatewayEntry[], entry: GatewayEntry, current: string): GatewayEntry[] {
  const url = normalizeGatewayAddress(entry.url);
  if (!url || url === current) return [...entries];
  const kept = entries.filter((candidate) => candidate.url !== url);
  return newestFirst([...kept, { url, name: entry.name.trim().slice(0, 60), lastSeen: entry.lastSeen }]);
}

/** `entries` without `url`. The gateway serving this page is never removed. */
export function removeGateway(entries: readonly GatewayEntry[], url: string, current: string): GatewayEntry[] {
  if (url === current) return [...entries];
  return [...entries].filter((entry) => entry.url !== url);
}

/**
 * `entries` with the row at `originalUrl` renamed and/or moved to another address, one row per address. The row keeps
 * the sighting it had unless its address changed, and the gateway serving this page is neither stored nor renamed.
 */
export function editGateway(entries: readonly GatewayEntry[], originalUrl: string, entry: GatewayEntry, current: string): GatewayEntry[] {
  const url = normalizeGatewayAddress(entry.url);
  if (!url || url === current) return [...entries];
  if (!entries.some((candidate) => candidate.url === originalUrl)) return [...entries];
  if (url !== originalUrl && entries.some((candidate) => candidate.url === url)) return [...entries];
  const edited: GatewayEntry = { url, name: entry.name.trim().slice(0, 60), lastSeen: entry.lastSeen };
  return newestFirst([...entries.filter((candidate) => candidate.url !== originalUrl), edited]);
}

/** `entries` with `url` seen again: its name and last sighting refreshed. The current gateway is never renamed here. */
export function markGatewaySeen(entries: readonly GatewayEntry[], url: string, seen: { name?: string; lastSeen: number }, current: string): GatewayEntry[] {
  if (url === current) return [...entries];
  const name = seen.name?.trim().slice(0, 60);
  return newestFirst(entries.map((entry) => entry.url === url
    ? { ...entry, name: name ? name : entry.name, lastSeen: seen.lastSeen }
    : entry));
}

/**
 * The fragment that carries `entries` to the page a switch opens, so the gateway it left stays one tap away. It is
 * compact (`[[url, name, lastSeen], …]`, in this device's own order) and percent-encoded, and a fragment never reaches
 * the gateway, its log or another tab.
 */
export function gatewayHandoff(entries: readonly GatewayEntry[]): string {
  const rows = newestFirst(entries).slice(0, MAX_GATEWAY_HANDOFF).map((entry) => [entry.url, entry.name, entry.lastSeen]);
  return `${GATEWAY_HANDOFF_PARAM}=${encodeURIComponent(JSON.stringify(rows))}`;
}

/** `url` with `entries` in its fragment; `url` alone when there is nothing to carry. */
export function gatewayHandoffAddress(url: string, entries: readonly GatewayEntry[]): string {
  if (!entries.length) return url;
  const target = new URL(url);
  target.hash = gatewayHandoff(entries);
  return target.toString();
}

/** The rows a page's own address fragment carries, newest first. A malformed, foreign or absent fragment reads as none. */
export function readGatewayHandoff(hash: string): GatewayEntry[] {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const carried = fragment.split("&").find((part) => part.startsWith(`${GATEWAY_HANDOFF_PARAM}=`));
  if (!carried) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(carried.slice(GATEWAY_HANDOFF_PARAM.length + 1)));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: GatewayEntry[] = [];
  for (const row of parsed) {
    if (!Array.isArray(row)) continue;
    const url = typeof row[0] === "string" ? normalizeGatewayAddress(row[0]) : null;
    if (!url || entries.some((entry) => entry.url === url)) continue;
    const lastSeen = Number(row[2]);
    entries.push({
      url,
      name: typeof row[1] === "string" ? row[1].trim().slice(0, 60) : "",
      lastSeen: Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : 0,
    });
    if (entries.length === MAX_GATEWAY_HANDOFF) break;
  }
  return newestFirst(entries);
}

/**
 * `entries` with the rows a switch carried, so the page it opened keeps what this device can get back to: one row per
 * address, never the gateway serving that page, and a row it already knows replaced only by one reached later.
 */
export function adoptGateways(entries: readonly GatewayEntry[], carried: readonly GatewayEntry[], current: string): GatewayEntry[] {
  const kept = [...entries];
  for (const entry of newestFirst(carried)) {
    const url = normalizeGatewayAddress(entry.url);
    if (!url || url === current) continue;
    const name = entry.name.trim().slice(0, 60);
    const known = kept.findIndex((candidate) => candidate.url === url);
    if (known === -1) kept.push({ url, name, lastSeen: entry.lastSeen });
    else if (entry.lastSeen > kept[known]!.lastSeen) kept[known] = { url, name, lastSeen: entry.lastSeen };
  }
  return newestFirst(kept);
}

/** How a row reads: the gateway serving the page, one this device reached, or one it cannot reach right now. */
export type GatewayState = "current" | "known" | "offline";

export type GatewayView = {
  url: string;
  name: string;
  state: GatewayState;
  /** The last time this device reached it; the current gateway has none, because it is being reached now. */
  lastSeen?: number;
};

/** What Settings and the sidebar list: the current gateway first, then the saved ones newest first. */
export function gatewayViews(
  entries: readonly GatewayEntry[],
  current: { url: string; name: string },
  offline: Iterable<string>,
): GatewayView[] {
  const unreachable = new Set(offline);
  return [
    { url: current.url, name: gatewayName(current.name, current.url), state: "current" },
    ...newestFirst(entries).map((entry) => ({
      url: entry.url,
      name: gatewayName(entry.name, entry.url),
      state: unreachable.has(entry.url) ? "offline" : "known",
      lastSeen: entry.lastSeen,
    } as GatewayView)),
  ];
}

/** `last seen …` in words: a row says when this device last reached another gateway. */
export function lastSeenLabel(lastSeen: number, now: number): string {
  const elapsed = Math.max(0, now - lastSeen);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(lastSeen).toISOString().slice(0, 10);
}

/**
 * What the Add/Edit gateway dialog holds: which mode it is in, the saved address it edits (empty while adding), the
 * values as typed, whether its address is the one serving this page, and its running probe or refusal.
 */
export type GatewayDialogState = {
  mode: "add" | "edit";
  originalUrl: string;
  name: string;
  address: string;
  /** That address is where this page came from, so only the name can change here. */
  addressFixed: boolean;
  busy: boolean;
  error: string;
};

/** The identity handshake a gateway answers on `GET /__hui/update`, or `null` when a body is not one. */
export type GatewayHandshake = { name: string };

/**
 * The handshake behind an `/__hui/update` body, or `null` when the body isn't HUI's. A HUI gateway always answers with
 * `currentVersion` (a string, or `null` in a development checkout) and `job`; `name` arrives with the gateway list.
 */
export function readGatewayHandshake(body: unknown): GatewayHandshake | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (!("currentVersion" in record) || !("job" in record)) return null;
  const version = record["currentVersion"];
  if (version !== null && typeof version !== "string") return null;
  return { name: typeof record["name"] === "string" ? record["name"] : "" };
}
