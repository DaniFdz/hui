/**
 * The worker's loopback trigger hook endpoint: what a listener on that machine gets back for its report (the gateway's
 * own decision, relayed), and what waits in the queue while no gateway can take it. Real HTTP against a loopback port,
 * a fake relay standing in for the gateway, and temp directories.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { connect } from "node:net";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";
import { BOT_TRIGGER_LIMITS } from "../bots/triggers-format.ts";
import { HookBodyError, parseHookBody } from "../bots/triggers-listener.ts";
import { waitFor } from "../test-support/wait-for.ts";
import { HOOK_QUEUE_LIMIT, HookRelayUnavailable, WorkerHookEndpoint, type HookAnswer } from "./hook-endpoint.ts";

/** A token shaped like `newHookToken`'s: base64url, 43 characters, and the only thing that identifies the trigger here. */
const TOKEN = "trigger-token-Q3f8a1c0b5d7e2a4f6b8c9d0e1";
const OTHER_TOKEN = "other-token-Z9y8x7w6v5u4t3s2r1q0p9o8n7m";

type Relay = (token: string, body: string) => Promise<HookAnswer>;

async function post(url: string, body: string, type = "application/json", method = "POST") {
  const response = await fetch(url, { method, headers: { "content-type": type }, ...(method === "POST" ? { body } : {}) });
  return { status: response.status, headers: response.headers, body: await response.json() as Record<string, unknown> };
}

/** The gateway's own decision path, as the fake relay stands in for it: its trigger refusals, and a 400 for a body that
 * is not the JSON it claims (the same `parseHookBody` the gateway's relay uses). */
function gateway(decide: (token: string, body: unknown) => HookAnswer | Promise<HookAnswer>): Relay {
  return async (token, body) => {
    let parsed: unknown;
    try {
      parsed = parseHookBody(body);
    } catch (error) {
      if (error instanceof HookBodyError) return { status: error.status, body: { error: error.message } };
      throw error;
    }
    return decide(token, parsed);
  };
}

