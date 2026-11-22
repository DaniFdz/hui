/** Proves the automation-only clock's mode changes and deadlines without global fake time or sleeps. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAutomationClock } from "../e2e/fixtures/automation-clock.ts";

type Timer = ReturnType<typeof setTimeout>;
function wallClock(start = 1_000) {
  let now = start;
  const timers = new Map<Timer, { at: number; callback: () => void; referenced: boolean }>();
  return {
    native: {
      now: () => now,
      setTimer(callback: () => void, delay: number): Timer {
        const entry = { at: now + delay, callback, referenced: true };
        const handle = {
          unref() { entry.referenced = false; return handle; },
          ref() { entry.referenced = true; return handle; },
          hasRef() { return entry.referenced; },
        } as unknown as Timer;
        timers.set(handle, entry);
        return handle;
      },
      clearTimer(handle: Timer) { timers.delete(handle); },
    },
    timers,
    advance(ms: number) {
      now += ms;
      for (const [handle, entry] of [...timers]) {
        if (entry.at > now || !timers.has(handle)) continue;
        timers.delete(handle);
        entry.callback();
      }
    },
  };
}

test("the default uses Date.now and native timers without replacing globals", async () => {
  const original = { now: Date.now, setTimeout, clearTimeout };
  const fixture = createAutomationClock();
  try {
    const before = Date.now();
    assert.equal(fixture.state(), null);
    assert.ok(fixture.clock.now() >= before && fixture.clock.now() <= Date.now());
    await new Promise<void>((resolve) => {
      const handle = fixture.clock.setTimer(resolve, 0);
      assert.equal(typeof handle.unref, "function");
    });
    assert.equal(Date.now, original.now);
    assert.equal(setTimeout, original.setTimeout);
    assert.equal(clearTimeout, original.clearTimeout);
  } finally {
    fixture.dispose();
  }
});

test("freezing preserves a pending native 20-second callback and fires only at its exact threshold", async () => {
  const wall = wallClock();
  const fixture = createAutomationClock(null, wall.native);
  const calls: number[] = [];
  let finished = false;
  const handle = fixture.clock.setTimer(() => {
    calls.push(fixture.clock.now());
    void Promise.resolve().then(() => { finished = true; });
  }, 20_000);
  handle.unref();
  assert.equal([...wall.timers.values()][0]?.referenced, false);
  wall.advance(5_000);
  assert.equal(fixture.freeze(), 6_000);
  assert.equal(fixture.freeze(), 6_000);
  assert.equal(wall.timers.size, 0);
  wall.advance(100_000);
  assert.equal(fixture.clock.now(), 6_000);
  assert.equal(fixture.advance(14_999), 20_999);
  assert.deepEqual(calls, []);
  assert.equal(fixture.advance(1), 21_000);
  assert.deepEqual(calls, [21_000]);
  assert.equal(finished, false, "the fixture does not run asynchronous work on the scheduler's behalf");
  await Promise.resolve();
  assert.equal(finished, true);
  fixture.advance(20_000);
  assert.deepEqual(calls, [21_000]);
  fixture.dispose();
});

test("freezing automation leaves other fixture clocks and native timers running", () => {
  const wall = wallClock();
  const frozen = createAutomationClock(null, wall.native);
  const realtime = createAutomationClock(null, wall.native);
  const calls: string[] = [];
  frozen.clock.setTimer(() => { calls.push("frozen"); }, 20_000);
  realtime.clock.setTimer(() => { calls.push("realtime"); }, 20_000);
  wall.native.setTimer(() => { calls.push("unrelated"); }, 20_000);
  frozen.freeze();
  wall.advance(20_000);
  assert.deepEqual(calls, ["realtime", "unrelated"]);
  assert.equal(frozen.clock.now(), 1_000);
  assert.equal(realtime.clock.now(), 21_000);
  frozen.advance(20_000);
  assert.deepEqual(calls, ["realtime", "unrelated", "frozen"]);
  frozen.dispose();
  realtime.dispose();
});

test("cancellation works in native and frozen modes with stable unref-capable handles", () => {
  const wall = wallClock();
  const fixture = createAutomationClock(null, wall.native);
  const fail = () => assert.fail("cancelled timer fired");
  const native = fixture.clock.setTimer(fail, 20_000);
  fixture.clock.clearTimer(native);
  assert.equal(wall.timers.size, 0);
  const moved = fixture.clock.setTimer(fail, 20_000);
  fixture.freeze();
  assert.equal(moved.unref(), moved);
  assert.equal(moved.hasRef(), false);
  fixture.clock.clearTimer(moved);
  const frozen = fixture.clock.setTimer(fail, 20_000);
  fixture.clock.clearTimer(frozen);
  fixture.clock.clearTimer(frozen);
  fixture.advance(20_000);
  fixture.dispose();
});

test("resume resets to wall time and rearms only the remaining delay and reference state", () => {
  const wall = wallClock();
  const fixture = createAutomationClock(null, wall.native);
  let calls = 0;
  const handle = fixture.clock.setTimer(() => { calls += 1; }, 20_000);
  handle.unref();
  fixture.freeze();
  fixture.advance(7_000);
  wall.advance(50_000);
  fixture.resume();
  assert.equal(fixture.state(), null);
  assert.equal(fixture.clock.now(), 51_000);
  assert.equal(wall.timers.size, 1);
  assert.equal([...wall.timers.values()][0]?.referenced, false);
  handle.ref();
  assert.equal([...wall.timers.values()][0]?.referenced, true);
  fixture.resume();
  assert.equal(wall.timers.size, 1);
  wall.advance(12_999);
  assert.equal(calls, 0);
  wall.advance(1);
  assert.equal(calls, 1);
  assert.equal(wall.timers.size, 0);
  fixture.dispose();
});

test("dispose releases all native and virtual timers and is idempotent", () => {
  for (const frozen of [false, true]) {
    const wall = wallClock();
    const fixture = createAutomationClock(null, wall.native);
    fixture.clock.setTimer(() => assert.fail("disposed timer fired"), 20_000);
    if (frozen) fixture.freeze();
    fixture.dispose();
    fixture.dispose();
    assert.equal(wall.timers.size, 0);
    wall.advance(20_000);
    assert.throws(() => fixture.clock.setTimer(() => {}, 0), /disposed/u);
    assert.throws(() => fixture.advance(20_000), /disposed/u);
  }
});

test("a new child clock restored from numeric state preserves a future absolute deadline", () => {
  const wall = wallClock();
  const first = createAutomationClock(null, wall.native);
  first.freeze();
  first.advance(7_000);
  const state = first.state();
  const deadline = first.clock.now() + 20_000;
  first.dispose();
  wall.advance(100_000);
  const second = createAutomationClock(state, wall.native);
  let calls = 0;
  second.clock.setTimer(() => { calls += 1; }, deadline - second.clock.now());
  assert.equal(second.clock.now(), 8_000);
  assert.equal(wall.timers.size, 0);
  second.advance(19_999);
  assert.equal(calls, 0);
  second.advance(1);
  assert.equal(calls, 1);
  assert.equal(second.clock.now(), deadline);
  second.dispose();
});

test("advance rejects realtime, backward, nonfinite and overflowing changes without moving time", () => {
  const fixture = createAutomationClock(null, wallClock().native);
  assert.throws(() => fixture.advance(0), /Freeze/u);
  fixture.freeze();
  for (const invalid of [-1, NaN, Infinity, -Infinity]) {
    assert.throws(() => fixture.advance(invalid), RangeError);
    assert.equal(fixture.state(), 1_000);
  }
  assert.equal(fixture.advance(0), 1_000);
  fixture.dispose();
  const huge = createAutomationClock(Number.MAX_VALUE);
  assert.throws(() => huge.advance(Number.MAX_VALUE), RangeError);
  huge.dispose();
  for (const invalid of [NaN, Infinity, -Infinity]) assert.throws(() => createAutomationClock(invalid), RangeError);
});

test("a callback advancing farther cannot make the outer advance rewind the clock", () => {
  const fixture = createAutomationClock(1_000);
  const calls: number[] = [];
  fixture.clock.setTimer(() => { fixture.advance(100); }, 5);
  fixture.clock.setTimer(() => { calls.push(fixture.clock.now()); }, 50);
  assert.equal(fixture.advance(10), 1_105);
  assert.equal(fixture.state(), 1_105);
  assert.deepEqual(calls, [1_050]);
  fixture.dispose();
});

test("virtual callbacks fire in deadline order and can cancel or schedule another callback", () => {
  const fixture = createAutomationClock(1_000);
  const calls: number[] = [];
  const cancelled = fixture.clock.setTimer(() => assert.fail("cancelled callback fired"), 10);
  fixture.clock.setTimer(() => {
    calls.push(fixture.clock.now());
    fixture.clock.clearTimer(cancelled);
    fixture.clock.setTimer(() => { calls.push(fixture.clock.now()); }, 5);
  }, 5);
  fixture.advance(10);
  assert.deepEqual(calls, [1_005, 1_010]);
  fixture.dispose();
});
