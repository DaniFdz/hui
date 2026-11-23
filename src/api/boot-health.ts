/**
 * The two probes the boot recovery card needs before any app code has loaded: whether this page's own gateway answers
 * its health route, and whether another address answers HUI's identity handshake. This is the network boundary for
 * `src/boot-recovery.ts`, which deliberately imports none of `request.ts`: that boundary reports browser errors and
 * checks the offline build, and neither may wait on, or replace, the boot screen. Both reads are unauthenticated,
 * carry no credentials, take no body and are never retried here.
 */
import { readGatewayHandshake } from "../lib/gateways/gateway-list.ts";
import { RECOVERY_PROBE_DEADLINE_MS, RECOVERY_PROBE_TIMEOUT_MS } from "../lib/gateways/recovery.ts";

/** Whether this page's gateway answered its health route with a 2xx inside the boot probe's deadline. */
export async function probeBootHealth(): Promise<boolean> {
  try {
    const response = await fetch("/__hui/health", {
      headers: { "x-hui": "1" },
      cache: "no-store",
      signal: AbortSignal.timeout(RECOVERY_PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    // No answer, a timeout or a refused request is the same news to the boot screen.
    return false;
  }
}

export type BootHandshake = { ok: true; name: string } | { ok: false };

/**
 * Whether `url` answers as HUI, with the name it gives for itself. `GET /__hui/update` with `x-hui: 1` is the one route
 * a gateway answers cross-origin (docs/api.md "Adding a gateway"), so this is the only handshake another address gets.
 */
export async function probeBootGateway(url: string): Promise<BootHandshake> {
  try {
    const response = await fetch(`${url}/__hui/update`, {
      headers: { "x-hui": "1" },
      mode: "cors",
      cache: "no-store",
      signal: AbortSignal.timeout(RECOVERY_PROBE_DEADLINE_MS),
    });
    if (!response.ok) return { ok: false };
    const handshake = readGatewayHandshake(await response.json());
    return handshake ? { ok: true, name: handshake.name } : { ok: false };
  } catch {
    // A refused preflight, a timeout or a body that is not HUI's is a refusal to the person asking.
    return { ok: false };
  }
}
