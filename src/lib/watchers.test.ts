import assert from "node:assert/strict";
import { test } from "vitest";
import { parseWatcherEvent, parseWatchers, watcherStateLabel, watcherStateNote } from "./watchers.ts";

test("parseWatchers normalizes snapshot rows and drops malformed ones", () => {
  const watchers = parseWatchers([
    { id: "a", purpose: "Wait", command: "true", startedAt: "2026-10-02T10:00:00.000Z", state: "running", pid: 12, logPath: "/tmp/a.log", keepRunning: true },
    { id: "b", purpose: "Bad state", command: "true", startedAt: "2026-10-02T10:00:00.000Z", state: "weird" },
    { id: "", purpose: "No id", command: "true", startedAt: "2026-10-02T10:00:00.000Z", state: "done" },
    "nope",
  ]);
  assert.deepEqual(watchers.map(({ id, state, keepRunning }) => ({ id, state, keepRunning })), [
    { id: "a", state: "running", keepRunning: true },
    { id: "b", state: "dead", keepRunning: undefined },
  ]);
  assert.equal(parseWatchers(undefined).length, 0);
});

test("watcher state labels and notes distinguish failures and missing processes", () => {
  assert.equal(watcherStateLabel({ state: "failed" }), "Failed");
  assert.equal(watcherStateNote({ state: "failed", exitCode: 3 }), "Exited with status 3.");
  assert.equal(watcherStateLabel({ state: "dead" }), "Dead");
  assert.match(watcherStateNote({ state: "dead" }), /recorded no exit status/u);
});

test("a settled watcher's event reads as the wait, how it ended and what it printed, not its instructions", () => {
  assert.deepEqual(parseWatcherEvent([
    "[HUI watcher event]",
    "id: w1",
    "purpose: Watch #152572 for a new revision, close or merge",
    "state: done",
    "note: The command finished and recorded status 0.",
    "target: https://github.com/example/repo/pull/152572",
    "outcome: Re-gate the pull request on the new revision",
    "started_at: 2026-10-02T10:00:00.000Z",
    "ended_at: 2026-10-02T11:00:00.000Z",
    "exit_code: 0",
    "last_output: 2026-10-02 11:00:00 OPEN",
    "log: /tmp/w1.log",
    "",
    "Action:",
    "This is an automated watcher event from HUI, not a message from the user.",
  ].join("\n")), {
    purpose: "Watch #152572 for a new revision, close or merge",
    state: "done",
    note: "The command finished and recorded status 0.",
    target: "https://github.com/example/repo/pull/152572",
    outcome: "Re-gate the pull request on the new revision",
    startedAt: "2026-10-02T10:00:00.000Z",
    endedAt: "2026-10-02T11:00:00.000Z",
    exitCode: 0,
    lastOutput: "2026-10-02 11:00:00 OPEN",
    log: "/tmp/w1.log",
  });
  assert.deepEqual(parseWatcherEvent("[HUI watcher event]\nid: w2\npurpose: Watch CI\nstate: dead\nlog: /tmp/w2.log"),
    { purpose: "Watch CI", state: "dead", log: "/tmp/w2.log" }, "a watcher that simply died has no note, target, outcome, end, exit status or output");
  assert.deepEqual(parseWatcherEvent("[HUI watcher event]\nid: w3"), { purpose: "" }, "the marker alone is HUI's event, never the operator's words");
  for (const own of ["hello", "see [HUI watcher event] above", "[HUI watcher event] by hand"]) {
    assert.equal(parseWatcherEvent(own), undefined, own);
  }
});