async function endpoint(t: TestContext, relay: Relay, options: {
  port?: number;
  canRelay?: () => boolean;
  retryMs?: number;
  pause?: (point: "admitting" | "publishing" | "listed", listing: readonly string[]) => Promise<void> | void;
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "hui-hook-endpoint-"));
  let activity = 0;
  const ep = new WorkerHookEndpoint({
    dir, port: options.port ?? 0, relay, onActivity: () => { activity += 1; },
    ...(options.canRelay ? { canRelay: options.canRelay } : {}),
    ...(options.retryMs === undefined ? {} : { retryMs: options.retryMs }),
    ...(options.pause ? { pause: options.pause } : {}),
  });
  await ep.listen();
  t.onTestFinished(async () => {
    await ep.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  return { ep, dir, url: ep.url!, activity: () => activity };
}

const names = (dir: string): Promise<string[]> => readdir(dir).catch(() => [] as string[]);

test("a report is relayed as it came, and the gateway's decision is the listener's answer", async (t) => {
  const seen: Array<{ token: string; body: string }> = [];
  const { dir, url, activity } = await endpoint(t, async (token, body) => {
    seen.push({ token, body });
    return { status: 202, body: { status: "fired" } };
  });
  const report = JSON.stringify({ events: [{ id: "e1", summary: "it happened" }] });
  const answer = await post(`${url}/__hui/hooks/${TOKEN}`, report);
  assert.deepEqual([answer.status, answer.body], [202, { status: "fired" }]);
  assert.equal(answer.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(answer.headers.get("cache-control"), "no-store");
  assert.deepEqual(seen, [{ token: TOKEN, body: report }], "the body is relayed byte for byte, unparsed here");
  assert.deepEqual(await names(dir), [], "an answer is returned, never queued");
  assert.equal(activity(), 2, "the report's start and its end");
});

test("a refusal the gateway decided reaches the listener unchanged", async (t) => {
  const decision: HookAnswer = { status: 409, body: { error: "This trigger is off: turn it on in the bot's panel." } };
  const { dir, url } = await endpoint(t, async () => decision);
  const answer = await post(`${url}/__hui/hooks/${TOKEN}`, "{}");
  assert.deepEqual([answer.status, answer.body], [decision.status, decision.body]);
  assert.deepEqual(await names(dir), []);
});

test("only a trigger's URL answers a POST: another path or a malformed token is a 404, another method a 405", async (t) => {
  const calls: string[] = [];
  const { dir, url } = await endpoint(t, async (token) => {
    calls.push(token);
    return { status: 202, body: { status: "ignored" } };
  });
  assert.deepEqual(await post(`${url}/__hui/hooks/${TOKEN}`, "{}", "application/json", "GET").then(({ status, body }) => [status, body]),
    [405, { error: "method not allowed" }]);
  assert.deepEqual(await post(`${url}/__hui/other`, "{}").then(({ status, body }) => [status, body]),
    [404, { error: "No trigger has this URL." }], "a path no listener reports to");
  assert.deepEqual(await post(`${url}/__hui/hooks/short`, "{}").then(({ status, body }) => [status, body]),
    [404, { error: "No trigger has this URL." }], "a token that is not one");
  assert.deepEqual(calls, [], "nothing is relayed for a request that is not a report");
  assert.deepEqual(await names(dir), []);
});

test("a body over 64 KiB or not JSON is refused here, as the route refuses it", async (t) => {
  const calls: unknown[] = [];
  const { dir, url } = await endpoint(t, gateway((token, body) => {
    calls.push({ token, body });
    return { status: 202, body: { status: "ignored" } };
  }));
  const large = JSON.stringify({ events: [], blob: "x".repeat(BOT_TRIGGER_LIMITS.body) });
  const tooBig = await post(`${url}/__hui/hooks/${TOKEN}`, large);
  assert.deepEqual([tooBig.status, tooBig.body], [413, { error: `The body is larger than ${BOT_TRIGGER_LIMITS.body / 1024} KiB.` }]);
  const plain = await post(`${url}/__hui/hooks/${TOKEN}`, "a report", "text/plain");
  assert.equal(plain.status, 400);
  assert.match(String(plain.body["error"]), /A listener reports JSON/u);
  const malformed = await post(`${url}/__hui/hooks/${TOKEN}`, "{not json");
  assert.deepEqual([malformed.status, malformed.body], [400, { error: "The body says it is JSON but isn't." }]);
  assert.deepEqual(calls, [], "a body refused before the relay never reaches a gateway");
  assert.deepEqual(await names(dir), []);
});

test("with no gateway the report waits: 202 queued, one private file per report, never named after the token", async (t) => {
  const { dir, url } = await endpoint(t, async () => { throw new HookRelayUnavailable("no gateway attached"); });
  const report = JSON.stringify({ events: [{ id: "waited", summary: "while HUI was away" }] });
  const answer = await post(`${url}/__hui/hooks/${TOKEN}`, report);
  assert.deepEqual([answer.status, answer.body], [202, { status: "queued" }]);
  const queued = await names(dir);
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.includes(TOKEN), false, "the file's name never carries the trigger's token");
  assert.match(queued[0]!, /^\d{9}-[0-9a-f-]{36}\.json$/u);
  assert.equal((await stat(dir)).mode & 0o777, 0o700, "the queue directory is this user's alone");
  assert.equal((await stat(join(dir, queued[0]!))).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(join(dir, queued[0]!), "utf8")), { token: TOKEN, body: report });
});

