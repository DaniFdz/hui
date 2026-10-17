/** Browser half of the Datadog integration: the org list and sign-in (`/__hui/datadog`), and chat previews, one
 * request per message for its (at most three) links, remembered per URL for the page so re-renders do not refetch.
 * `pup` on the gateway owns every credential; this module only moves credential-free views. A finished sign-in or
 * an org change drops what the page remembers and tells every card on it to load again. */
import {
  MAX_DATADOG_EMBEDS,
  type DatadogConnection,
  type DatadogOrg,
  type DatadogPreviewResult,
  type DatadogRef,
} from "../../shared/datadog.ts";
import { fetchJson } from "./settings-store.ts";

const DATADOG_URL = "/__hui/datadog";
/** Fired on `window` after a Datadog sign-in succeeds or the org list changes; cards listen and load again. */
export const DATADOG_CHANGED = "hui-datadog-changed";
const POLL_MS = 1_500;
/** A card stops waiting after this long even if the gateway never answers again (it gives up after 6 minutes). */
const SIGN_IN_WAIT_MS = 7 * 60_000;
const FAILURE_RETRY_MS = 30_000;
const SUCCESS_TTL_MS = 5 * 60_000;
const CACHE_LIMIT = 60;

const sameOrg = (a: DatadogOrg, b: DatadogOrg) => a.name === b.name && a.site === b.site;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(25_000),
});

export function loadDatadogConnection(): Promise<DatadogConnection> {
  return fetchJson<DatadogConnection>(DATADOG_URL, { signal: AbortSignal.timeout(25_000) });
}

/** Adds an org; the gateway starts its sign-in when pup has no session for it. */
export function addDatadogOrg(org: DatadogOrg): Promise<DatadogConnection> {
  return fetchJson<DatadogConnection>(`${DATADOG_URL}/orgs`, json("POST", org));
}

export function removeDatadogOrg(org: DatadogOrg): Promise<DatadogConnection> {
  const query = new URLSearchParams({ name: org.name, site: org.site });
  return fetchJson<DatadogConnection>(`${DATADOG_URL}/orgs?${query}`, { method: "DELETE", signal: AbortSignal.timeout(25_000) });
}

export function startDatadogLogin(org: DatadogOrg): Promise<DatadogConnection> {
  return fetchJson<DatadogConnection>(`${DATADOG_URL}/login`, json("POST", org));
}

export function cancelDatadogLogin(): Promise<DatadogConnection> {
  return fetchJson<DatadogConnection>(`${DATADOG_URL}/login`, { method: "DELETE", signal: AbortSignal.timeout(25_000) });
}

/** After a sign-in succeeds or an org is added or removed: the page forgets its previews (the gateway already
 * has) and every card loads again. */
export function notifyDatadogChanged(): void {
  cache.clear();
  settled.clear();
  window.dispatchEvent(new Event(DATADOG_CHANGED));
}

/** Signs in to one org from a card: starts pup's sign-in, or waits on the one already running for that org, and
 * resolves once that org is connected; rejects with why not. Another org's sign-in, or a cancel, is not a success. */
