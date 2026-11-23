/** Regression tests for OptChat's cooling nodes, due retries and skipped merge frontier. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";
import type { Summarize, SummaryRequest, Timers } from "./compactor.ts";
import { OptChatMemory, type OptChatOptions } from "./memory.ts";
import { Store } from "./store.ts";

const summary = (id: string | number) => `S${id}`.padEnd(60, "-");
const step = (request: SummaryRequest) => (request.messages[0]!.content as readonly string[])[1]!;
const leaf = (request: SummaryRequest) => {
  const match = /\nuser: M(\d+) /u.exec(step(request));
  return match ? Number(match[1]) : undefined;
};
const merge = (request: SummaryRequest) => step(request).includes("Merge these two lines");

/** A test-owned memory opened on a backlog. Undefined entries are leaves yet to build. */
async function open(t: TestContext, nodes: readonly (string | undefined)[], options: Partial<OptChatOptions> & Pick<OptChatOptions, "summarize">, parents: readonly { l: number; i: number; text: string }[] = []): Promise<OptChatMemory> {
  const dir = await mkdtemp(join(tmpdir(), "hui-optchat-cooldown-"));
  let memory: OptChatMemory | undefined;
  t.onTestFinished(async () => {
    try { await memory?.close(); } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const { store } = await Store.open(dir, { now: () => new Date(), report: assert.fail });
  try {
    for (const [i, node] of nodes.entries()) {
      const text = `M${i} ${"x".repeat(120)}`;
      await store.appendMessage({ i, kind: "user", text, size: Buffer.byteLength(`user: ${text}`), date: new Date().toISOString() });
      if (node !== undefined) await store.appendNode({ l: 0, i, text: node, size: Buffer.byteLength(node) });
    }
    for (const parent of parents) await store.appendNode({ ...parent, size: Buffer.byteLength(parent.text) });
  } finally { await store.close(); }
  memory = await OptChatMemory.open(dir, { name: "Test", node: 100, tries: 1, ...options });
  return memory;
}

/** Check the observable memory state now and whenever it changes. */
function until(memory: OptChatMemory, done: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (done()) { resolve(); return; }
    const off = memory.onChange(() => { if (done()) { off(); resolve(); } });
  });
}

/** Retry timers are inert until the test fires them; firing also removes the timer. */
function fakeTimers() {
  const pending: { fire: () => void; ms: number }[] = [];
  const timers: Timers = {
    set(callback, ms) {
      const timer = { fire: () => { const index = pending.indexOf(timer); assert.notEqual(index, -1); pending.splice(index, 1); callback(); }, ms };
      pending.push(timer);
      return timer;
    },
    clear(handle) {
      const index = pending.indexOf(handle as typeof pending[number]);
      if (index !== -1) pending.splice(index, 1);
    },
  };
  return { timers, pending };
}

type Call = { request: SummaryRequest; done: boolean; reply(text: string): void; fail(error: Error): void };

/** The provider does nothing until a test releases a call, and cooperates with cleanup's abort. */
function gated() {
  const calls: Call[] = [];
  const waiting = new Set<() => void>();
  const summarize: Summarize = (request, signal) => new Promise((resolve, reject) => {
    const complete = () => { assert.equal(call.done, false, "each call is released once"); call.done = true; signal.removeEventListener("abort", abort); };
    const abort = () => { complete(); reject(signal.reason); };
    const call: Call = {
      request, done: false,
      reply: (text) => { complete(); resolve(text); },
      fail: (error) => { complete(); reject(error); },
    };
    calls.push(call);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    for (const wake of [...waiting]) wake();
  });
  const wait = (count: number) => new Promise<void>((resolve) => {
    const check = () => { if (calls.length >= count) { waiting.delete(check); resolve(); } };
    waiting.add(check);
    check();
  });
  return { calls, summarize, wait };
}

/** Finish each remaining gated call, or stop once every complete tree node is built. */
async function finish(memory: OptChatMemory, gate: ReturnType<typeof gated>, maxCalls: number): Promise<void> {
  const settled = until(memory, () => memory.status().pending === 0).then(() => false);
  for (let i = 0; ; i++) {
    const started = await Promise.race([gate.wait(i + 1).then(() => true), settled]);
    if (!started) return;
    assert(i < maxCalls, `more than ${maxCalls} model calls`);
    const call = gate.calls[i]!;
    if (!call.done) call.reply(summary(leaf(call.request) ?? `merge-${i}`));
  }
}