test(`${HOOK_QUEUE_LIMIT} waiting reports fill the queue: the next listener is asked to report again later`, async (t) => {
  const { dir, url } = await endpoint(t, async () => { throw new HookRelayUnavailable("no gateway attached"); });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await Promise.all(Array.from({ length: HOOK_QUEUE_LIMIT }, (_, index) => writeFile(
    join(dir, `${String(index + 1).padStart(9, "0")}-${randomUUID()}.json`),
    JSON.stringify({ token: OTHER_TOKEN, body: "{}" }),
    { mode: 0o600 },
  )));
  const answer = await post(`${url}/__hui/hooks/${TOKEN}`, "{}");
  assert.equal(answer.status, 503);
  const error = String(answer.body["error"]);
  assert.match(error, new RegExp(`${HOOK_QUEUE_LIMIT} reports`, "u"), "the listener is told what is wrong");
  assert.equal(error.includes(TOKEN), false, "and nothing of any token");
  assert.equal((await names(dir)).length, HOOK_QUEUE_LIMIT, "the report that does not fit is not kept");
});

test("the endpoint binds loopback only: this machine's own addresses are refused", async (t) => {
  const { ep } = await endpoint(t, async () => ({ status: 202, body: { status: "ignored" } }));
  assert.match(ep.url!, /^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.equal(ep.address, "127.0.0.1", "the socket is bound to loopback, not to whatever this machine has");
  const port = ep.port!;
  assert.equal(port > 0, true, "an ephemeral bind still answers with the port it bound");
  // 127.0.0.1 takes the connection.
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port }, () => { socket.destroy(); resolve(); });
    socket.once("error", reject);
  });
  const other = Object.values(networkInterfaces()).flat().find((address) => address?.family === "IPv4" && !address.internal)?.address;
  assert.ok(other, "this machine has no non-loopback IPv4 address to prove the endpoint is loopback-only with");
  // Any other address of this machine is not listening: the endpoint never bound it.
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: other, port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`Connecting to ${other}:${port} neither failed nor connected.`)); }, 5_000);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); reject(new Error(`The hook endpoint answered on ${other}:${port}, which is not loopback.`)); });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === "ECONNREFUSED") resolve();
      else reject(error);
    });
  });
});

test("what waited goes in order, one report at a time, and each file goes once the gateway answered", async (t) => {
  let reachable = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const relayed: string[] = [];
  let active = 0;
  let most = 0;
  const { ep, dir, url } = await endpoint(t, async (_token, body) => {
    if (!reachable) throw new HookRelayUnavailable("no gateway attached");
    active += 1;
    most = Math.max(most, active);
    try {
      relayed.push(body);
      // The first report is held so a second relay, if there were one, would overlap it.
      if (relayed.length === 1) await held;
      return { status: 202, body: { status: "fired" } };
    } finally {
      active -= 1;
    }
  });
  const reports = ["first", "second", "third"].map((text) => JSON.stringify({ events: [{ id: text, summary: text }] }));
  for (const report of reports) assert.deepEqual((await post(`${url}/__hui/hooks/${TOKEN}`, report)).body, { status: "queued" });
  assert.equal((await names(dir)).length, 3);
  reachable = true;
  ep.drain();
  await waitFor("the first queued report to start relaying", () => relayed.length === 1);
  assert.equal((await names(dir)).length, 3, "nothing is removed before its answer, and the queue waits its turn");
  release();
  await waitFor("the queue to drain", async () => (await names(dir)).length === 0);
  assert.deepEqual(relayed, reports, "the order they came in");
  assert.equal(most, 1, "one relay at a time");
});

