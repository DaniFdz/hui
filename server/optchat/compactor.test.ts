import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";
import { Compactor, createLimiter, SYSTEM_TIMERS, type Summarize, type SummaryRequest, type Timers } from "./compactor.ts";
import { OptChatMemory, type OptChatOptions } from "./memory.ts";
import { compactPrompt } from "./prompts.ts";
import { Store } from "./store.ts";
import { PLACEHOLDER, Tree } from "./tree.ts";
import { View } from "./view.ts";

/** The memories each test opened, closed before its directory is removed. */
const opened = new WeakMap<TestContext, OptChatMemory[]>();

async function directory(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hui-optchat-compactor-"));
  // Closes the test's memories itself before removing the directory, whatever order cleanups run in: a memory
  // still saving its view while the directory is removed fails the rm with ENOTEMPTY.
  t.onTestFinished(async () => {
    for (const memory of opened.get(t) ?? []) await memory.close();
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function open(t: TestContext, options: Partial<OptChatOptions> & Pick<OptChatOptions, "summarize">, dir?: string): Promise<OptChatMemory> {
  const memory = await OptChatMemory.open(dir ?? await directory(t), { name: "Grok", ...options });
  opened.set(t, [...(opened.get(t) ?? []), memory]);
  t.onTestFinished(() => memory.close());
  return memory;
}

/** Resolves once `done` holds, checking now and after every change of the memory. */
function until(memory: OptChatMemory, done: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (done()) { resolve(); return; }
    const off = memory.onChange(() => { if (done()) { off(); resolve(); } });
  });
}

const allBuilt = (memory: OptChatMemory) => until(memory, () => memory.status().pending === 0);
const refuse: Summarize = async () => { throw new Error("no model call expected"); };
/** The step block of a request's first user message, and the context block before it. */
const blocks = (request: SummaryRequest) => request.messages[0]!.content as readonly string[];
const leafIndex = (request: SummaryRequest) => {
  const match = /\nuser: M(\d+) /u.exec(blocks(request)[1]!);
  return match ? Number(match[1]) : undefined;
};
const merging = (request: SummaryRequest) => blocks(request)[1]!.includes("Merge these two lines");
const summary = (id: string | number) => `S${id}`.padEnd(60, "-");

/** A backlog with a summarized prefix, no merges, and long messages left to summarize. */
async function backlog(t: TestContext, count: number, built: number): Promise<string> {
  const dir = await directory(t);
  const { store } = await Store.open(dir, { now: () => new Date(), report: assert.fail });
  for (let i = 0; i < count; i++) {
    const text = `M${i} ${"y".repeat(120)}`;
    await store.appendMessage({ i, kind: "user", text, size: Buffer.byteLength(`user: ${text}`), date: new Date().toISOString() });
    if (i < built) await store.appendNode({ l: 0, i, text: summary(i), size: 60 });
  }
  await store.close();
  return dir;
}

/** A summarizer whose calls wait until the test releases them, one by one or all. */
function gated() {
  const calls: { request: SummaryRequest; reply: (text: string) => void; fail: (error: Error) => void }[] = [];
  let running = 0;
  let peak = 0;
  const started = new Set<() => void>();
  const summarize: Summarize = (request) => new Promise((resolve, reject) => {
    running++;
    peak = Math.max(peak, running);
    const done = () => { running--; };
    calls.push({ request, reply: (text) => { done(); resolve(text); }, fail: (error) => { done(); reject(error); } });
    for (const wake of [...started]) wake();
  });
  const call = (count: number) => new Promise<void>((resolve) => {
    const check = () => { if (calls.length >= count) { started.delete(check); resolve(); } };
    started.add(check);
    check();
  });
  return { summarize, calls, call, peak: () => peak, running: () => running };
}

test("short messages and lines that fit are their own nodes, with no model call", { timeout: 10_000 }, async (t) => {
  const memory = await open(t, { summarize: refuse });
  for (const [kind, text] of [["user", "a"], ["talk", "b"], ["tool", "read {}"], ["echo", "c"]] as const) await memory.append(kind, text);
  await allBuilt(memory);
  assert.deepEqual([memory.tree.text(0, 0), memory.tree.text(1, 0), memory.tree.text(1, 1), memory.tree.text(2, 0)],
    ["user: a", "user: a\ntalk: b", "tool: read {}\necho: c", "user: a\ntalk: b\ntool: read {}\necho: c"]);
  assert.deepEqual(memory.status().usage.calls, 0);
});

test("up to JOBS messages are compressed at once, in order, and no context ever holds an unsummarized line", { timeout: 10_000 }, async (t) => {
  const gate = gated();
  const memory = await open(t, { summarize: gate.summarize, node: 64, jobs: 4 });
  for (let i = 0; i < 6; i++) await memory.append("user", `M${i} ${"y".repeat(97)}`);
  const message = (request: SummaryRequest) => /\nuser: (M\d+)/u.exec(blocks(request)[1]!)?.[1];
  // 40-byte lines: two of them (81 bytes with the newline) need a model call to merge.
  const answer = (k: number) => {
    const name = message(gate.calls[k]!.request);
    gate.calls[k]!.reply(name ? `S-${name}`.padEnd(40, "-") : "MERGED");
  };
  await gate.call(4);
  assert.deepEqual(gate.calls.map(({ request }) => [message(request), blocks(request)[0]]),
    ["M0", "M1", "M2", "M3"].map((name) => [name, "<chat>\n\n</chat>"]), "four start at once, before any line is built");
  // M1 finishes first: M0 still waits, and fewer than JOBS lines before M4 do, so M4 starts with a context that
  // stops at M0.
  answer(1);
  await gate.call(5);
  assert.deepEqual([message(gate.calls[4]!.request), blocks(gate.calls[4]!.request)[0]], ["M4", "<chat>\n\n</chat>"],
    "a freed job goes to the next message, whose context stops at the first line not built");
  answer(0);
  for (let k = 2; k < 9; k++) {
    await gate.call(k + 1);
    answer(k);
  }
  await allBuilt(memory);
  const requests = gate.calls.map(({ request }) => request);
  assert.deepEqual(requests.map(message).filter(Boolean), ["M0", "M1", "M2", "M3", "M4", "M5"]);
  assert.equal(requests.filter((request) => blocks(request)[1]!.includes("Merge these two lines")).length, 3, "three level-1 merges; the level-2 one fits for free");
  assert.equal(memory.tree.text(2, 0), "MERGED\nMERGED");
  for (const request of requests) {
    assert(!blocks(request)[0]!.includes(PLACEHOLDER), "rule 3: the compactor only ever sees summaries");
    assert(!/^\d+\+\d+\|/mu.test(blocks(request).join("\n")), "no ids in a compactor call");
    assert.equal(request.system, compactPrompt("Grok"));
  }
  assert(gate.peak() <= 4, String(gate.peak()));
});

test("a merge waits until every line before its end is summarized, so its context is whole", { timeout: 10_000 }, async (t) => {
  const model = gated();
  const memory = await open(t, { summarize: model.summarize, node: 64, jobs: 4 });
  // 40-byte lines: two of them (81 bytes with the newline) need a model call to merge.
  const summary = (k: number) => `S-M${k}`.padEnd(40, "-");
  const step = (k: number) => blocks(model.calls[k]!.request)[1]!;
  for (let i = 0; i < 4; i++) await memory.append("user", `M${i} ${"y".repeat(97)}`);
  await model.call(4);
  model.calls[2]!.reply(summary(2));
  model.calls[3]!.reply(summary(3));
  await until(memory, () => memory.tree.has(0, 2) && memory.tree.has(0, 3));
  await memory.append("user", `M4 ${"y".repeat(97)}`);
  await model.call(5);
  assert.deepEqual([model.calls.length, /\nuser: (M\d+)/u.exec(step(4))?.[1]], [5, "M4"], "M2 and M3 are built, but not M0 before them: no merge yet");
  model.calls[0]!.reply(summary(0));
  model.calls[1]!.reply(summary(1));
  await model.call(7);
  assert(step(5).includes("Merge these two lines") && step(6).includes("Merge these two lines"), step(6));
  assert.deepEqual([5, 6].map((k) => blocks(model.calls[k]!.request)[0]), [
    `<chat>\n${[0, 1].map(summary).join("\n")}\n</chat>`,
    `<chat>\n${[0, 1, 2, 3].map(summary).join("\n")}\n</chat>`,
  ], "each merge reads every line before its end");
  for (const k of [5, 6]) model.calls[k]!.reply("MERGED");
  model.calls[4]!.reply(summary(4));
  await allBuilt(memory);
  assert.equal(memory.tree.text(2, 0), "MERGED\nMERGED");
});

test("a mixed backlog makes progress on leaves and merges in parallel, shrinking later contexts", { timeout: 10_000 }, async (t) => {
  const gate = gated();
  const memory = await open(t, { summarize: gate.summarize, node: 100, context: 768, jobs: 4 }, await backlog(t, 24, 8));
  const initialSize = memory.compaction().size;
  await gate.call(4);
  assert.deepEqual(gate.calls.map(({ request }) => leafIndex(request) ?? "merge"), [8, "merge", 9, "merge"]);
  assert.equal(blocks(gate.calls[1]!.request)[0], `<chat>\n${summary(0)}\n${summary(1)}\n</chat>`);
  assert(blocks(gate.calls[1]!.request)[1]!.endsWith(`${summary(0)}\n${summary(1)}`), "the merge has both built children");
  assert(!memory.tree.has(0, 23), "merging starts before the leaf backlog is built");

  gate.calls[1]!.reply(summary("merge-1"));
  await gate.call(5);
  assert.equal(leafIndex(gate.calls[4]!.request), 10);
  assert(memory.compaction().size < initialSize, "the first built merge lets the compaction view shrink");
  assert(Buffer.byteLength(blocks(gate.calls[4]!.request)[0]!) < Buffer.byteLength(blocks(gate.calls[0]!.request)[0]!),
    "the next leaf reads the smaller, folded context");
  // Finish a later leaf while M8 and M9 still run; a merge of the already built prefix gets the next slot.
  gate.calls[4]!.reply(summary(10));
  await gate.call(6);
  assert(merging(gate.calls[5]!.request));
  assert(memory.tree.has(0, 4) && memory.tree.has(0, 5));
  assert(blocks(gate.calls[5]!.request)[1]!.endsWith(`${summary(4)}\n${summary(5)}`));
  assert.equal(blocks(gate.calls[5]!.request)[0], `<chat>\n${[summary("merge-1"), ...[2, 3, 4, 5].map(summary)].join("\n")}\n</chat>`,
    "the merge reads its complete built context even with later leaves still running");

  const answered = new Set([1, 4]);
  // 16 leaves and 22 merges, all long enough to need a model call.
  for (let k = 0; k < 38; k++) {
    await gate.call(k + 1);
    const request = gate.calls[k]!.request;
    assert(!blocks(request)[0]!.includes(PLACEHOLDER));
    if (!answered.has(k)) gate.calls[k]!.reply(summary(leafIndex(request) ?? `merge-${k}`));
  }
  await allBuilt(memory);
  assert.deepEqual(gate.calls.map(({ request }) => leafIndex(request)).filter((i) => i !== undefined),
    Array.from({ length: 16 }, (_, i) => i + 8), "leaves still start FIFO and all finish");
  assert.equal(gate.calls.filter(({ request }) => merging(request)).length, 22);
  assert.equal(gate.peak(), 4, "the scheduler fills but never exceeds JOBS");
});

test("one job alternates ready leaves and merges without starving either backlog", { timeout: 10_000 }, async (t) => {
  const gate = gated();
  const memory = await open(t, { summarize: gate.summarize, node: 100, jobs: 1 }, await backlog(t, 16, 8));
  // 8 leaves and 15 merges, all long enough to need a model call.
  for (let k = 0; k < 23; k++) {
    await gate.call(k + 1);
    const request = gate.calls[k]!.request;
    assert(!blocks(request)[0]!.includes(PLACEHOLDER));
    gate.calls[k]!.reply(summary(leafIndex(request) ?? `merge-${k}`));
  }
  await allBuilt(memory);
  assert.deepEqual(gate.calls.slice(0, 8).map(({ request }) => leafIndex(request) ?? "merge"),
    [8, "merge", 9, "merge", 10, "merge", 11, "merge"]);
  assert(blocks(gate.calls[5]!.request)[1]!.endsWith(`${summary("merge-1")}\n${summary("merge-3")}`),
    "the parent of two completed merges starts before more level-1 pairs");
  assert.deepEqual(gate.calls.map(({ request }) => leafIndex(request)).filter((i) => i !== undefined),
    Array.from({ length: 8 }, (_, i) => i + 8), "all leaves start in order");
  assert.equal(gate.calls.filter(({ request }) => merging(request)).length, 15, "all merges finish too");
  assert.equal(gate.peak(), 1);
});

test("a slow merge cannot occupy the last job while ready leaves remain", { timeout: 10_000 }, async (t) => {
  const gate = gated();
  const memory = await open(t, { summarize: gate.summarize, node: 100, jobs: 2 }, await backlog(t, 16, 8));
  await gate.call(2);
  assert.deepEqual(gate.calls.map(({ request }) => leafIndex(request) ?? "merge"), [8, "merge"]);
  for (let i = 8; i < 16; i++) {
    const call = i === 8 ? 0 : i - 7;
    await gate.call(call + 1);
    assert.equal(leafIndex(gate.calls[call]!.request), i, "leaves continue while the first merge is held");
    gate.calls[call]!.reply(summary(i));
  }
  await gate.call(10);
  assert(merging(gate.calls[9]!.request), "when no leaf is ready, the other slot is used for a merge");
  assert.equal(gate.running(), 2);
  gate.calls[1]!.reply(summary("held"));
  // 8 leaves and 15 merges; the leaves and the held merge are already answered.
  for (let k = 9; k < 23; k++) {
    await gate.call(k + 1);
    gate.calls[k]!.reply(summary(`merge-${k}`));
  }
  await allBuilt(memory);
  assert.equal(gate.peak(), 2);
});

test("a slow leaf cannot occupy the last job while ready merges remain", { timeout: 10_000 }, async (t) => {
  const gate = gated();
  const memory = await open(t, { summarize: gate.summarize, node: 100, jobs: 2 }, await backlog(t, 12, 8));
  await gate.call(2);
  assert.equal(leafIndex(gate.calls[0]!.request), 8);
  for (let k = 1; k <= 7; k++) {
    await gate.call(k + 1);
    assert(merging(gate.calls[k]!.request), "the built prefix continues merging while the first leaf is held");
    gate.calls[k]!.reply(summary(`merge-${k}`));
  }
  await gate.call(9);
  assert.equal(leafIndex(gate.calls[8]!.request), 9, "when no merge is ready, the other slot is used for a leaf");
  gate.calls[0]!.reply(summary(8));
  gate.calls[8]!.reply(summary(9));
  // Four leaves and ten merges; the first two leaves and seven merges are already answered.
  for (let k = 9; k < 14; k++) {
    await gate.call(k + 1);
    const request = gate.calls[k]!.request;
    gate.calls[k]!.reply(summary(leafIndex(request) ?? `merge-${k}`));
  }
  await allBuilt(memory);
  assert.equal(gate.peak(), 2);
});

test("a parent skipped for an unfinished child becomes ready when that child builds", { timeout: 10_000 }, async (t) => {
  const gate = gated();
  const memory = await open(t, { summarize: gate.summarize, node: 100, jobs: 3 }, await backlog(t, 8, 8));
  await gate.call(3);
  gate.calls[1]!.reply(summary("one"));
  await gate.call(4);
  gate.calls[2]!.reply(summary("two"));
  gate.calls[3]!.reply(summary("three"));
  await gate.call(5);
  assert(blocks(gate.calls[4]!.request)[1]!.endsWith(`${summary("two")}\n${summary("three")}`),
    "the later parent builds while the earlier child is held");
  gate.calls[4]!.reply(summary("later-parent"));
  await until(memory, () => memory.tree.has(2, 1));
  assert.equal(gate.calls.length, 5);
  gate.calls[0]!.reply(summary("zero"));
  await gate.call(6);
  assert(blocks(gate.calls[5]!.request)[1]!.endsWith(`${summary("zero")}\n${summary("one")}`),
    "building the held child revisits its earlier parent");
  gate.calls[5]!.reply(summary("earlier-parent"));
  await gate.call(7);
  gate.calls[6]!.reply(summary("root"));
  await allBuilt(memory);
});

test("a held early merge does not make the scheduler rescan a growing built suffix", { timeout: 10_000 }, async () => {
  class CountedTree extends Tree {
    mergeChecks = 0;
    override has(l: number, i: number): boolean {
      if (l === 1) this.mergeChecks++;
      return super.has(l, i);
    }
  }
  const count = 600;
  const tree = new CountedTree();
  for (let i = 0; i < count / 2; i++) tree.set(0, i, summary(i));
  const view = new View({ length: count, tree }, { high: 1_000_000, low: 500_000 });
  for (let i = 0; i < count; i++) view.append(i);
  let done!: () => void;
  const lastLeaf = new Promise<void>((resolve) => { done = resolve; });
  let held = false;
  const compactor = new Compactor({
    length: count, tree, view,
    message: (i) => ({ i, kind: "user", text: `M${i} ${"y".repeat(120)}`, size: 128, date: "2026-01-01" }),
    context: () => [], system: () => "", usage: () => {}, failed: assert.fail, changed: () => {},
    persist: async (l, i, text) => {
      tree.set(l, i, text);
      view.built(l, i);
      if (l === 0 && i === count - 1) done();
    },
  }, async (request, signal) => {
    if (merging(request) && !held) {
      held = true;
      return new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
    return summary("built");
  }, { node: 100, jobs: 3, tries: 1, retryMs: 10_000, timers: SYSTEM_TIMERS, now: () => new Date() });
  compactor.pump();
  await lastLeaf;
  compactor.close();
  assert(held);
  assert(tree.mergeChecks < count * 40, `${tree.mergeChecks} level-1 lookups while building ${count / 2} leaves`);
});

test("over the limit, the same conversation shows the cut, and after TRIES replies the shortest wins", { timeout: 10_000 }, async (t) => {
  const replies = [`${"a".repeat(511)}é${"b".repeat(100)}`, "c".repeat(530), "d".repeat(520), "e".repeat(540), "f".repeat(525)];
  const requests: SummaryRequest[] = [];
  const memory = await open(t, { summarize: async (request) => { requests.push(request); return `  ${replies[requests.length - 1]}\n`; } });
  await memory.append("user", "z".repeat(600));
  await allBuilt(memory);
  assert.equal(requests.length, 5);
  assert.equal(memory.tree.text(0, 0), "d".repeat(520), "a stubborn node keeps its shortest try");
  assert.deepEqual(requests.map((request) => request.messages.length), [1, 3, 5, 7, 9]);
  const second = requests[1]!.messages;
  assert.deepEqual(second[1], { role: "assistant", content: `  ${replies[0]}\n` });
  // The 512th byte falls inside "é": the cut ends on the character before it.
  assert.deepEqual(second[2], { role: "user", content: [`That line is 613 bytes; the limit is 512. It must end where it is cut here:\n${"a".repeat(511)}| ← LIMIT`] });
  const feedback = requests[4]!.messages[8];
  assert(feedback?.role === "user");
  assert.equal(feedback.content[0]!.split("\n")[0], "That line is 540 bytes; the limit is 512. It must end where it is cut here:");

  const early: SummaryRequest[] = [];
  const fits = await open(t, { summarize: async (request) => { early.push(request); return early.length === 1 ? "x".repeat(600) : "short enough"; } });
  await fits.append("user", "z".repeat(600));
  await allBuilt(fits);
  assert.deepEqual([early.length, fits.tree.text(0, 0)], [2, "short enough"]);
});

test("a failed node retries until it succeeds, and only its first failure is reported", { timeout: 10_000 }, async (t) => {
  const timers: (() => void)[] = [];
  const fake: Timers = { set: (callback) => { timers.push(callback); return callback; }, clear: (handle) => { timers.splice(timers.indexOf(handle as () => void), 1); } };
  const outcomes = [new Error("provider down"), new Error("still down"), "   ", "back up"];
  let calls = 0;
  const reports: string[] = [];
  const memory = await open(t, {
    timers: fake, retryMs: 10_000, report: (problem, error) => reports.push(`${problem}: ${(error as Error).message}`),
    summarize: async () => { const outcome = outcomes[calls++]!; if (outcome instanceof Error) throw outcome; return outcome; },
  });
  await memory.append("user", "z".repeat(600));
  await until(memory, () => memory.status().failing !== undefined);
  const failing = memory.status().failing!;
  assert.deepEqual([failing.node, failing.error, calls, timers.length], ["0+1", "provider down", 1, 1]);
  assert.match(reports[0]!, /could not summarize 0\+1 .*: provider down/u);
  for (const expected of [2, 3]) {
    timers.shift()!();
    await until(memory, () => calls === expected && timers.length === 1);
    assert.deepEqual(memory.status().failing, failing, "the first failure stays reported");
  }
  assert.equal(reports.length, 1, "failures after the first are not reported again");
  timers.shift()!();
  await allBuilt(memory);
  assert.deepEqual([memory.tree.text(0, 0), memory.status().failing, timers.length], ["back up", undefined, 0]);
});

test("a due leaf retry is not displaced by a ready merge", { timeout: 10_000 }, async (t) => {
  const timers: (() => void)[] = [];
  const fake: Timers = { set: (callback) => { timers.push(callback); return callback; }, clear: (handle) => { timers.splice(timers.indexOf(handle as () => void), 1); } };
  const gate = gated();
  const memory = await open(t, { summarize: gate.summarize, node: 100, jobs: 1, timers: fake }, await backlog(t, 4, 2));
  await gate.call(1);
  assert.equal(leafIndex(gate.calls[0]!.request), 2);
  gate.calls[0]!.fail(new Error("provider down"));
  await until(memory, () => timers.length === 1 && memory.status().failing !== undefined);
  await gate.call(2);
  assert(merging(gate.calls[1]!.request), "a cooling leaf does not occupy the only job");
  timers.shift()!();
  assert.equal(gate.calls.length, 2, "a running merge is not interrupted");
  gate.calls[1]!.reply(summary("merge"));
  await gate.call(3);
  assert.equal(leafIndex(gate.calls[2]!.request), 2, "the due leaf keeps priority when the job becomes free");
  for (let k = 2; k < 6; k++) {
    await gate.call(k + 1);
    const request = gate.calls[k]!.request;
    gate.calls[k]!.reply(summary(leafIndex(request) ?? `merge-${k}`));
  }
  await allBuilt(memory);
  assert.equal(memory.status().failing, undefined);
});

test("persistent failures back off to five minutes and recover when the model does", { timeout: 10_000 }, async (t) => {
  const timers: { fire: () => void; ms: number }[] = [];
  const fake: Timers = {
    set: (fire, ms) => { const timer = { fire, ms }; timers.push(timer); return timer; },
    clear: (handle) => { const index = timers.indexOf(handle as typeof timers[number]); if (index !== -1) timers.splice(index, 1); },
  };
  let calls = 0;
  let healthy = false;
  const memory = await open(t, {
    timers: fake, retryMs: 10_000,
    summarize: async () => { calls++; if (!healthy) throw new Error("provider down"); return "recovered"; },
  });
  await memory.append("user", "z".repeat(600));
  for (const [index, delay] of [10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000].entries()) {
    await until(memory, () => calls === index + 1 && timers.length === 1);
    assert.equal(timers[0]!.ms, delay);
    if (index < 6) timers.shift()!.fire();
  }
  healthy = true;
  timers.shift()!.fire();
  await allBuilt(memory);
  assert.deepEqual([calls, memory.tree.text(0, 0), memory.status().failing], [8, "recovered", undefined]);
});

test("a model that ignores shutdown cannot report usage after the memory closes", { timeout: 10_000 }, async (t) => {
  let finish!: (reply: import("./compactor.ts").SummaryReply) => void;
  const memory = await open(t, {
    summarize: () => new Promise((resolve) => { finish = resolve; }),
  });
  await memory.append("user", "z".repeat(600));
  assert.equal(typeof finish, "function");
  await memory.close();
  finish({ text: "too late", usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: 1 } });
  await Promise.resolve();
  assert.equal(memory.status().usage.calls, 0, "late usage cannot recreate a closed or purged memory's file");
  assert.equal(memory.status().pending, 1);
});

test("a failed merge waits for its retry while leaves progress in the other job", { timeout: 10_000 }, async (t) => {
  const timers: (() => void)[] = [];
  const fake: Timers = { set: (callback) => { timers.push(callback); return callback; }, clear: (handle) => { timers.splice(timers.indexOf(handle as () => void), 1); } };
  const reports: string[] = [];
  const gate = gated();
  const memory = await open(t, {
    summarize: gate.summarize, node: 100, jobs: 2, timers: fake,
    report: (problem, error) => { if (error) reports.push(`${problem}: ${(error as Error).message}`); },
  }, await backlog(t, 5, 2));
  await gate.call(2);
  assert.deepEqual(gate.calls.map(({ request }) => leafIndex(request) ?? "merge"), [2, "merge"]);
  const mergeStep = blocks(gate.calls[1]!.request)[1];
  gate.calls[1]!.fail(new Error("provider down"));
  await until(memory, () => memory.status().failing !== undefined && timers.length === 1);
  const failing = memory.status().failing;
  gate.calls[0]!.reply(summary(2));
  await gate.call(3);
  assert.equal(leafIndex(gate.calls[2]!.request), 3, "a leaf uses the other slot, not the cooling-down merge");
  assert.equal(gate.calls.length, 3);

  timers.shift()!();
  await gate.call(4);
  assert.equal(blocks(gate.calls[3]!.request)[1], mergeStep, "the failed merge retries only after its timer");
  gate.calls[3]!.fail(new Error("still down"));
  await until(memory, () => timers.length === 1);
  assert.deepEqual(memory.status().failing, failing);
  assert.equal(reports.length, 1);
  gate.calls[2]!.reply(summary(3));
  await gate.call(5);
  assert.equal(leafIndex(gate.calls[4]!.request), 4);
  timers.shift()!();
  await gate.call(6);
  assert.equal(blocks(gate.calls[5]!.request)[1], mergeStep);
  gate.calls[5]!.reply(summary("retry"));
  // Three leaves and three merges, plus the two failed attempts.
  for (let k = 4; k < 8; k++) {
    await gate.call(k + 1);
    const request = gate.calls[k]!.request;
    if (k !== 5) gate.calls[k]!.reply(summary(leafIndex(request) ?? `merge-${k}`));
  }
  await allBuilt(memory);
  assert.equal(memory.status().failing, undefined);
  assert.equal(gate.peak(), 2);
});

test("each memory runs at most JOBS nodes, and a shared limiter bounds model calls across memories", { timeout: 10_000 }, async (t) => {
  // Eight summarized messages whose lines need a model call to merge: four merges are ready at once.
  async function seeded(): Promise<string> {
    const dir = await directory(t);
    const { store } = await Store.open(dir, { now: () => new Date(), report: assert.fail });
    for (let i = 0; i < 8; i++) {
      const text = `M${i} ${"y".repeat(90)}`;
      await store.appendMessage({ i, kind: "user", text, size: Buffer.byteLength(`user: ${text}`), date: new Date().toISOString() });
      await store.appendNode({ l: 0, i, text: `S${i}`.padEnd(60, "-"), size: 60 });
    }
    await store.close();
    return dir;
  }
  const local = gated();
  const memory = await open(t, { summarize: local.summarize, node: 100, jobs: 2 }, await seeded());
  await local.call(2);
  assert.deepEqual([local.calls.length, local.running()], [2, 2], "JOBS caps one memory");
  for (let k = 0; k < 4; k++) {
    await local.call(Math.min(k + 2, 4));
    assert(local.running() <= 2, String(local.running()));
    local.calls[k]!.reply("MERGED");
  }
  await allBuilt(memory);
  assert.deepEqual([local.calls.length, local.peak()], [4, 2], "four model merges; the levels above fit for free");

  const shared = gated();
  const limiter = createLimiter(1);
  const first = await open(t, { summarize: shared.summarize, node: 100, jobs: 4, limiter }, await seeded());
  const second = await open(t, { summarize: shared.summarize, node: 100, jobs: 4, limiter }, await seeded());
  for (let count = 1; count <= 8; count++) {
    await shared.call(count);
    assert.equal(shared.running(), 1, "one call at a time across both memories");
    shared.calls[count - 1]!.reply("MERGED");
  }
  await Promise.all([until(first, () => first.status().pending === 0), until(second, () => second.status().pending === 0)]);
  assert.equal(shared.peak(), 1);
});
