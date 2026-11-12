/**
 * The identity handshake this page sends a *different* gateway: `GET /__hui/update` with `x-hui: 1`, the one route a
 * gateway answers cross-origin (docs/api.md "Adding a gateway"). A gateway that answers is HUI; a refusal, a timeout
 * or anything that is not HUI's snapshot is not, and the address is then never stored.
 */
import { readGatewayHandshake } from "../lib/gateways/gateway-list.ts";
import { CLIENT_HEADERS } from "./request.ts";

/** Long enough for a phone on a slow network, short enough that a dead address answers the operator. */
export const GATEWAY_PROBE_TIMEOUT_MS = 10_000;

export type GatewayProbe = { ok: true; name: string } | { ok: false };

export async function probeGateway(url: string): Promise<GatewayProbe> {
  try {
    const response = await fetch(`${url}/__hui/update`, {
      headers: CLIENT_HEADERS,
      mode: "cors",
      cache: "no-store",
      signal: AbortSignal.timeout(GATEWAY_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false };
    const handshake = readGatewayHandshake(await response.json());
    return handshake ? { ok: true, name: handshake.name } : { ok: false };
  } catch {
    // No answer, a refused preflight or a body that is not JSON: all the same refusal to the operator.
    return { ok: false };
  }
}
