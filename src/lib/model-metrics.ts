/** Presentation of HUI's own model-request measurements, and the cache-read share a provider's token counts imply.
 * The composer's speed chip and the Settings model-metrics dialog read the same sample, so both name its phases the
 * same way: prefill (time to first token and prompt throughput, an estimate that includes queueing), decode (output
 * throughput over the generation span) and the cache hit share of the prompt tokens the provider reported. */
import type { ModelMetric } from "../api/schema/model-metrics.ts";

const countFormat = new Intl.NumberFormat();

/** A rate or another value HUI did not measure reads "—", never a fabricated zero. */
export function metricRate(value: number | undefined): string {
  return value === undefined ? "—" : `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} tok/s`;
}

export function metricSeconds(ms: number | undefined): string {
  return ms === undefined ? "—" : ms < 10_000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms / 1000)} s`;
}

export function metricCount(value: number | undefined): string {
  return value === undefined ? "—" : countFormat.format(value);
}

export function metricPercent(rate: number | undefined): string {
  return rate === undefined ? "—" : `${(rate * 100).toFixed(1)}%`;
}

export type MetricTokens = Pick<ModelMetric, "inputTokens" | "cacheReadTokens" | "cacheWriteTokens">;

/** The share of a request's prompt tokens the provider served from its cache: cache reads over new input, cache reads
 * and cache writes. Undefined when the provider reports no cache counts at all, so a provider that does not cache is
 * never shown as a total miss. */
export function cacheHitRate(metric: MetricTokens): number | undefined {
  const read = metric.cacheReadTokens;
  const write = metric.cacheWriteTokens;
  if (read === undefined && write === undefined) return undefined;
  const prompt = (metric.inputTokens ?? 0) + (read ?? 0) + (write ?? 0);
  return prompt > 0 ? (read ?? 0) / prompt : undefined;
}

/** Prefill as one line: the wait to first token and the prompt throughput measured over it. */
export function metricPrefill(metric: Pick<ModelMetric, "ttftMs" | "promptTokensPerSecond">): string {
  return `${metricSeconds(metric.ttftMs)} TTFT · ${metricRate(metric.promptTokensPerSecond)} prompt (est.)`;
}

/** Decode as one line: output throughput, then the generation span it divides by when HUI measured one. */
export function metricDecode(metric: Pick<ModelMetric, "tokensPerSecond" | "generationMs">): string {
  const rate = metricRate(metric.tokensPerSecond);
  return metric.generationMs === undefined ? rate : `${rate} · ${metricSeconds(metric.generationMs)}`;
}

/** Cache as one line: the hit share and the read/write counts behind it, or that the provider reported none. */
export function metricCache(metric: MetricTokens): string {
  const rate = cacheHitRate(metric);
  if (rate === undefined) return "Not reported";
  const parts = [`${metricPercent(rate)} hit`];
  if (metric.cacheReadTokens !== undefined) parts.push(`${metricCount(metric.cacheReadTokens)} read`);
  if ((metric.cacheWriteTokens ?? 0) > 0) parts.push(`${metricCount(metric.cacheWriteTokens)} written`);
  return parts.join(" · ");
}
