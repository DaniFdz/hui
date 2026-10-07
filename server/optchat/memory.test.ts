import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { Summarize } from "./compactor.ts";
import { OptChatMemory, type OptChatOptions } from "./memory.ts";
import { localDateTime } from "./text.ts";
import { PLACEHOLDER } from "./tree.ts";

async function directory(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hui-optchat-memory-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function open(t: TestContext, dir: string, options: Partial<OptChatOptions> = {}): Promise<OptChatMemory> {
  const memory = await OptChatMemory.open(dir, { name: "Grok", summarize: refuse, ...options });
  t.after(() => memory.close());
  return memory;
}

function until(memory: OptChatMemory, done: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (done()) { resolve(); return; }
    const off = memory.onChange(() => { if (done()) { off(); resolve(); } });
  });
}

const refuse: Summarize = async () => { throw new Error("no model call expected"); };
/** A deterministic 32-byte line for any request. */
const digest: Summarize = async (request) => `summary ${createHash("sha256").update(JSON.stringify(request.messages)).digest("hex").slice(0, 24)}`;
const never: Summarize = (_request, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));

test("a tool result keeps CAP characters, head and tail; other messages stay whole", { timeout: 10_000 }, async (t) => {
  const memory = await open(t, await directory(t), { cap: 100 });
  const long = `HEAD${"x".repeat(1_000)}TAIL`;
  assert.equal(await memory.append("echo", long), 0);
  assert.equal(await memory.append("user", long), 1);
  const echo = memory.message(0)!;
  assert(echo.text.length <= 100 && echo.text.startsWith("HEAD") && echo.text.endsWith("TAIL"), echo.text);
  assert.match(echo.text, /\n\[\d+ characters cut\]\n/u);
  assert.equal(echo.size, Buffer.byteLength(`echo: ${echo.text}`));
  assert.equal(memory.message(1)!.text, long);
});

test("zoom and date answer in the spec's formats, and refuse lines that do not exist", { timeout: 10_000 }, async (t) => {
  let now = new Date(2026, 9, 5, 19, 9, 33);
  const memory = await open(t, await directory(t), { now: () => now });
  await memory.append("user", "first line\nsecond line", { entry: 3, part: 0 });
  now = new Date(2026, 9, 5, 19, 10, 0);
  for (const [kind, text] of [["talk", "done"], ["tool", "read {\"path\":\"a\"}"], ["echo", "a\nb"]] as const) await memory.append(kind, text);
  await until(memory, () => memory.status().pending === 0);
  assert.equal(memory.zoom(0, 1), "0+0|user: first line\nsecond line", "a message whole, newlines kept");
  assert.equal(memory.zoom(0, 2), "0+1|user: first line second line\n1+1|talk: done", "the two lines under it, one per line");
  assert.equal(memory.zoom(0, 4), `0+2|user: first line second line talk: done\n2+2|tool: read {"path":"a"} echo: a b`);
  for (const [id, n] of [[1, 2], [0, 3], [0, 8], [4, 1], [-1, 1], [2, 0]] as const) assert.equal(memory.zoom(id, n), `No line ${id}+${n}.`);
  assert.equal(memory.date(0), localDateTime(new Date(2026, 9, 5, 19, 9, 33)));
  assert.equal(memory.date(3), localDateTime(new Date(2026, 9, 5, 19, 10, 0)));
  assert.deepEqual([memory.date(4), memory.date(-1), memory.date(1.5)], ["No message 4.", "No message -1.", "No message 1.5."]);
  assert.deepEqual(memory.message(0)!.src, { entry: 3, part: 0 });

  const pending = await open(t, await directory(t), { summarize: never, node: 16 });
  await pending.append("user", "far too long for sixteen bytes");
  await pending.append("talk", "also too long for it");
  assert.equal(pending.zoom(0, 2), `0+1|${PLACEHOLDER}\n1+1|${PLACEHOLDER}`, "lines not summarized yet say so");
});

// The view is not saved: open folds it again from message 0. When the compactor kept up (every node built before the
// next message) the fold repeats the live one. A line shorter than the placeholder it replaced can leave the live view
// one merge coarser than the fold (an unbuilt part counts its placeholder, spec 5.2), so these lines are not shorter.
test("reopening refolds the view the live fold built while the compactor kept up", { timeout: 20_000 }, async (t) => {
  const dir = await directory(t);
  const memory = await OptChatMemory.open(dir, { name: "Grok", summarize: digest, node: 40, view: 160 });
  const views: string[] = [];
  for (let i = 0; i < 40; i++) {
    const text = i % 3 === 0 ? `message ${i} ${"long ".repeat(12)}` : `a short message, number ${i}`;
    await memory.append(i % 2 ? "talk" : "user", text);
    await until(memory, () => memory.status().pending === 0);
    views.push(memory.view());
  }
  const parts = memory.parts();
  assert(memory.status().viewBytes <= 160, "under budget once its parents were built");
  assert(parts.some(([l]) => l >= 3), "old lines cover many messages");
  assert.deepEqual(parts.at(-1), [0, 39], "recent lines one message each");
  await memory.close();
  const reopened = await open(t, dir, { summarize: refuse, node: 40, view: 160 });
  assert.deepEqual(reopened.parts(), parts);
  assert.equal(reopened.view(), views.at(-1));
  assert.deepEqual(reopened.status(), { messages: 40, built: reopened.status().built, pending: 0, viewBytes: reopened.status().viewBytes, viewLines: parts.length, usage: { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } });
});

test("status says when a turn waits for summaries, and closing ends the wait", { timeout: 10_000 }, async (t) => {
  let release!: (text: string) => void;
  const gate: Summarize = () => new Promise((resolve) => { release = resolve; });
  const memory = await open(t, await directory(t), { summarize: gate, node: 16 });
  const changes: string[] = [];
  memory.onChange(() => changes.push(JSON.stringify(memory.status().waiting ?? false)));
  await memory.append("user", "far too long for sixteen bytes");
  await memory.append("user", "ok");
  const settled = memory.settle(2);
  assert.equal(memory.status().waiting, true);
  assert.equal(memory.settled(2), false);
  release("short");
  assert.equal(await settled, true);
  assert.equal(memory.status().waiting, undefined);
  assert(changes.includes("true") && changes.at(-1) === "false", changes.join(","));
  await memory.append("user", "another one too long");
  const late = memory.settle(3);
  await memory.close();
  assert.equal(await late, false);
  await assert.rejects(() => memory.append("user", "after close"), /closed/u);
});

test("the browse page shows the view, every message and each level, escaped", { timeout: 10_000 }, async (t) => {
  const memory = await open(t, await directory(t));
  await memory.append("user", "<script>alert('x')</script> & more");
  await memory.append("talk", "ok");
  await until(memory, () => memory.status().pending === 0);
  const page = memory.html();
  assert(page.startsWith("<!doctype html>"));
  assert(!page.includes("<script>"), "nothing from the log is markup");
  assert(page.includes("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; more"));
  for (const heading of ["View · 2 lines", "ROOT · 2 messages", "Level 0 · 2 nodes", "Level 1 · 1 nodes"]) assert(page.includes(heading), heading);
  assert(page.includes("<b>0+2</b>") || page.includes("<b>0+1</b>"));
});
