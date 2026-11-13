/**
 * The Connect page's wording and the pure checks behind it: which addresses it accepts, whether an answer came from a
 * HUI gateway, and the version notice a development gateway earns. The wording follows SPEC.md "The iOS app connects
 * to one gateway" (which the Android app shares), so a test can name it without the DOM.
 */

/** An address that answers with something else. */
export const REFUSED = "This address doesn't answer as a HUI gateway.";
/** The gateway accepted the address but not the name chosen for it. */
export const NAME_NOT_SAVED = "The gateway refused its name. Clear the name to connect without saving it.";
/** A gateway with no release version (a development checkout). */
export const DEVELOPMENT_GATEWAY = "Development gateway: its version is unverified.";
/** Shown on the native side and here while a chosen gateway loads. */
export const CONNECTING = "Connecting to HUI…";
export const CHANGE_GATEWAY = "Change gateway";
export const NOT_AN_ADDRESS = "Enter an http:// or https:// address.";

/** The name a phone may give the gateway: the name every client sees, bounded as the gateway bounds it. */
export function normalizeGatewayName(raw: string): string {
  return raw.trim().slice(0, 60);
}

/**
 * The gateway's settings with the chosen name, or `null` when the read was not a settings document. The page sends this
 * whole object back: `PUT /__hui/settings` replaces missing fields with defaults, so sending only `{ name }` would reset
 * the gateway's other settings.
 */
export function settingsWithName(settings: unknown, name: string): Record<string, unknown> | null {
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return null;
  return { ...(settings as Record<string, unknown>), name: normalizeGatewayName(name) };
}

/**
 * The gateway address a typed value names, without trailing slashes, or `null` when it isn't an http(s) URL. A query, a
 * fragment or credentials are refused rather than dropped, exactly as the app's own check refuses them
 * (`GatewayAddress.java`), so a page cannot point the bridge somewhere the app would not.
 */
export function normalizeGateway(raw: string): string | null {
  const value = raw.trim();
  if (value === "" || !/^https?:\/\//iu.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.username !== "" || parsed.password !== "") return null;
    if (parsed.search !== "" || parsed.hash !== "") return null;
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return null;
  }
}

/** What `GET /__hui/update` answered, when it is HUI's own snapshot. */
export interface GatewaySnapshot {
  currentVersion: string | null;
}

/**
 * The snapshot behind an `/__hui/update` body, or `null` when the body isn't one. A HUI gateway always answers with
 * `currentVersion` (a string, or `null` on a development checkout) and `job`.
 */
export function readSnapshot(body: unknown): GatewaySnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (!("currentVersion" in record) || !("job" in record)) return null;
  const version = record.currentVersion;
  if (version !== null && typeof version !== "string") return null;
  return { currentVersion: version };
}

/** The notice a snapshot earns before the app loads it, if any. */
export function versionNotice(snapshot: GatewaySnapshot): string | null {
  return snapshot.currentVersion === null ? DEVELOPMENT_GATEWAY : null;
}
