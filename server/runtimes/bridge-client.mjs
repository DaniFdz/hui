import { AsyncLocalStorage } from "node:async_hooks";

/**
 * In-process runtimes run these tools inside the gateway and supply the
 * caller-bound invoker for the duration of one call; PI children use the
 * loopback bridge below.
 */
export const directHuiBridge = new AsyncLocalStorage();

/**
 * PI-side client of HUI's private agent bridge (server/agent-tools-bridge.ts).
 * The URL, bearer token and caller identity come from the environment HUI
 * gives each PI child; tool parameters can never choose another caller.
 */
export async function invokeHuiBridge(action, params, { timeoutMs = 160_000, signal } = {}) {
  const direct = directHuiBridge.getStore();
  if (direct) return direct(action, params, signal);
  const bridgeUrl = process.env.HUI_AGENT_BRIDGE_URL;
  const bridgeToken = process.env.HUI_AGENT_BRIDGE_TOKEN;
  const callerSessionId = process.env.HUI_AGENT_SESSION_ID;
  if (!bridgeUrl || !bridgeToken || !callerSessionId) {
    throw new Error("HUI agent tools are unavailable in this runtime.");
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(`${bridgeUrl}/invoke`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bridgeToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ callerSessionId, action, params }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.error || `HUI agent tool failed with HTTP ${response.status}.`);
  }
  return body.result;
}
