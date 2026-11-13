/** Proves startup clock injection is automation-only, locked while running and reset for normal gateway starts. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAutomationClockBinding } from "./automation-clock.ts";
import type { Clock } from "./automation.ts";

test("a normal startup uses real time and native timers without configuration", async () => {
  const binding = createAutomationClockBinding();
  binding.bind();
  const before = Date.now();
  assert.ok(binding.clock.now() >= before && binding.clock.now() <= Date.now());
  await new Promise<void>((resolve) => binding.clock.setTimer(resolve, 0));
  binding.reset();
});

test("the already-created delegate binds before startup and clears timers through their original clock", () => {
  const binding = createAutomationClockBinding();
  const delegate = binding.clock;
  let callback: (() => void) | undefined;
  let cleared: ReturnType<typeof setTimeout> | undefined;
  const handle = { unref() {} } as ReturnType<typeof setTimeout>;
  const selected: Clock = {
    now: () => 20_000,
    setTimer: (run, delay) => { assert.equal(delay, 20_000); callback = run; return handle; },
    clearTimer: (timer) => { cleared = timer; },
  };
  binding.bind(selected);
  binding.bind(selected);
  assert.equal(delegate.now(), 20_000);
  let fired = false;
  assert.equal(delegate.setTimer(() => { fired = true; }, 20_000), handle);
  callback!();
  assert.equal(fired, true);
  delegate.clearTimer(handle);
  assert.equal(cleared, handle);
  assert.throws(() => binding.bind(), /already bound/u);
  binding.reset();
  binding.bind();
  const before = Date.now();
  assert.ok(delegate.now() >= before && delegate.now() <= Date.now());
});

test("an unconfigured restart never retains a previous fixture clock", () => {
  const binding = createAutomationClockBinding();
  binding.bind({ now: () => 123, setTimer: setTimeout, clearTimer: clearTimeout });
  assert.equal(binding.clock.now(), 123);
  binding.reset();
  binding.bind();
  assert.notEqual(binding.clock.now(), 123);
});
