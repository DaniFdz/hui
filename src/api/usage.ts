/** Reads the gateway's date-ranged usage report, without loading transcript content. */
import { fetchJson } from "./request.ts";
import type { UsageReport } from "./schema/diagnostics.ts";

export type UsageQuery = { from?: string; to?: string; timeZone: string };

export function loadUsageReport(query: UsageQuery, refresh = false): Promise<UsageReport> {
  const params = new URLSearchParams({ timeZone: query.timeZone });
  if (query.from !== undefined) params.set("from", query.from);
  if (query.to !== undefined) params.set("to", query.to);
  if (refresh) params.set("refresh", "1");
  return fetchJson<UsageReport>(`/__hui/usage?${params}`);
}