test("40 reports posted while a drain runs are kept whole, relayed once each, and leave no temporary name behind", async (t) => {
  let attached = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  const relayed: string[] = [];
  const { ep, dir, url } = await endpoint(t, async (_token, body) => {
    if (!attached) throw new HookRelayUnavailable("no gateway attached");
    // Held until every listener below has been answered: the seed stays in flight while the 40 reports are written.
    if (!started) { started = true; await held; }
    relayed.push(body);
    return { status: 202, body: { status: "fired" } };
  });
  const seed = JSON.stringify({ events: [{ id: "seed", summary: "seed" }] });
  const reports = Array.from({ length: 40 }, (_, index) => JSON.stringify({ events: [{ id: `burst-${index}`, summary: `burst ${index}` }] }));
  try {
    assert.deepEqual((await post(`${url}/__hui/hooks/${TOKEN}`, seed)).body, { status: "queued" }, "the report the drain is busy with");
    attached = true;
    ep.drain();
    await waitFor("the drain to reach the seed", () => started || undefined);

    const answers = await Promise.all(reports.map((report) => post(`${url}/__hui/hooks/${TOKEN}`, report)));
    assert.deepEqual(answers.map((answer) => answer.body), reports.map(() => ({ status: "queued" })), "each one waits its turn instead of overtaking the drain");
    const waiting = await names(dir);
    assert.equal(waiting.length, 41, "the seed and every report are on disk, whole");
    assert.deepEqual(waiting.filter((name) => !/^\d{9}-[0-9a-f-]{36}\.json$/u.test(name)), [], "only final names wait, never a report still being written");
    release();
    await waitFor("the queue to drain", async () => (await names(dir)).length === 0);
    assert.deepEqual(relayed, [seed, ...reports], "the seed first, then every report exactly once, in the order they were posted");
  } finally {
    // A failing assertion still lets the held relay go: close() waits for the one in flight.
    release();
  }
});

test("a report posted while older ones drain waits behind them: the queue goes out in the order it came in", async (t) => {
  let reachable = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let holding = false;
  const bodies: string[] = [];
  const { ep, dir, url } = await endpoint(t, async (_token, body) => {
    if (!reachable) throw new HookRelayUnavailable("no gateway attached");
    bodies.push(body);
    // The first report is held, so the third arrives while the other two still wait.
    if (bodies.length === 1) { holding = true; await held; }
    return { status: 202, body: { status: "fired" } };
  });
  const reports = ["one", "two", "three"].map((text) => JSON.stringify({ events: [{ id: text, summary: text }] }));
  try {
    for (const report of reports.slice(0, 2)) assert.deepEqual((await post(`${url}/__hui/hooks/${TOKEN}`, report)).body, { status: "queued" });
    reachable = true;
    ep.drain();
    await waitFor("the first queued report to start relaying", () => holding || undefined);
    assert.deepEqual((await post(`${url}/__hui/hooks/${TOKEN}`, reports[2]!)).body, { status: "queued" }, "it waits instead of reaching the gateway past the queue");
    assert.deepEqual(bodies, [reports[0]], "only the report the drain had already reached was offered");
    release();
    await waitFor("the queue to drain", async () => (await names(dir)).length === 0);
    assert.deepEqual(bodies, reports, "oldest first, the report posted during the drain last");
  } finally {
    release();
  }
});

test("a report that lands while a drain has already listed an empty queue is relayed without another drain", async (t) => {
  let attached = false;
  let takeSecond = false;
  let standing = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const relayed: string[] = [];
  const reports = ["first", "second"].map((text) => JSON.stringify({ events: [{ id: text, summary: text }] }));
  const { ep, dir, url } = await endpoint(t, async (_token, body) => {
    if (!attached) throw new HookRelayUnavailable("no gateway attached");
    // The one offer the second report gets as it is posted is not answered: it waits in line, behind the pass already
    // running, and that pass is what has to send it when it ends.
    if (body === reports[1] && !takeSecond) throw new HookRelayUnavailable("No HUI answered the report.");
    relayed.push(body);
    return { status: 202, body: { status: "fired" } };
  }, {
    canRelay: () => attached,
    pause: async (point, listing) => {
      // The drain has read an empty queue and has not acted on the listing yet: the second report is published here.
      if (point !== "listed" || listing.length > 0 || standing) return;
      standing = true;
      await held;
    },
  });
  try {
    assert.deepEqual((await post(`${url}/__hui/hooks/${TOKEN}`, reports[0]!)).body, { status: "queued" }, "no gateway took the first report");
    attached = true;
    ep.drain();
    await waitFor("the drain to stand on an empty listing", () => standing || undefined);
    assert.deepEqual((await post(`${url}/__hui/hooks/${TOKEN}`, reports[1]!)).body, { status: "queued" }, "it waits its turn");
    assert.deepEqual(relayed, [reports[0]], "the pass that was running sent only what it had listed");
    takeSecond = true;
  } finally {
    release();
  }
  await waitFor("the queue to drain", async () => (await names(dir)).length === 0);
  assert.deepEqual(relayed, reports, "the pass the queued report asked for sent it, behind the one already relayed");
});