test("one cooling paid merge cannot block a later free leaf or settling", { timeout: 10_000 }, async (t) => {
  const gate = gated();
  const clock = fakeTimers();
  const memory = await open(t, [summary(0), summary(1)], { summarize: gate.summarize, jobs: 1, timers: clock.timers });
  await gate.wait(1);
  assert(merge(gate.calls[0]!.request));
  gate.calls[0]!.fail(new Error("provider down"));
  await until(memory, () => clock.pending.length === 1 && memory.status().failing !== undefined);
  assert.equal(memory.status().failing?.node, "0+2");

  await memory.append("user", "short later message");
  assert.equal(await memory.settle(3), true, "the view settles while the merge is still cooling");
  assert.equal(memory.tree.text(0, 2), "user: short later message");
  assert.equal(memory.tree.has(1, 0), false);
  assert.equal(memory.status().pending, 1, "the failed merge is still pending");
  assert.equal(clock.pending.length, 1, "no retry timer fired");
  assert.equal(gate.calls.length, 1, "the free leaf did not make a paid call");
});

test("all merge slots cooling bound paid attempts while free merges and paid leaves advance, then skipped merges recover", { timeout: 10_000 }, async (t) => {
  const gate = gated();
  const clock = fakeTimers();
  const nodes = [...Array.from({ length: 6 }, (_, i) => summary(i)), "tiny-6", "tiny-7", ...Array<undefined>(4).fill(undefined)];
  const memory = await open(t, nodes, { summarize: gate.summarize, jobs: 2, timers: clock.timers });
  await gate.wait(2);
  assert.equal(leaf(gate.calls[0]!.request), 8);
  assert(step(gate.calls[1]!.request).endsWith(`\n${summary(0)}\n${summary(1)}`));
  gate.calls[1]!.fail(new Error("first merge failed"));
  await gate.wait(3);
  assert(step(gate.calls[2]!.request).endsWith(`\n${summary(2)}\n${summary(3)}`));
  gate.calls[2]!.fail(new Error("second merge failed"));
  await until(memory, () => clock.pending.length === 2 && memory.tree.has(1, 3));

  assert.equal(memory.tree.text(1, 3), "tiny-6\ntiny-7", "the later free merge runs despite the full cooldown");
  assert.equal(memory.tree.has(1, 2), false, "the earlier paid merge was skipped to reach it");
  assert.equal(gate.calls.filter(({ request }) => merge(request)).length, 2);
  for (let i = 8; i < 12; i++) {
    const callIndex = i === 8 ? 0 : i - 6;
    await gate.wait(callIndex + 1);
    assert.equal(leaf(gate.calls[callIndex]!.request), i, "paid leaves keep starting in order");
    assert.equal(gate.calls.filter(({ request }) => merge(request)).length, 2, "fresh paid merges stay bounded while both timers cool");
    gate.calls[callIndex]!.reply(summary(i));
  }
  assert.equal(await memory.settle(12), true, "all paid leaves settle without firing a retry");
  assert.equal(clock.pending.length, 2);
  assert.equal(memory.tree.has(1, 2), false);

  clock.pending[0]!.fire();
  clock.pending[0]!.fire();
  await finish(memory, gate, 14);
  assert.equal(gate.calls.length, 14, "four paid leaves, eight paid merges and two failed attempts");
  assert.equal(memory.status().pending, 0);
  assert.equal(memory.status().failing, undefined);
  assert.equal(clock.pending.length, 0);
  assert(memory.tree.has(1, 2), "the paid merge skipped before the free merge is revisited");
  const attempts = gate.calls.filter(({ request }) => merge(request)).map(({ request }) => step(request));
  assert.equal(attempts.filter((text) => text.endsWith(`\n${summary(0)}\n${summary(1)}`)).length, 2);
  assert.equal(attempts.filter((text) => text.endsWith(`\n${summary(2)}\n${summary(3)}`)).length, 2);
  assert.equal(attempts.filter((text) => text.endsWith(`\n${summary(4)}\n${summary(5)}`)).length, 1);
});

