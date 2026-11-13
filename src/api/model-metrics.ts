/** Browser client for HUI's model-request measurements: a provider's stored summary for its metrics dialog, and the
 * latest sample for a session's composer after a reload. */
import type { ModelMetricSession, ModelMetricSummary } from "./schema/model-metrics.ts";
import { fetchJson } from "./request.ts";

const API = "/__hui/model-metrics";

export function loadModelMetrics(provider: string, minutes = 24 * 60, signal?: AbortSignal): Promise<ModelMetricSummary> {
  const query = new URLSearchParams({ minutes: String(minutes) });
  return fetchJson<ModelMetricSummary>(`${API}/providers/${encodeURIComponent(provider)}?${query}`, {
    signal: signal ?? AbortSignal.timeout(20_000),
  });
}

export function loadSessionModelMetric(session: string, signal?: AbortSignal): Promise<ModelMetricSession> {
  return fetchJson<ModelMetricSession>(`${API}/sessions/${encodeURIComponent(session)}`, {
    signal: signal ?? AbortSignal.timeout(20_000),
  });
}
