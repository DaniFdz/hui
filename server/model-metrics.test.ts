import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { ModelMetricsStore } from "./model-metrics.ts";

const sample = (at: number, provider: string, overrides: Record<string, unknown> = {}) => ({
  at, provider, model: "qwen", status: "ok" as const, inputTokens: 100, outputTokens: 10, ttftMs: 1_000, durationMs: 3_000,
  generationMs: 2_000, tokensPerSecond: 5, promptTokensPerSecond: 100, ...overrides,
});

test("summarizes a provider's window and strips the session id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hui-model-metrics-"));
  try {
    const store = new ModelMetricsStore(dir);
    store.record(sample(1_000, "llama-local"), "session-a");
    store.record(sample(2_000, "llama-local", { tokensPerSecond: 15, ttftMs: 500, status: "error" }), "session-b");
    store.record(sample(3_000, "other"), "session-a");
    await store.flush();
    const summary = await store.summary("llama-local", 0);
    assert.equal(summary.provider, "llama-local");
    assert.equal(summary.requests, 2);
    assert.equal(summary.last?.at, 2_000);
    assert.equal(summary.samples.length, 2);
    assert.equal(summary.average.tokensPerSecond, 10);
    assert.equal(summary.p50.tokensPerSecond, 5);
    assert.equal(summary.p95.tokensPerSecond, 15);
    assert.ok(summary.samples.every((entry) => !("session" in entry)));
    assert.equal((await store.latestForSession("session-b"))?.at, 2_000);
    assert.equal(await store.latestForSession("missing"), undefined);
    assert.equal((await store.summary("llama-local", 1_500)).requests, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reloads the persisted history after a gateway restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hui-model-metrics-"));
  try {
    const first = new ModelMetricsStore(dir);
    first.record(sample(1_000, "llama-local"), "session-a");
    await first.flush();
    const file = await readFile(join(dir, "model-metrics.jsonl"), "utf8");
    assert.match(file, /"session":"session-a"/u);
    const second = new ModelMetricsStore(dir);
    const summary = await second.summary("llama-local", 0);
    assert.equal(summary.requests, 1);
    assert.equal((await second.latestForSession("session-a"))?.at, 1_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
