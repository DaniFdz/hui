/**
 * What an activity trail says and what a row proves: the clock a turn shows, the counts in their fixed order, the failed
 * mark, one call's duration, and the file, pull-request, issue and session chips its own data supports.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { activityDuration, activityTrail, toolReferenceLabel, toolReferences } from "./activity-trail.ts";
import { toolActivityCounts, toolActivityKind } from "./tool-kinds.ts";

const call = (name: string, extra: Record<string, unknown> = {}) => ({ kind: "tool" as const, id: name, name, ...extra });
const thinking = (metrics?: Record<string, number>) => ({ kind: "thinking" as const, id: "th", text: "plan", ...(metrics ? { metrics } : {}) });
const error = { kind: "error" as const, id: "e", text: "it broke" };

test("a clock reads seconds, then padded seconds inside a minute, then padded minutes inside an hour", () => {
  assert.equal(activityDuration(0), "0s");
  assert.equal(activityDuration(12_400), "12s");
  assert.equal(activityDuration(59_999), "59s");
  assert.equal(activityDuration(60_000), "1m 00s");
  assert.equal(activityDuration(184_000), "3m 04s");
  assert.equal(activityDuration(3_599_000), "59m 59s");
  assert.equal(activityDuration(3_720_000), "1h 02m");
  assert.equal(activityDuration(undefined), undefined, "a span nothing measured is absent, never zero");
  assert.equal(activityDuration(Number.NaN), undefined);
  assert.equal(activityDuration(-5), undefined);
});

test("a call counts as the kind of tool it ran, in the header's fixed order", () => {
  assert.equal(toolActivityKind(call("read")), "read");
  assert.equal(toolActivityKind(call("Read_File")), "read");
  assert.equal(toolActivityKind(call("apply_patch")), "edit");
  assert.equal(toolActivityKind(call("write")), "write");
  assert.equal(toolActivityKind(call("grep")), "search");
  assert.equal(toolActivityKind(call("web_search")), "search", "a web search is a search");
  assert.equal(toolActivityKind(call("bash")), "run");
  assert.equal(toolActivityKind(call("web_fetch")), "fetch");
  assert.equal(toolActivityKind(call("browser")), "browser");
  assert.equal(toolActivityKind(call("codemode")), "other", "a codemode script is one other call");
  assert.equal(toolActivityKind(call("fixture_echo")), "other");

  assert.equal(toolActivityCounts([]), "");
  assert.equal(toolActivityCounts([call("read"), call("read"), call("read"), call("edit"), call("edit"), call("bash"), call("bash")]),
    "2 edits, 3 reads, 2 runs");
  assert.equal(toolActivityCounts([call("browser")]), "1 browser step");
  assert.equal(toolActivityCounts([call("mystery")]), "1 other call");
  assert.equal(toolActivityCounts([call("web_search"), call("web_search")]), "2 searches");
  assert.equal(toolActivityCounts([call("fetch"), call("write")]), "1 write, 1 fetch", "zero kinds are left out, never counted");
});

test("a settled trail names what it measured and what it did", () => {
  const items = [
    thinking({ timestamp: 1_000, completedAt: 2_000 }),
    call("edit", { status: "succeeded", metrics: { completedAt: 184_000 } }),
    call("read", { status: "succeeded", metrics: { completedAt: 184_000 } }),
    call("bash", { status: "succeeded", metrics: { completedAt: 185_000 } }),
  ];
  assert.deepEqual(activityTrail(items, { streaming: false }), { label: "Worked for 3m 04s · 1 edit, 1 read, 1 run", failed: 0 });
});

test("a live trail counts from its first timestamp to now, and from the turn's start when none reported one", () => {
  const measured = [thinking({ timestamp: 10_000 }), call("bash", { status: "running" })];
  assert.equal(activityTrail(measured, { streaming: true, now: 73_000 }).label, "Working for 1m 03s · 1 run");
  // Nothing measured a start yet: the turn's own start is the only truth, never the wall clock alone.
  assert.equal(activityTrail([call("bash", { status: "running" })], { streaming: true, now: 50_000, turnStartedAt: 45_000 }).label,
    "Working for 5s · 1 run");
  assert.equal(activityTrail([call("bash", { status: "running" })], { streaming: true, now: 50_000 }).label,
    "Using 1 tool · 1 run", "no start and no turn start leaves the count wording");
  assert.equal(activityTrail([], { streaming: true, now: 50_000 }).label, "Run details");
});

test("a settled span needs both ends, so half a measurement reads as a count instead of a guess", () => {
  const onlyFinished = [call("read", { status: "succeeded", metrics: { completedAt: 20_000 } })];
  assert.equal(activityTrail(onlyFinished, { streaming: false }).label, "Used 1 tool · 1 read");
  const onlyStarted = [call("read", { status: "succeeded", metrics: { timestamp: 20_000 } })];
  assert.equal(activityTrail(onlyStarted, { streaming: false }).label, "Used 1 tool · 1 read");
  // A settled trail never reads the clock, so the same items read the same at any time.
  const settled = [thinking({ timestamp: 1_000, completedAt: 5_000 }), call("read", { status: "succeeded", metrics: { completedAt: 9_000 } })];
  assert.equal(activityTrail(settled, { streaming: false }).label, "Worked for 8s · 1 read");
  assert.equal(activityTrail(settled, { streaming: false, now: Date.now() }).label, "Worked for 8s · 1 read");
});

test("reasoning alone keeps its words only when nothing measured a span for it", () => {
  assert.equal(activityTrail([thinking()], { streaming: false }).label, "Reasoning");
  assert.equal(activityTrail([thinking()], { streaming: true, now: 5_000 }).label, "Thinking…");
  // A span with both ends is work the turn spent, and there is nothing for a count to say: it reads the clock alone.
  assert.equal(activityTrail([thinking({ timestamp: 1_000, completedAt: 9_000 })], { streaming: false }).label, "Worked for 8s");
  assert.equal(activityTrail([thinking({ timestamp: 1_000 })], { streaming: true, now: 13_000 }).label, "Working for 12s");
  assert.equal(activityTrail([thinking({ timestamp: 1_000 })], { streaming: true, now: 13_000, turnStartedAt: 11_000 }).label,
    "Working for 12s", "the reasoning's own start wins over the turn's");
  // A turn this page watched begin is measured too, so live reasoning counts from it rather than saying nothing.
  assert.equal(activityTrail([thinking()], { streaming: true, now: 17_000, turnStartedAt: 12_000 }).label, "Working for 5s");
  assert.equal(activityTrail([thinking({ completedAt: 9_000 })], { streaming: false }).label, "Reasoning", "half a span is no span");
});

test("a failed call or an error is counted in the collapsed header", () => {
  assert.equal(activityTrail([call("read", { failed: true }), call("edge", { status: "failed" })], { streaming: false }).failed, 2);
  assert.equal(activityTrail([call("read", { status: "succeeded" }), error], { streaming: false }).failed, 1);
  assert.equal(activityTrail([call("read", { status: "running" })], { streaming: true }).failed, 0);
  assert.equal(activityTrail([call("read", { failed: true })], { streaming: false }).label, "Used 1 tool · 1 read", "the mark does not change the words");
});

test("a row proves a file, its pull requests and issues, and the sessions it named, never more than three", () => {
  const read = call("read", { args: { path: "/repo/fixture.txt" } });
  assert.deepEqual(toolReferences(read), [{ kind: "file", path: "/repo/fixture.txt" }]);
  assert.deepEqual(toolReferences(call("bash", { args: { command: "gh pr view 580" }, output: "https://github.com/DaniFdz/HUI/pull/580" })),
    [{ kind: "pull", number: 580, href: "https://github.com/DaniFdz/HUI/pull/580" }]);
  assert.deepEqual(toolReferences(call("bash", { args: { command: "gh issue view 12" }, output: "see https://github.com/DaniFdz/HUI/issues/12." })),
    [{ kind: "issue", number: 12, href: "https://github.com/DaniFdz/HUI/issues/12" }]);
  assert.deepEqual(toolReferences(call("bash", { args: { command: "echo nothing" }, output: "nothing" })), [], "nothing proven, no chip");
  assert.deepEqual(toolReferences(call("grep", { output: "https://example.com/DaniFdz/HUI/pull/1" })), [], "another host is not a pull request");
  assert.deepEqual(toolReferences(call("bash", { args: { command: "echo session:8f14e45f-ceea-467a-9b1d-000000000001" } })),
    [{ kind: "session", query: "8f14e45f-ceea-467a-9b1d-000000000001" }], "a named reference and its own id are one chip");
  assert.deepEqual(toolReferences(call("bash", { output: "session:abc12345" })), [{ kind: "session", query: "abc12345" }]);
  assert.deepEqual(toolReferences(call("bash", { output: "session:abc12345 and session:abc12345" })), [{ kind: "session", query: "abc12345" }]);
  // Three requests and a session: the row keeps three chips and no more, in the order it draws them.
  assert.deepEqual(toolReferences(call("bash", {
    output: "https://github.com/DaniFdz/HUI/pull/1 https://github.com/DaniFdz/HUI/pull/2 https://github.com/DaniFdz/HUI/issues/3 session:abc12345",
  })).map((reference) => reference.kind), ["pull", "pull", "issue"]);
  assert.equal(toolReferenceLabel({ kind: "pull", number: 580, href: "https://github.com/DaniFdz/HUI/pull/580" }), "PR #580");
  assert.equal(toolReferenceLabel({ kind: "issue", number: 12, href: "https://github.com/DaniFdz/HUI/issues/12" }), "Issue #12");
});
