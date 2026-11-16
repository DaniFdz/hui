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

async function endpoint(t: TestContext, relay: Relay, port = 0) {
  const dir = await mkdtemp(join(tmpdir(), "hui-hook-endpoint-"));
  let activity = 0;
  const ep = new WorkerHookEndpoint({ dir, port, relay, onActivity: () => { activity += 1; } });
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
