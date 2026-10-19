/** Browser client for the Datadog routes: the org list and pup's sign-in (`/__hui/datadog`). `pup` on the gateway owns
 * every credential; these requests only move credential-free views. */
import type { DatadogConnection, DatadogOrg } from "../../shared/datadog.ts";
import { fetchJson } from "./request.ts";

const DATADOG_URL = "/__hui/datadog";

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