test("a report that arrives while an older one is still being written queues behind it instead of relaying first", async (t) => {
  let failures = 1;
  let admitting = 0;
  let standing = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const relayed: string[] = [];
  const reports = ["older", "newer"].map((text) => JSON.stringify({ events: [{ id: text, summary: text }] }));
  const { dir, url } = await endpoint(t, async (_token, body) => {
    // The gateway answers neither report as it is posted: the older one waits in line, and the newer one must wait
    // behind it instead of reaching the gateway while the older one is only half in line.
    if (failures > 0) { failures -= 1; throw new HookRelayUnavailable("No HUI answered the report."); }
    relayed.push(body);
    return { status: 202, body: { status: "fired" } };
  }, {
    canRelay: () => true,
    pause: async (point) => {
      if (point === "admitting") { admitting += 1; return; }
      // The older report is whole under its temporary name and not yet renamed into its place in line.
      if (point !== "publishing" || standing) return;
      standing = true;
      await held;
    },
  });
  try {
    const older = post(`${url}/__hui/hooks/${TOKEN}`, reports[0]!);
    await waitFor("the older report to be written under its temporary name", () => standing || undefined);
    const newer = post(`${url}/__hui/hooks/${TOKEN}`, reports[1]!);
    // The newer report reads the queue while the older one is still being written: that is the report it must count.
    await waitFor("the newer report to read the queue", () => admitting === 2 || undefined);
    release();
    assert.deepEqual((await newer).body, { status: "queued" }, "the newer report waits in line behind the older one");
    assert.deepEqual((await older).body, { status: "queued" }, "the older report is in line behind nothing");
  } finally {
    release();
  }
  await waitFor("the queue to drain", async () => (await names(dir)).length === 0);
  assert.deepEqual(relayed, reports, "oldest first, as they came in");
});

test("a drain asked for again while it runs gets another pass when it ends, even when the one it was asked for failed", async (t) => {
  let reachable = false;
  let failFirst: (() => void) | undefined;
  let started = false;
  const attempts: string[] = [];
  const delivered: string[] = [];
  const { ep, dir, url } = await endpoint(t, async (_token, body) => {
    if (!reachable) throw new HookRelayUnavailable("no gateway attached");
    attempts.push(body);
    if (attempts.length === 1) {
      started = true;
      // Held until the test asks for a second pass, then failed: only that request can deliver the queue.
      await new Promise<never>((_resolve, reject) => { failFirst = () => reject(new HookRelayUnavailable("the gateway went away")); });
    }
    delivered.push(body);
    return { status: 202, body: { status: "fired" } };
  });
  const reports = ["one", "two"].map((text) => JSON.stringify({ events: [{ id: text, summary: text }] }));
  try {
    for (const report of reports) await post(`${url}/__hui/hooks/${TOKEN}`, report);
    reachable = true;
    ep.drain();
    await waitFor("the drain to reach the first report", () => started || undefined);
    ep.drain();
    failFirst!();
    await waitFor("the second pass to deliver what waited", async () => (await names(dir)).length === 0);
    assert.deepEqual(delivered, reports, "in order, from the pass the second request asked for");
    assert.equal(attempts.length, 3, "the failed one, then the two reports");
  } finally {
    failFirst?.();
  }
});

