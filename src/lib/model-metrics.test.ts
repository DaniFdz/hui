import assert from "node:assert/strict";
import { test } from "vitest";

import { cacheHitRate, metricCache, metricDecode, metricPercent, metricPrefill, metricRate, metricSeconds } from "./model-metrics.ts";

test("a cache hit is the share of prompt tokens the provider served from its cache", () => {
  assert.equal(cacheHitRate({ inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 100 }), 0.6);
  assert.equal(cacheHitRate({ inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }), 0, "a reported zero is a miss, not unknown");
  assert.equal(cacheHitRate({ inputTokens: 100 }), undefined, "a provider that reports no cache counts is not a total miss");
  assert.equal(cacheHitRate({ cacheReadTokens: 0 }), undefined, "no prompt tokens leave no share");
  assert.equal(cacheHitRate({ inputTokens: 100, cacheReadTokens: 50 }), 1 / 3);
});

test("the metric lines name prefill, decode and cache and never invent a measured zero", () => {
  const metric = {
    inputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 0,
    ttftMs: 1_200, generationMs: 900, durationMs: 2_100, tokensPerSecond: 22.2, promptTokensPerSecond: 83.3,
  };
  assert.equal(metricPrefill(metric), "1.20 s TTFT · 83.3 tok/s prompt (est.)");
  assert.equal(metricDecode(metric), "22.2 tok/s · 0.90 s");
  assert.equal(metricCache(metric), "75.0% hit · 300 read");
  assert.equal(metricCache({ inputTokens: 100 }), "Not reported");
  assert.equal(metricDecode({ tokensPerSecond: 22.2 }), "22.2 tok/s", "a whole answer has no generation span to name");
  assert.equal(metricRate(undefined), "—");
  assert.equal(metricSeconds(undefined), "—");
  assert.equal(metricSeconds(12_000), "12 s");
  assert.equal(metricPercent(undefined), "—");
});
