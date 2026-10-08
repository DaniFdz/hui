/**
 * The deadline of a request to HUI's own gateway. It bounds how long the
 * gateway may take to *start* answering, not how long the answer takes to
 * arrive: the gateway replies in milliseconds, but over mobile data a long
 * session's transcript can need many seconds to download, and cutting that
 * short only threw the transfer away and showed an empty conversation.
 */

/** Long enough for a phone to wake its Tailscale connection, short enough to report a dead one. */
export const RESPONSE_TIMEOUT_MS = 20_000;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Messages worth showing for the two ways a request never got an answer. */
export function gatewayRequestError(error: unknown, timeoutMs = RESPONSE_TIMEOUT_MS): unknown {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new Error(`HUI did not answer within ${Math.max(1, Math.round(timeoutMs / 1000))} s. Check the connection and try again.`, { cause: error });
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
): Promise<Response> {
  if (init.signal) {
    try {
      return await fetcher(input, init);
    } catch (error) {
      throw gatewayRequestError(error, timeoutMs);
    }
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException("The gateway did not answer in time.", "TimeoutError")), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: deadline.signal });
  } catch (error) {
    throw gatewayRequestError(error, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}