test("a drain a failed link stopped offers its report again after retryMs, without another drain", async (t) => {
  let attached = false;
  let failNext = false;
  const attempts: string[] = [];
  const delivered: string[] = [];
  const { ep, dir, url } = await endpoint(t, async (_token, body) => {
    if (!attached) throw new HookRelayUnavailable("no gateway attached");
    attempts.push(body);
    // A link that failed once and answers the next time: the report goes without anything asking again.
    if (failNext) { failNext = false; throw new HookRelayUnavailable("the link failed"); }
    delivered.push(body);
    return { status: 202, body: { status: "fired" } };
  }, { canRelay: () => attached, retryMs: 10 });
  const report = JSON.stringify({ events: [{ id: "retried", summary: "retried" }] });
  assert.deepEqual((await post(`${url}/__hui/hooks/${TOKEN}`, report)).body, { status: "queued" }, "with no gateway attached nothing is retried yet");
  attached = true;
  failNext = true;
  ep.drain();
  assert.equal(await waitFor("the retry to deliver the report", () => delivered[0], { timeoutMs: 5_000 }), report);
  await waitFor("the queue to empty", async () => (await names(dir)).length === 0);
  assert.deepEqual(attempts, [report, report], "the failed offer and the retry");
});

test("a gateway too old for the relay is not retried: its report waits for one that can take it", async (t) => {
  let attached = false;
  let asked = 0;
  let attempts = 0;
  const { ep, dir, url } = await endpoint(t, async () => {
    if (!attached) throw new HookRelayUnavailable("no gateway attached");
    attempts += 1;
    // An older gateway refuses the relay itself: the next offer would be refused the same way.
    throw new HookRelayUnavailable("The connected HUI serves no trigger relay.", { retry: false });
  }, { canRelay: () => { asked += 1; return attached; }, retryMs: 10 });
  const report = JSON.stringify({ events: [{ id: "old", summary: "old" }] });
  assert.deepEqual((await post(`${url}/__hui/hooks/${TOKEN}`, report)).body, { status: "queued" });
  assert.equal(asked, 1, "the queue asked whether a gateway is attached, and none was");
  attached = true;
  ep.drain();
  await waitFor("the drain to stop at the older gateway", () => attempts === 1 && !ep.busy ? true : undefined);
  assert.equal(asked, 1, "a refusal an older gateway gives is not a reason to retry, so no retry was scheduled");
  assert.equal((await names(dir)).length, 1, "the report waits for a gateway that can serve it");
});

test("close() waits for the relay in flight and leaves the rest of the queue on disk", async (t) => {
  let reachable = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  const relayed: string[] = [];
  const { ep, dir, url } = await endpoint(t, async (_token, body) => {
    if (!reachable) throw new HookRelayUnavailable("no gateway attached");
    relayed.push(body);
    if (relayed.length === 1) { started = true; await held; }
    return { status: 202, body: { status: "fired" } };
  });
  const reports = ["one", "two"].map((text) => JSON.stringify({ events: [{ id: text, summary: text }] }));
  try {
    for (const report of reports) await post(`${url}/__hui/hooks/${TOKEN}`, report);
    reachable = true;
    ep.drain();
    await waitFor("the first queued report to start relaying", () => started || undefined);
    const closing = ep.close();
    release();
    await closing;
    assert.deepEqual(relayed, [reports[0]], "the relay in flight finished; the loop did not go on");
    const left = await names(dir);
    assert.equal(left.length, 1, "what still waited is on disk for the next host");
    assert.deepEqual(JSON.parse(await readFile(join(dir, left[0]!), "utf8")), { token: TOKEN, body: reports[1] }, "the report behind it");
  } finally {
    release();
  }
});

