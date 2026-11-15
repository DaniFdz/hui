import assert from "node:assert/strict";
import { test } from "vitest";
import type { RouteRequest } from "../http/route.ts";
import type { ModelMetricsStore } from "../model-metrics.ts";
import { createModelMetricRoutes } from "./model-metrics.ts";

function request(method: string, path: string, query = ""): RouteRequest {
  return { method, path, query: new URLSearchParams(query), headers: {}, json: async () => ({}), bytes: async () => Buffer.alloc(0), stream: async function* () {}, signal: new AbortController().signal };
}

test("serves a provider window and a session's latest measurement", async () => {
  let since = 0;
  const summary = { provider: "llama-local", since: 0, requests: 0, average: {}, p50: {}, p95: {}, samples: [] };
  const store = {
    summary: async (provider: string, at: number) => { since = at; return { ...summary, provider }; },
    latestForSession: async (session: string) => session === "s1" ? { at: 1, provider: "llama-local", model: "qwen", status: "ok" as const } : undefined,
  } as Pick<ModelMetricsStore, "summary" | "latestForSession"> as ModelMetricsStore;
  const { handle } = createModelMetricRoutes({ store });

  const provider = await handle(request("GET", "/__hui/model-metrics/providers/llama-local", "minutes=60"));
  assert.equal(provider?.status, 200);
  assert.equal((provider?.body as { provider: string }).provider, "llama-local");
  assert.ok(Date.now() - since >= 59 * 60_000);

  const session = await handle(request("GET", "/__hui/model-metrics/sessions/s1"));
  assert.equal(session?.status, 200);
  assert.equal((session?.body as { metric?: { provider: string } }).metric?.provider, "llama-local");
  const empty = await handle(request("GET", "/__hui/model-metrics/sessions/s2"));
  assert.deepEqual(empty?.body, {});

  assert.equal((await handle(request("GET", "/__hui/model-metrics/providers/Bad!")))?.status, 400);
  assert.equal((await handle(request("GET", "/__hui/model-metrics/sessions/s1/extra")))?.status, 405);
  assert.equal(await handle(request("GET", "/__hui/other")), undefined);
});