test("a retry at another level rewinds a paid merge skipped during cooldown", { timeout: 10_000 }, async (t) => {
  const gate = gated();
  const clock = fakeTimers();
  const nodes = [...Array.from({ length: 6 }, (_, i) => summary(i)), "tiny-6", "tiny-7"];
  const parents = [{ l: 1, i: 0, text: summary("left") }, { l: 1, i: 1, text: summary("right") }];
  const memory = await open(t, nodes, { summarize: gate.summarize, jobs: 1, timers: clock.timers }, parents);
  await gate.wait(1);
  const failedMerge = step(gate.calls[0]!.request);
  assert(failedMerge.endsWith(`\n${summary("left")}\n${summary("right")}`), "the level-2 merge fails first");
  gate.calls[0]!.fail(new Error("merge failed"));
  await until(memory, () => clock.pending.length === 1 && memory.tree.has(1, 3));
  assert.equal(memory.tree.text(1, 3), "tiny-6\ntiny-7");
  assert.equal(memory.tree.has(1, 2), false, "the earlier level-1 paid merge was skipped");
  assert.equal(gate.calls.length, 1);

  // The retry itself rewinds level 2, not level 1. Nothing else builds a leaf to rewind level 1 either.
  clock.pending[0]!.fire();
  await gate.wait(2);
  assert.equal(step(gate.calls[1]!.request), failedMerge);
  gate.calls[1]!.reply(summary("retried"));
  await gate.wait(3);
  assert(step(gate.calls[2]!.request).endsWith(`\n${summary(4)}\n${summary(5)}`), "the skipped level-1 merge is revisited");
  gate.calls[2]!.reply(summary("skipped"));
  await finish(memory, gate, 4);
  assert.equal(gate.calls.length, 4);
  assert.equal(memory.status().pending, 0);
  assert.equal(memory.status().failing, undefined);
});

test("a merge retry due while the only job is active starts before a fresh paid merge", { timeout: 10_000 }, async (t) => {
  const gate = gated();
  const clock = fakeTimers();
  const nodes = [...Array.from({ length: 8 }, (_, i) => summary(i)), undefined, undefined];
  const memory = await open(t, nodes, { summarize: gate.summarize, jobs: 1, timers: clock.timers });
  await gate.wait(1);
  assert.equal(leaf(gate.calls[0]!.request), 8);
  gate.calls[0]!.reply(summary(8));
  await gate.wait(2);
  const failedMerge = step(gate.calls[1]!.request);
  assert(failedMerge.endsWith(`\n${summary(0)}\n${summary(1)}`));
  gate.calls[1]!.fail(new Error("merge failed"));
  await gate.wait(3);
  assert.equal(leaf(gate.calls[2]!.request), 9);
  assert.equal(clock.pending.length, 1);
  clock.pending[0]!.fire();
  assert.equal(gate.calls.length, 3, "firing a retry does not interrupt the running leaf");
  gate.calls[2]!.reply(summary(9));
  await gate.wait(4);
  assert.equal(step(gate.calls[3]!.request), failedMerge, "the due merge wins over other ready merges");
  gate.calls[3]!.reply(summary("retried"));
  await finish(memory, gate, 11);
  assert.equal(gate.calls.length, 11, "two leaves, eight paid merges and one failed attempt");
  assert.equal(memory.status().pending, 0);
  assert.equal(memory.status().failing, undefined);
});

test("a leaf retry due with both jobs active keeps priority when a slot opens", { timeout: 10_000 }, async (t) => {
  const gate = gated();
  const clock = fakeTimers();
  const nodes = [...Array.from({ length: 6 }, (_, i) => summary(i)), ...Array<undefined>(4).fill(undefined)];
  const memory = await open(t, nodes, { summarize: gate.summarize, jobs: 2, timers: clock.timers });
  await gate.wait(2);
  assert.equal(leaf(gate.calls[0]!.request), 6);
  assert(merge(gate.calls[1]!.request));
  gate.calls[0]!.fail(new Error("leaf failed"));
  await gate.wait(3);
  assert.equal(leaf(gate.calls[2]!.request), 7);
  assert.equal(clock.pending.length, 1);
  clock.pending[0]!.fire();
  assert.equal(gate.calls.length, 3, "both jobs stay active until a call finishes");
  gate.calls[1]!.reply(summary("merge-0"));
  await gate.wait(4);
  assert.equal(leaf(gate.calls[3]!.request), 6, "the due leaf takes the released slot before a fresh merge");
  assert.equal(gate.calls[2]!.done, false, "the other leaf is still running");
  gate.calls[2]!.reply(summary(7));
  gate.calls[3]!.reply(summary(6));
  await finish(memory, gate, 13);
  assert.equal(gate.calls.length, 13, "four leaves, eight paid merges and one failed attempt");
  assert.equal(memory.status().pending, 0);
  assert.equal(memory.status().failing, undefined);
});