test("close() between a drain's reads and its relay leaves the report on disk and sends nothing", async (t) => {
  let attached = false;
  const relayed: string[] = [];
  const { ep, dir, url } = await endpoint(t, async (_token, body) => {
    if (!attached) throw new HookRelayUnavailable("no gateway attached");
    relayed.push(body);
    return { status: 202, body: { status: "fired" } };
  }, { canRelay: () => attached });
  const report = JSON.stringify({ events: [{ id: "kept", summary: "kept" }] });
  assert.deepEqual((await post(`${url}/__hui/hooks/${TOKEN}`, report)).body, { status: "queued" });
  attached = true;
  // The drain's listing and read are still in flight when close() starts: nothing of this report was in flight.
  ep.drain();
  await ep.close();
  assert.deepEqual(relayed, [], "a relay that was not in flight is never started");
  const left = await names(dir);
  assert.equal(left.length, 1, "the report it had already read stays for the next host");
  assert.deepEqual(JSON.parse(await readFile(join(dir, left[0]!), "utf8")), { token: TOKEN, body: report });
});

test("a queued report the gateway refuses (404, 409, 400) is dropped, not retried forever", async (t) => {
  const answers: HookAnswer[] = [{ status: 404, body: { error: "No trigger has this URL." } }, { status: 409, body: { error: "This trigger is off." } }, { status: 400, body: { error: "A report is { events: [...] }." } }];
  let reachable = false;
  let index = 0;
  const { ep, dir, url } = await endpoint(t, async () => {
    if (!reachable) throw new HookRelayUnavailable("no gateway attached");
    return answers[index++]!;
  });
  for (const text of ["a", "b", "c"]) await post(`${url}/__hui/hooks/${TOKEN}`, JSON.stringify({ events: [{ id: text, summary: text }] }));
  assert.equal((await names(dir)).length, 3);
  reachable = true;
  ep.drain();
  await waitFor("the refused reports to be dropped", async () => (await names(dir)).length === 0);
  assert.equal(index, 3);
});

test("a transport failure keeps the report it could not send - and the rest behind it - for the next drain", async (t) => {
  let reachable = false;
  let failOn = -1;
  const relayed: string[] = [];
  const { ep, dir, url } = await endpoint(t, async (_token, body) => {
    if (!reachable || relayed.length === failOn) throw new HookRelayUnavailable("the gateway went away");
    relayed.push(body);
    return { status: 202, body: { status: "fired" } };
  });
  const reports = ["one", "two", "three"].map((text) => JSON.stringify({ events: [{ id: text, summary: text }] }));
  for (const report of reports) await post(`${url}/__hui/hooks/${TOKEN}`, report);
  reachable = true;
  failOn = 1;
  ep.drain();
  await waitFor("the drain to stop at the failure", async () => relayed.length === 1 && !ep.busy);
  assert.equal((await names(dir)).length, 2, "the report that failed and the one behind it still wait");
  failOn = -1;
  ep.drain();
  await waitFor("the rest to go", async () => (await names(dir)).length === 0);
  assert.deepEqual(relayed, reports);
});

test("a 5xx from the gateway keeps the queued report - and the rest behind it - for the next drain", async (t) => {
  let reachable = false;
  let deciding = false;
  const attempts: string[] = [];
  const { ep, dir, url } = await endpoint(t, async (_token, body) => {
    if (!reachable) throw new HookRelayUnavailable("no gateway attached");
    attempts.push(body);
    // The gateway answered but could not decide: nothing about the report is settled.
    return deciding ? { status: 202, body: { status: "fired" } } : { status: 500, body: { error: "The gateway could not read its own state." } };
  });
  const reports = ["one", "two"].map((text) => JSON.stringify({ events: [{ id: text, summary: text }] }));
  for (const report of reports) assert.deepEqual((await post(`${url}/__hui/hooks/${TOKEN}`, report)).body, { status: "queued" });
  const queued = await names(dir);
  assert.equal(queued.length, 2);
  reachable = true;
  ep.drain();
  await waitFor("the drain to stop at the 5xx", async () => attempts.length >= 1 && !ep.busy);
  assert.equal(attempts.length, 1, "the drain stops at the report the gateway answered 500 for");
  assert.deepEqual((await names(dir)).sort(), [...queued].sort(), "the report the gateway could not decide, and the one behind it, still wait");
  deciding = true;
  ep.drain();
  await waitFor("the queue to drain", async () => (await names(dir)).length === 0);
  assert.deepEqual(attempts, [reports[0]!, ...reports], "the kept report is offered again, then the one behind it");
});

