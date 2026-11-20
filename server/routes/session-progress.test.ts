import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { RouteRequest } from "../http/route.ts";
import type { SessionRecord } from "../sessions/sessions.ts";
import { SessionProgressBusyError } from "../sessions/session-progress.ts";
import { createSessionActionRoutes, routeSchemas } from "./session-actions.ts";

vi.mock("../sessions/sessions.ts", async (original) => ({
  ...await original<typeof import("../sessions/sessions.ts")>(),
  readRegistry: async () => [{ id: "a", cwd: "/repo", title: "Task", tool: "durable", createdAt: "2026-01-01T00:00:00Z" }],
}));

function routes(refreshProgress: (record: SessionRecord) => Promise<void>) {
  return createSessionActionRoutes({
    lifecycle: { updateSession: async () => assert.fail(), forkRequest: () => assert.fail(), forkFromSession: async () => assert.fail() },
    views: { toView: () => assert.fail() },
    bots: { botForSession: async () => assert.fail() },
    subagents: { cancelCollected: async () => assert.fail() },
    secretRequests: { answer: () => assert.fail() },
    questionnaires: { answer: () => assert.fail() },
    refreshProgress,
  });
}
function request(id = "a", method = "POST"): RouteRequest {
  return {
    path: `/__hui/sessions/${id}/progress`, method, query: new URLSearchParams(), headers: {},
    json: async () => assert.fail("recompute needs no body"), bytes: async () => assert.fail(),
    stream: () => assert.fail(), signal: new AbortController().signal,
  };
}

test("POST progress awaits recomputation and publishes the existing SessionOk schema", async () => {
  let finish!: () => void;
  let started!: () => void;
  const beginning = new Promise<void>((resolve) => { started = resolve; });
  const saving = new Promise<void>((resolve) => { finish = resolve; });
  let completed = false;
  const result = routes(async (record) => {
    assert.equal(record.id, "a");
    started();
    await saving;
  }).handle(request()).then((value) => { completed = true; return value; });
  await beginning;
  assert.equal(completed, false);
  finish();
  assert.deepEqual(await result, { status: 200, body: { ok: true } });
  assert(routeSchemas.some((route) => route.method === "POST" && route.path === "/__hui/sessions/:id/progress"));
});

test("recompute maps a dedicated refresh busy error to 409 and failures to 502", async () => {
  assert.deepEqual(await routes(async () => { throw new SessionProgressBusyError("Refresh pending"); }).handle(request()), {
    status: 409, body: { error: "Refresh pending" },
  });
  assert.deepEqual(await routes(async () => { throw new Error("Utility model unavailable"); }).handle(request()), {
    status: 502, body: { error: "Utility model unavailable" },
  });
  assert.deepEqual(await routes(async () => { throw "unavailable"; }).handle(request()), {
    status: 502, body: { error: "Could not recompute this session's progress." },
  });
});

test("recompute preserves unknown-session and method guards before invoking the service", async () => {
  const actions = routes(async () => assert.fail("must not refresh"));
  assert.deepEqual(await actions.handle(request("missing")), { status: 404, body: { error: "unknown session: missing" } });
  assert.deepEqual(await actions.handle(request("a", "GET")), { status: 405, body: { error: "method not allowed" } });
});
