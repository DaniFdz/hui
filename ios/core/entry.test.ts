import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { test } from "vitest";

import { buildCore } from "../../scripts/ios-build.ts";

const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const session = {
  id: "a", title: "Build", group: "ungrouped", cwd: "/w", displayCwd: "/w", tool: "pi", status: "idle", stage: "testing",
  stageOrigin: "agent", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

test("the core bundle runs with no DOM, network or timers, and every export answers there", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "hui-ios-core-"));
  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await buildCore(directory);
  const context = createContext({});
  runInContext(await readFile(join(directory, "hui-core.js"), "utf8"), context);
  const core = context["HUICore"] as typeof import("./entry.ts");

  const calls: Record<keyof typeof core, () => void> = {
    resolveNavigation: () => assert.deepEqual(json(core.resolveNavigation("/settings/appearance")), { target: { kind: "settings", page: "appearance" }, path: "/settings/appearance" }),
    navigationPath: () => assert.equal(core.navigationPath({ kind: "session", id: "a b" }), "/sessions/a%20b"),
    decodeSseFrame: () => assert.deepEqual(json(core.decodeSseFrame('event: status\ndata: {"id":"a"}')), { name: "status", payload: { id: "a" } }),
    reconnectDelay: () => assert.equal(core.reconnectDelay(1, () => 0), 250),
    sessionAccessibleName: () => assert.equal(core.sessionAccessibleName(session), "Build, status idle, tool pi, stage testing"),
    sessionStatusLabel: () => assert.equal(core.sessionStatusLabel({ status: "reconnecting", worker: { id: "w", name: "devbox" } }), "Reconnecting to devbox…"),
    sessionStatusText: () => assert.equal(core.sessionStatusText("waiting"), "Waiting for your answer"),
    sessionGroupLabel: () => assert.equal(core.sessionGroupLabel("ungrouped"), "OTHER"),
    DEFAULT_SIDEBAR_SESSION_OPTIONS: () => assert.equal(core.DEFAULT_SIDEBAR_SESSION_OPTIONS.groupBy, "custom"),
    sessionTreeRows: () => assert.deepEqual(
      json(core.sessionTreeRows([session, { ...session, id: "b", parentId: "a" }], { selectedId: "", toggled: new Set() }).map((row) => [row.session.id, row.collapsed])), [["a", true]]),
    sidebarSessionGroups: () => assert.deepEqual(
      core.sidebarSessionGroups([{ label: "ungrouped", sessions: [session] }], "", core.DEFAULT_SIDEBAR_SESSION_OPTIONS).map((group) => group.key), ["ungrouped"]),
    normalizeTranscript: () => assert.deepEqual(json(core.normalizeTranscript([{ id: "u", role: "user", text: "Hi" }]).map((item) => item.kind)), ["message"]),
    reduceTranscript: () => assert.deepEqual(
      json(core.reduceTranscript([], { type: "tool_start", id: "t", name: "read" }).map((item) => [item.kind, item.id])), [["tool", "t"]]),
    appendPendingUser: () => assert.equal(core.appendPendingUser([], "p", "Hi", []).at(-1)?.kind, "message"),
    settlePendingUser: () => assert.deepEqual(
      json(core.settlePendingUser(core.appendPendingUser([], "p", "Hi", []), "p", false).map((item) => item.kind === "message" && item.failed)), [true]),
    projectChatTranscript: () => assert.deepEqual(
      json(core.projectChatTranscript([{ kind: "message", id: "u", role: "user", text: "Hi" }]).map((row) => row.kind)), ["messages"]),
    activityLabel: () => assert.equal(core.activityLabel([{ kind: "tool", id: "t", name: "read", status: "succeeded" }], false), "Ran 1 command"),
    workingLabel: () => assert.equal(core.workingLabel([{ kind: "tool", id: "t", name: "read", status: "running" }]), "Reading files…"),
    SendRequests: () => {
      const requests = new core.SendRequests(() => "r1");
      requests.failed("a", requests.take("a", "Hi", []).requestId, "Hi", []);
      assert.equal(requests.take("a", "Hi", []).requestId, "r1");
    },
    markdownTokens: () => assert.deepEqual(
      json(core.markdownTokens("**Hi** `src/a.ts`", true)[1]?.children?.map((token) => token.type)),
      ["text", "strong_open", "text", "strong_close", "text", "html_inline", "code_inline", "html_inline"]),
  };
  assert.deepEqual(Object.keys(core).sort(), Object.keys(calls).sort());
  for (const call of Object.values(calls)) call();
});