test("a 5xx from the gateway is offered again after retryMs by itself, without another drain", async (t) => {
  let attached = false;
  let failures = 1;
  const attempts: string[] = [];
  const delivered: string[] = [];
  const { ep, dir, url } = await endpoint(t, async (_token, body) => {
    if (!attached) throw new HookRelayUnavailable("no gateway attached");
    attempts.push(body);
    // The gateway could not read its own state the first time and decided the next: the retry delivers the report.
    if (failures > 0) { failures -= 1; return { status: 500, body: { error: "The gateway could not read its own state." } }; }
    delivered.push(body);
    return { status: 202, body: { status: "fired" } };
  }, { canRelay: () => attached, retryMs: 10 });
  const report = JSON.stringify({ events: [{ id: "answered-500", summary: "answered 500" }] });
  assert.deepEqual((await post(`${url}/__hui/hooks/${TOKEN}`, report)).body, { status: "queued" });
  attached = true;
  ep.drain();
  assert.equal(await waitFor("the retry to deliver the report", () => delivered[0], { timeoutMs: 5_000 }), report);
  await waitFor("the queue to empty", async () => (await names(dir)).length === 0);
  assert.deepEqual(attempts, [report, report], "the answer of 500, then the offer the retry made");
});

test("no log line carries a trigger's token, a report's body, or a queued report's", async (t) => {
  const lines: string[] = [];
  const { log, error } = console;
  console.log = (...args: unknown[]) => { lines.push(args.map((value) => String(value)).join(" ")); };
  console.error = (...args: unknown[]) => { lines.push(args.map((value) => String(value)).join(" ")); };
  t.onTestFinished(() => { console.log = log; console.error = error; });

  let reachable = false;
  const { url } = await endpoint(t, async (_token, _body) => {
    if (!reachable) throw new HookRelayUnavailable("no gateway attached");
    return { status: 202, body: { status: "fired" } };
  });
  const report = JSON.stringify({ events: [{ id: "secret-free", summary: "BODY_MARKER reported it" }] });
  assert.equal((await post(`${url}/__hui/hooks/${TOKEN}`, report)).status, 202, "queued");
  reachable = true;
  // A relayed report too, and a port that cannot be bound.
  const second = await endpoint(t, async () => ({ status: 202, body: { status: "ignored" } }));
  assert.equal((await post(`${second.url}/__hui/hooks/${TOKEN}`, report)).status, 202);
  const taken = createServer((_request, response) => response.end());
  taken.listen(0, "127.0.0.1");
  await once(taken, "listening");
  const address = taken.address();
  assert.ok(address && typeof address !== "string");
  const blocked = new WorkerHookEndpoint({ dir: second.dir, port: address.port, relay: async () => ({ status: 202, body: {} }) });
  await assert.rejects(() => blocked.listen(), /EADDRINUSE/u);
  taken.close();

  const output = lines.join("\n");
  assert.equal(output.includes(TOKEN), false, `a log line named the token: ${output}`);
  assert.equal(output.includes("BODY_MARKER"), false, `a log line carried the report: ${output}`);
  assert.equal((await names(second.dir)).length, 0, "the relayed reports were answered, not queued");
});
