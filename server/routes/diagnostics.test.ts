/** The Usage route's transport: its query, its payload schema and its refusals. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { ServerResponse } from "node:http";
import { DiagnosticsError, UsageInvestigation, UsageReport } from "../api/diagnostics.ts";
import { UsageInvestigationNotFoundError } from "../usage-investigation.ts";
import type { RouteRequest } from "../http/route.ts";
import { expectSchema } from "../test-support/api-schema.ts";
import { createDiagnosticsRoutes, USAGE_INVESTIGATE_ROUTE, USAGE_ROUTE } from "./diagnostics.ts";
import type { UsageQuery } from "../usage.ts";
import type { SessionView } from "../api/sessions.ts";

const session: SessionView = {
  id: "investigation", title: "Why was \"Retry-safe checkout\" expensive?", group: "checkout-api", cwd: "/tmp/checkout-api",
  displayCwd: "~/checkout-api", tool: "durable", status: "starting", stage: "investigation", stageOrigin: "default",
  createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
};

const report: UsageReport = {
  generatedAt: "2026-06-01T00:00:00.000Z",
  range: { from: "2026-06-01", to: "2026-06-30", timeZone: "Europe/Madrid" },
  sessions: [],
  investigations: [],
  coverage: { registeredSessions: 0, readSessions: 0, unavailable: [], undatedRecords: 0 },
  unplacedSpend: { totalTokens: 0, costUsd: 0 },
};

function fixture() {
  const queries: UsageQuery[] = [];
  const investigations: unknown[] = [];
  const routes = createDiagnosticsRoutes({
    observability: async () => assert.fail("the usage route reads no diagnostics"),
    usage: async (query) => {
      queries.push(query);
      return report;
    },
    investigate: async (request) => {
      investigations.push(request);
      return { session, existing: false };
    },
  });
  const call = (method: string, query: Record<string, string>) => routes.handle({
    method, path: USAGE_ROUTE, query: new URLSearchParams(query), headers: {},
    json: async () => assert.fail("the usage route reads no body"),
    bytes: async () => assert.fail("the usage route reads no body"),
    stream: () => (async function* () { assert.fail("the usage route reads no body"); })(),
    signal: new AbortController().signal,
  } satisfies RouteRequest, {} as ServerResponse);
  const investigate = (method: string, body: unknown) => routes.handle({
    method, path: USAGE_INVESTIGATE_ROUTE, query: new URLSearchParams(), headers: {},
    json: async () => body,
    bytes: async () => assert.fail("the investigation reads JSON"),
    stream: () => (async function* () { assert.fail("the investigation reads JSON"); })(),
    signal: new AbortController().signal,
  } satisfies RouteRequest, {} as ServerResponse);
  return { call, investigate, queries, investigations };
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
test("POST /__hui/usage/investigate starts the session a session or pull request names, and refuses bodies it cannot mean", async () => {
  const f = fixture();
  const answered = await f.investigate("POST", {
    target: { kind: "session", id: "retry-safe" },
    range: { from: "2026-06-01", to: "2026-06-30", timeZone: "Europe/Madrid" },
  });
  assert.equal(answered?.status, 201);
  expectSchema(UsageInvestigation, answered?.body);
  assert.deepEqual(f.investigations, [{
    target: { kind: "session", id: "retry-safe" },
    range: { from: "2026-06-01", to: "2026-06-30", timeZone: "Europe/Madrid" },
  }]);

  const pullRequest = await f.investigate("POST", {
    target: { kind: "pullRequest", repository: "acme/web", number: 12 },
    range: { timeZone: "UTC" },
  });
  assert.equal(pullRequest?.status, 201);
  assert.deepEqual(f.investigations.at(-1), { target: { kind: "pullRequest", repository: "acme/web", number: 12 }, range: { timeZone: "UTC" } });

  const refused = [
    undefined,
    [],
    { target: { kind: "session" }, range: { timeZone: "UTC" } },
    { target: { kind: "agent", id: "x" }, range: { timeZone: "UTC" } },
    { target: { kind: "pullRequest", repository: "acme", number: 1 }, range: { timeZone: "UTC" } },
    { target: { kind: "pullRequest", repository: "acme/web", number: 0 }, range: { timeZone: "UTC" } },
    { target: { kind: "pullRequest", repository: "acme/web", number: 1.5 }, range: { timeZone: "UTC" } },
    { target: { kind: "session", id: "retry-safe" } },
    { target: { kind: "session", id: "retry-safe" }, range: {} },
    { target: { kind: "session", id: "retry-safe" }, range: { timeZone: "UTC", from: 1 } },
  ];
  for (const body of refused) {
    const answer = await f.investigate("POST", body);
    assert.equal(answer?.status, 400, JSON.stringify(body));
    expectSchema(DiagnosticsError, answer?.body);
  }
  assert.equal(f.investigations.length, 2, "a refused body starts nothing");
  assert.equal((await f.investigate("GET", {}))?.status, 405);
});

test("POST /__hui/usage/investigate says when the report holds no such history", async () => {
  const routes = createDiagnosticsRoutes({
    observability: async () => assert.fail("the usage route reads no diagnostics"),
    usage: async () => report,
    investigate: async () => { throw new UsageInvestigationNotFoundError("Session gone recorded nothing between 2026-06-01 and 2026-06-30."); },
  });
  const answer = await routes.handle({
    method: "POST", path: USAGE_INVESTIGATE_ROUTE, query: new URLSearchParams(), headers: {},
    json: async () => ({ target: { kind: "session", id: "gone" }, range: { timeZone: "UTC" } }),
    bytes: async () => assert.fail("the investigation reads JSON"),
    stream: () => (async function* () { assert.fail("the investigation reads JSON"); })(),
    signal: new AbortController().signal,
  } satisfies RouteRequest, {} as ServerResponse);
  assert.equal(answer?.status, 404);
  expectSchema(DiagnosticsError, answer?.body);
  assert.deepEqual(answer?.body, { error: "Session gone recorded nothing between 2026-06-01 and 2026-06-30." });
});

test("POST /__hui/usage/investigate answers 200 when the report it was asked for already exists", async () => {
  const routes = createDiagnosticsRoutes({
    observability: async () => assert.fail("the usage route reads no diagnostics"),
    usage: async () => report,
    investigate: async () => ({ session, existing: true }),
  });
  const answer = await routes.handle({
    method: "POST", path: USAGE_INVESTIGATE_ROUTE, query: new URLSearchParams(), headers: {},
    json: async () => ({ target: { kind: "session", id: "answered" }, range: { timeZone: "UTC" } }),
    bytes: async () => assert.fail("the investigation reads JSON"),
    stream: () => (async function* () { assert.fail("the investigation reads JSON"); })(),
    signal: new AbortController().signal,
  } satisfies RouteRequest, {} as ServerResponse);
  assert.equal(answer?.status, 200);
  expectSchema(UsageInvestigation, answer?.body);
  assert.equal((answer?.body as { existing: boolean }).existing, true);
});
