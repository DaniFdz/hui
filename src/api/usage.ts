/** Reads the gateway's date-ranged usage report, without loading transcript content, and starts the session that explains one expensive history. */
import { fetchJson } from "./request.ts";
import type { UsageInvestigation, UsageInvestigationRequest, UsageReport } from "./schema/diagnostics.ts";
import type { SessionView } from "./schema/sessions.ts";

/**
 * Reading local histories is the gateway's slowest read and reports no progress,
 * so a cold scan may legitimately outlast the default header deadline; the page
 * offers Cancel while it waits. A stalled body still fails on the remote body rule.
 */
const USAGE_RESPONSE_TIMEOUT_MS = 120_000;

export type UsageQuery = { from?: string; to?: string; timeZone: string };
export type UsageInvestigationTarget = UsageInvestigationRequest["target"];

export function loadUsageReport(query: UsageQuery, refresh = false, signal?: AbortSignal): Promise<UsageReport> {
  const params = new URLSearchParams({ timeZone: query.timeZone });
  if (query.from !== undefined) params.set("from", query.from);
  if (query.to !== undefined) params.set("to", query.to);
  if (refresh) params.set("refresh", "1");
  return fetchJson<UsageReport>(`/__hui/usage?${params}`, undefined, signal, USAGE_RESPONSE_TIMEOUT_MS);
}

/** Starts a new session whose first turn explains the target's recorded spend against cheaper histories. */
export async function investigateUsage(target: UsageInvestigationTarget, range: UsageQuery): Promise<SessionView> {
  const body = await fetchJson<UsageInvestigation>("/__hui/usage/investigate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, range }),
    // Creating a session waits for its runtime to be ready before the first turn is sent.
    signal: AbortSignal.timeout(60_000),
  });
  return body.session;
}