export async function signInToDatadog(org: DatadogOrg, wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<void> {
  let connection: DatadogConnection;
  try {
    connection = await startDatadogLogin(org);
  } catch (error) {
    connection = await loadDatadogConnection();
    if (connection.login.phase !== "pending" || !sameOrg(connection.login.org, org)) throw error;
  }
  const deadline = Date.now() + SIGN_IN_WAIT_MS;
  while (connection.login.phase === "pending" && sameOrg(connection.login.org, org) && Date.now() < deadline) {
    await wait(POLL_MS);
    // A dropped poll keeps waiting: the sign-in goes on in the gateway.
    connection = await loadDatadogConnection().catch(() => connection);
  }
  const login = connection.login;
  if (login.phase === "failed" && sameOrg(login.org, org)) throw new Error(login.message);
  if (connection.orgs.find((entry) => sameOrg(entry, org))?.status !== "connected") throw new Error("The sign-in did not finish.");
  notifyDatadogChanged();
}

type Entry = { at: number; result: Promise<DatadogPreviewResult> };
const cache = new Map<string, Entry>();
/** The latest answer per URL, kept past its TTL: a card shown again draws at once and refreshes in place. */
const settled = new Map<string, DatadogPreviewResult>();

export function settledDatadogPreview(ref: DatadogRef): DatadogPreviewResult | undefined {
  return settled.get(ref.url);
}

function fresh(entry: Entry | undefined, now: number): entry is Entry {
  return Boolean(entry) && now - entry!.at < SUCCESS_TTL_MS;
}

/** Previews in the order of `refs`. Never rejects: a failed request becomes `unavailable`. */
export function loadDatadogPreviews(refs: readonly DatadogRef[], now = Date.now(), fetcher = fetchJson): Promise<DatadogPreviewResult[]> {
  const wanted = refs.slice(0, MAX_DATADOG_EMBEDS);
  const entries = new Map<string, Entry>();
  for (const ref of wanted) {
    const entry = cache.get(ref.url);
    if (fresh(entry, now)) entries.set(ref.url, entry);
  }
  const missing = wanted.filter((ref) => !entries.has(ref.url));
  if (missing.length) {
    // ponytail: clear-all eviction like the Markdown cache, before this message's entries go in; images make
    // entries large, so the cap stays small.
    if (cache.size + missing.length > CACHE_LIMIT) cache.clear();
    const query = missing.map((ref) => `url=${encodeURIComponent(ref.url)}`).join("&");
    const batch = fetcher<{ previews: DatadogPreviewResult[] }>(`${DATADOG_URL}/previews?${query}`, { signal: AbortSignal.timeout(40_000) })
      .then((body) => body.previews)
      .catch((): DatadogPreviewResult[] => missing.map((ref) => ({ url: ref.url, error: "unavailable" })));
    for (const [index, ref] of missing.entries()) {
      const entry: Entry = { at: now, result: batch.then((results) => results[index] ?? { url: ref.url, error: "unavailable" }) };
      cache.set(ref.url, entry);
      entries.set(ref.url, entry);
      void entry.result.then((result) => { if (cache.get(ref.url) === entry) settled.set(ref.url, result); });
      // Failures age out sooner so a later render retries once the cause is fixed.
      void entry.result.then((result) => { if (result.error && cache.get(ref.url) === entry) entry.at = now - SUCCESS_TTL_MS + FAILURE_RETRY_MS; });
    }
  }
  return Promise.all(wanted.map((ref) => entries.get(ref.url)!.result));
}

/** Test helper. */
export function clearDatadogPreviewCache(): void {
  cache.clear();
  settled.clear();
}

/** What a card says instead of a graph. */
export function datadogPreviewMessage(ref: DatadogRef, result: DatadogPreviewResult): string {
  switch (result.error) {
    case "no_org": return `Add a Datadog org for ${ref.host} in Settings → Integrations to preview it.`;
    case "signed_out": return `Sign in to ${datadogOrgLabel(result.signIn)} to preview it.`;
    case "not_found": return ref.kind === "share" ? "This share link is not available." : `Not found in your Datadog orgs for ${ref.host}.`;
    case "cli_missing": return "The Datadog CLI (pup) is required for previews.";
    case "unavailable": return "Datadog preview unavailable.";
    default: return result.preview?.kind === "widget" && !result.preview.image ? "Datadog could not draw this widget." : "";
  }
}

export function datadogOrgLabel(org: DatadogOrg | undefined): string {
  if (!org) return "your Datadog org";
  return org.name || `pup's default session for ${org.site}`;
}

/** A widget's time range in local time: "Oct 16, 10:20 – 11:20", or "Past 1 hour" for links without one. */
export function formatDatadogRange(from: number, to: number, relative = false): string {
  if (relative) return "Past 1 hour";
  const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  const start = new Date(from);
  const end = new Date(to);
  const sameDay = start.toDateString() === end.toDateString();
  return `${day.format(start)}, ${time.format(start)} – ${sameDay ? "" : `${day.format(end)}, `}${time.format(end)}`;
}

/** Status line shown under the Datadog heading. */
export function datadogStatusLabel(connection: DatadogConnection | undefined): { kind: "ok" | "warn" | "danger" | "accent" | "muted"; label: string } {
  if (!connection) return { kind: "muted", label: "Checking…" };
  if (!connection.cli.installed) return { kind: "danger", label: "pup required" };
  if (connection.login.phase === "pending") return { kind: "accent", label: "Waiting for sign-in…" };
  if (!connection.orgs.length) return { kind: "muted", label: "No orgs" };
  const signedOut = connection.orgs.filter((org) => org.status === "signed_out").length;
  if (!signedOut) return { kind: "ok", label: "Connected" };
  return { kind: "warn", label: `${signedOut} ${signedOut === 1 ? "org needs" : "orgs need"} sign-in` };
}
