/** Browser client for Settings → Models → Local model servers: the reachability snapshot and the one saved start
 * command per custom PI provider. Only the gateway can run that command. */
import type { LocalProvider, LocalProviderRequest, LocalProviderSnapshot } from "./schema/local-providers.ts";
import { fetchJson } from "./request.ts";

const API = "/__hui/local-providers";

export function loadLocalProviders(): Promise<LocalProviderSnapshot> {
  return fetchJson<LocalProviderSnapshot>(API, { signal: AbortSignal.timeout(20_000) });
}

export function saveLocalProvider(id: string, body: LocalProviderRequest): Promise<LocalProvider> {
  return fetchJson<LocalProvider>(`${API}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

export function startLocalProvider(id: string): Promise<LocalProvider> {
  return fetchJson<LocalProvider>(`${API}/${encodeURIComponent(id)}/start`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
}

export function removeLocalProvider(id: string): Promise<unknown> {
  return fetchJson(`${API}/${encodeURIComponent(id)}`, { method: "DELETE", signal: AbortSignal.timeout(20_000) });
}
