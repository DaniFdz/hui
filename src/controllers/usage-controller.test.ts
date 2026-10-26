import assert from "node:assert/strict";
import { test } from "vitest";
import type { UsageReport } from "../api/schema/diagnostics.ts";
import { UsageController } from "./usage-controller.ts";

const report = (from: string): UsageReport => ({ generatedAt: "2026-10-01T00:00:00Z", range: { from, to: from, timeZone: "UTC" }, sessions: [], coverage: { registeredSessions: 0, readSessions: 0, unavailable: [], undatedRecords: 0 } });

function pending() {
  let resolve: (report: UsageReport) => void = () => { throw new Error("Not initialized"); };
  const promise = new Promise<UsageReport>((done) => { resolve = done; });
  return { promise, resolve };
}

test("a failed range keeps the last report dated correctly and Retry repeats the failed query", async () => {
  const previous = report("2026-09-01");
  let fail = false;
  const asked: string[] = [];
  const state = new UsageController({ requestUpdate() {} }, async (query) => {
    asked.push(query.from ?? "all");
    if (fail) throw new Error("History could not be read");
    return asked.length === 1 ? previous : report("2026-10-01");
  });
  await state.load({ from: "2026-09-01", to: "2026-09-01", timeZone: "UTC" });
  fail = true;
  await state.load({ from: "2026-10-01", to: "2026-10-01", timeZone: "UTC" });
  assert.equal(state.report, previous);
  assert.equal(state.report.range.from, "2026-09-01");
  assert.match(state.error, /History could not be read/u);
  assert.equal(state.loading, false);
  fail = false;
  await state.load();
  assert.deepEqual(asked, ["2026-09-01", "2026-10-01", "2026-10-01"]);
  assert.equal(state.report?.range.from, "2026-10-01");
  assert.equal(state.error, "");
});

test("late responses and a disconnected page never replace the newest report", async () => {
  const old = pending();
  const current = pending();
  let reads = 0;
  const state = new UsageController({ requestUpdate() {} }, () => ++reads === 1 ? old.promise : current.promise);
  const first = state.load({ from: "2026-09-01", to: "2026-09-01", timeZone: "UTC" });
  const second = state.load({ from: "2026-10-01", to: "2026-10-01", timeZone: "UTC" });
  current.resolve(report("2026-10-01"));
  await second;
  old.resolve(report("2026-09-01"));
  await first;
  assert.equal(state.report?.range.from, "2026-10-01");
  const third = pending();
  const disconnected = new UsageController({ requestUpdate() {} }, () => third.promise);
  const load = disconnected.load();
  disconnected.disconnect();
  third.resolve(report("2026-10-01"));
  await load;
  assert.equal(disconnected.report, undefined);
});
