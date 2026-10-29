/**
 * The request helper for HUI's own gateway: the `x-hui` header, `fetchJson`, and `trackedFetch`, which reports a
 * request that cannot connect. The response deadline bounds how long the gateway may take to start answering,
 * not the total download time. JSON bodies have a separate no-progress deadline; a long transcript keeps loading
 * while bytes arrive. A view can cancel its read without replacing the header deadline.
 */
import { reportReachable, reportRequestFailure } from "./ui-errors.ts";
import { assertCurrentBuild } from "./offline.ts";
import { GatewayHttpError, isConnectionFailure } from "./gateway-error.ts";
export { GatewayHttpError, isGatewayUnavailable } from "./gateway-error.ts";

/** The backend refuses requests without this, which no cross-origin page can
 * set without a preflight. */
export const CLIENT_HEADERS = { "x-hui": "1" } as const;

/** Long enough for a phone to wake its Tailscale connection, short enough to report a dead one. */
export const RESPONSE_TIMEOUT_MS = 20_000;
const BODY_STALL_MS = 40_000;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Messages worth showing for the two ways a request never got an answer. */
export function gatewayRequestError(error: unknown, timeoutMs?: number): unknown {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    const deadline = timeoutMs === undefined ? "in time" : `within ${Math.max(1, Math.round(timeoutMs / 1000))} s`;
    return new Error(`HUI did not answer ${deadline}. Check the connection and try again.`, { cause: error });
  }
  if (error instanceof TypeError) {
    return new Error("Could not reach HUI. Check the connection and try again.", { cause: error });
  }
  return error;
}

/**
 * `fetch` with that deadline. A caller's own signal replaces it: that caller
 * decided how long the whole request, body included, may take.
 */
export async function fetchWithResponseDeadline(
  fetcher: Fetcher,
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = RESPONSE_TIMEOUT_MS,
  cancellation?: AbortSignal,
): Promise<Response> {
  const deadline = new AbortController();
  const signal = init.signal ?? deadline.signal;
  const timer = init.signal ? undefined
    : setTimeout(() => deadline.abort(new DOMException("The gateway did not answer in time.", "TimeoutError")), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: cancellation ? AbortSignal.any([signal, cancellation]) : signal });
  } catch (error) {
    throw gatewayRequestError(error, init.signal ? undefined : timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

function huiRequest(input: RequestInfo | URL, init?: RequestInit): { method: string; path: string } | undefined {
  let url: URL;
  try {
    url = new URL(input instanceof Request ? input.url : String(input), typeof location === "undefined" ? "http://localhost/" : location.href);
  } catch {
    return undefined;
  }
  if (typeof location !== "undefined" && url.origin !== location.origin) return undefined;
  if (!url.pathname.startsWith("/__hui/")) return undefined;
  return { method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(), path: url.pathname };
}

/** `fetch` for HUI's own API. A request that cannot reach the gateway is
 * reported once a later request succeeds; otherwise it is plain fetch. */
export async function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = huiRequest(input, init);
  if (target && !["GET", "HEAD"].includes(target.method)) {
    await assertCurrentBuild(init?.signal ?? (input instanceof Request ? input.signal : undefined));
  }
  try {
    const response = await fetch(input, init);
    if (target) reportReachable();
    return response;
  } catch (error) {
    if (target && isConnectionFailure(error)) reportRequestFailure(error, target);
    throw error;
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit, cancellation?: AbortSignal): Promise<T> {
  const stalled = new AbortController();
  const signal = cancellation ? AbortSignal.any([stalled.signal, cancellation]) : stalled.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const progress = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stalled.abort(new DOMException("The response stopped arriving.", "TimeoutError")), BODY_STALL_MS);
  };
  try {
    const response = await fetchWithResponseDeadline(trackedFetch, url, {
      ...init,
      headers: { ...CLIENT_HEADERS, ...init?.headers },
      cache: "no-store",
    }, RESPONSE_TIMEOUT_MS, signal);
    if (response.body) progress();
    const json = new Response(response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) { if (chunk.byteLength) progress(); controller.enqueue(chunk); },
    }))).json();
    if (!response.ok) {
      const detail = (await json.catch(() => undefined)) as { error?: string } | undefined;
      throw new GatewayHttpError(response.status, detail?.error ?? `${url} returned HTTP ${response.status}`);
    }
    return (await json) as T;
  } catch (error) {
    if (stalled.signal.aborted) throw new Error("HUI stopped sending data while loading. Check the connection and try again.", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
