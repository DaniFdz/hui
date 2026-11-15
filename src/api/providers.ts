/** Browser client for the provider settings: the providers snapshot, one connection's usage quota, and the
 * sign-in, model test, selection and removal requests. The gateway owns the credentials. */
import type { ProviderLogin, ProviderLoginRequest, ProviderQuota, ProviderSnapshot, ProviderTest, ProviderTestRequest } from "./schema/providers.ts";
import { fetchJson } from "./request.ts";

const API = "/__hui/providers";

export function loadProviders(): Promise<ProviderSnapshot> {
  return fetchJson<ProviderSnapshot>(API, { signal: AbortSignal.timeout(20_000) });
}

export function providerRequest<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  return fetchJson<T>(`${API}/${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(25_000) });
}

/** Starts a provider-owned sign-in and returns its pending state, including the flow the gateway recorded. */
export function startProviderLogin(provider: string, body: ProviderLoginRequest): Promise<ProviderLogin> {
  return providerRequest<ProviderLogin>(`${provider}/login`, "POST", body);
}

/** Asks one account for a one-word reply with one model; the gateway has a 45-second cap of its own. */
export function testProviderModel(provider: string, body: ProviderTestRequest): Promise<ProviderTest> {
  return fetchJson<ProviderTest>(`${API}/${provider}/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
}

export function loadProviderQuota(id: string): Promise<ProviderQuota> {
  return fetchJson<ProviderQuota>(`${API}/${id}/quota`, { signal: AbortSignal.timeout(20_000) });
}
