/** The Usage route's transport: its query, its payload schema and its refusals. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { ServerResponse } from "node:http";
import { DiagnosticsError, UsageReport } from "../api/diagnostics.ts";
import type { RouteRequest } from "../http/route.ts";
import { expectSchema } from "../test-support/api-schema.ts";
import { createDiagnosticsRoutes, USAGE_ROUTE } from "./diagnostics.ts";
import type { UsageQuery } from "../usage.ts";

const report: UsageReport = {
  generatedAt: "2026-06-01T00:00:00.000Z",
  range: { from: "2026-06-01", to: "2026-06-30", timeZone: "Europe/Madrid" },
  sessions: [],
  coverage: { registeredSessions: 0, readSessions: 0, unavailable: [], undatedRecords: 0 },
  unplacedSpend: { totalTokens: 0, costUsd: 0 },
};

function fixture() {
  const queries: UsageQuery[] = [];
  const routes = createDiagnosticsRoutes({
    observability: async () => assert.fail("the usage route reads no diagnostics"),
    usage: async (query) => {
      queries.push(query);
      return report;
    },
  });
  const call = (method: string, query: Record<string, string>) => routes.handle({
    method, path: USAGE_ROUTE, query: new URLSearchParams(query), headers: {},
    json: async () => assert.fail("the usage route reads no body"),
    bytes: async () => assert.fail("the usage route reads no body"),
    signal: new AbortController().signal,
  } satisfies RouteRequest, {} as ServerResponse);
  return { call, queries };
}

test("GET /__hui/usage answers the range it was asked for and refuses one it cannot mean", async () => {
  const f = fixture();
  const answered = await f.call("GET", { from: "2026-06-01", to: "2026-06-30", timeZone: "Europe/Madrid" });
  assert.equal(answered?.status, 200);
  expectSchema(UsageReport, answered?.body);
  assert.deepEqual(f.queries, [{ kind: "custom", from: "2026-06-01", to: "2026-06-30", timeZone: "Europe/Madrid" }]);

  const all = await f.call("GET", {});
  assert.equal(all?.status, 200);
  assert.deepEqual(f.queries.at(-1), { kind: "all", timeZone: "UTC" });

  const refused: Record<string, string>[] = [{ from: "2026-06-30", to: "2026-06-01" }, { from: "2026-06-01" }, { timeZone: "Nowhere/Land" }];
  for (const query of refused) {
    const answer = await f.call("GET", query);
    assert.equal(answer?.status, 400, JSON.stringify(query));
    expectSchema(DiagnosticsError, answer?.body);
  }
  assert.equal(f.queries.length, 2, "a refused query reads no history");

  assert.equal((await f.call("POST", {}))?.status, 405);
});