/** Reads the gateway's date-ranged usage report, without loading transcript content. */
import { fetchJson } from "./request.ts";
import type { UsageReport } from "./schema/diagnostics.ts";

/**
 * Reading local histories is the gateway's slowest read and reports no progress,
 * so a cold scan may legitimately outlast the default header deadline; the page
 * offers Cancel while it waits. A stalled body still fails on the remote body rule.
 */
const USAGE_RESPONSE_TIMEOUT_MS = 120_000;

export type UsageQuery = { from?: string; to?: string; timeZone: string };

export function loadUsageReport(query: UsageQuery, refresh = false, signal?: AbortSignal): Promise<UsageReport> {
  const params = new URLSearchParams({ timeZone: query.timeZone });
  if (query.from !== undefined) params.set("from", query.from);
  if (query.to !== undefined) params.set("to", query.to);
  if (refresh) params.set("refresh", "1");
  return fetchJson<UsageReport>(`/__hui/usage?${params}`, undefined, signal, USAGE_RESPONSE_TIMEOUT_MS);
}
