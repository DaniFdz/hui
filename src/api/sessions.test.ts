import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { test, vi } from "vitest";
import { WebSocketServer } from "ws";

import {
  reconnectDelay,
  STATUS_STREAM_STALL_MS,
  subscribeSessionStatuses,
  subscribeSession,
  type RuntimeEvent,
  type SessionStatusUpdate,
} from "./sessions.ts";

test("the browser runtime contract includes settled", () => {
  const event: RuntimeEvent = { type: "settled" };
  assert.deepEqual(event, { type: "settled" });
});

// `random() = 0` is the low edge of the equal-jitter band, so these read as the
// un-jittered curve.
test("reconnect backoff doubles, then holds at the cap", () => {
  assert.equal(reconnectDelay(1, () => 0), 250);
  assert.equal(reconnectDelay(2, () => 0), 500);
  assert.equal(reconnectDelay(3, () => 0), 1000);
  assert.equal(reconnectDelay(4, () => 0), 2000);
  assert.equal(reconnectDelay(5, () => 0), 2000);
  assert.equal(reconnectDelay(50, () => 0), 2000);
});

test("jitter stays inside the band and under the cap", () => {
  assert.equal(reconnectDelay(1, () => 1), 500);
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const delay = reconnectDelay(attempt, () => 0.5);
    assert.ok(delay > 0 && delay <= 4000, `attempt ${attempt} produced ${delay}`);
  }
});

test("the browser demultiplexes lifecycle snapshot and status frames, however the body is split into reads", async () => {
  const body = new TextEncoder().encode([
    "event: snapshot",
    'data: {"statuses":[{"id":"a","status":"running"}]}',
    "",
    "event: status",
    'data: {"id":"a","status":"idle"}',
    "",
    "event: sessions",
    'data: {"revision":2,"upserts":[]}',
    "",
    "",
  ].join("\r\n"));
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "/__hui/sessions/events");
    assert.deepEqual(init?.headers, { "x-hui": "1", accept: "text/event-stream" });
    const reads = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of body) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    return new Response(reads, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
  const snapshots: Array<readonly SessionStatusUpdate[]> = [];
  const updates: SessionStatusUpdate[] = [];
  const lists: unknown[] = [];
  let finish!: () => void;
  const received = new Promise<void>((resolve) => { finish = resolve; });

  const stop = subscribeSessionStatuses({
    onSnapshot: (statuses) => snapshots.push(statuses),
    onStatus: (update) => updates.push(update),
    onSessions: (list) => {
      lists.push(list);
      finish();
    },
  }, fetcher);
  await received;
  stop();

  assert.deepEqual(snapshots, [[{ id: "a", status: "running" }]]);
  assert.deepEqual(updates, [{ id: "a", status: "idle" }]);
  assert.deepEqual(lists, [{ revision: 2, upserts: [] }]);
});

test("a status stream that goes silent reconnects to resync", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  let connections = 0;
  const fetcher = (async () => {
    connections += 1;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: snapshot\ndata: {"statuses":[]}\n\n'));
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const stop = subscribeSessionStatuses({ onSnapshot: () => {}, onStatus: () => {} }, fetcher);
  t.onTestFinished(stop);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(setImmediate); };

  await settle();
  vi.advanceTimersByTime(STATUS_STREAM_STALL_MS - 1);
  await settle();
  assert.equal(connections, 1);
  vi.advanceTimersByTime(1);
  await settle();
  vi.advanceTimersByTime(reconnectDelay(1, () => 1));
  await settle();
  assert.equal(connections, 2);
});

for (const blocked of ["ticket", "handshake", "first snapshot"]) {
  test(blocked === "first snapshot" ? "an established session stream allows a slow first snapshot"
    : `a stalled session-stream ${blocked} is retried without dropping a healthy idle stream`, async (t) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let entered!: () => void;
    const firstAttempt = new Promise<void>((resolve) => { entered = resolve; });
    let delivered!: () => void;
    const ready = new Promise<void>((resolve) => { delivered = resolve; });
    let established!: () => void;
    const opened = new Promise<void>((resolve) => { established = resolve; });
    let receivedHeartbeat!: () => void;
    const heartbeat = new Promise<void>((resolve) => { receivedHeartbeat = resolve; });
    const nativeWebSocket = globalThis.WebSocket;
    vi.stubGlobal("WebSocket", class extends nativeWebSocket {
      constructor(...args: ConstructorParameters<typeof nativeWebSocket>) {
        super(...args);
        this.addEventListener("open", () => established(), { once: true });
        this.addEventListener("message", (event) => { if (String(event.data).includes('"heartbeat"')) receivedHeartbeat(); });
      }
    });
    let tickets = 0, streams = 0;
    let stalledUpgrade: Duplex | undefined;
    let releaseSnapshot = () => {};
    const frame = JSON.stringify({ event: "snapshot", data: { transcript: [], status: "idle", queue: { steering: [], followUp: [] }, questions: [], subagents: [] } });
    const server = createServer((_request, response) => {
      tickets += 1;
      if (blocked === "ticket" && tickets === 1) { entered(); return; }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ url: "/session-stream" }));
    });
    const sockets = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      streams += 1;
      if (blocked === "handshake" && streams === 1) { stalledUpgrade = socket; entered(); return; }
      sockets.handleUpgrade(request, socket, head, (stream) => {
        if (blocked === "first snapshot" && streams === 1) {
          releaseSnapshot = () => stream.send(frame);
          entered();
          return;
        }
        stream.send(frame);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    let stop = () => {};
    t.onTestFinished(async () => {
      stop();
      stalledUpgrade?.destroy();
      for (const socket of sockets.clients) socket.terminate();
      server.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => sockets.close(() => resolve())),
      ]);
      vi.useRealTimers();
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal("location", new URL(origin));
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => nativeFetch(input instanceof Request ? input : new URL(input, origin), init));
    const states: string[] = [];
    stop = subscribeSession("a", {
      onSnapshot: () => delivered(), onTranscript: () => {}, onEvent: () => {}, onStatus: () => {},
      onModel: () => {}, onThinking: () => {}, onConnection: (state) => states.push(state),
    });
    await firstAttempt;
    if (blocked === "first snapshot") {
      await opened;
      await vi.advanceTimersByTimeAsync(40_000);
      assert.deepEqual(states, [], "the handshake deadline must not become a snapshot-download deadline");
      releaseSnapshot();
    } else {
      await vi.advanceTimersByTimeAsync(20_000);
      assert.ok(states.includes("reconnecting"), "a stalled attempt must enter the existing retry loop");
      await vi.advanceTimersByTimeAsync(reconnectDelay(1, () => 1));
    }
    await ready;
    const expected = blocked === "first snapshot" ? 1 : 2;
    assert.equal(tickets, expected);
    assert.equal(states.at(-1), "live");
    await vi.advanceTimersByTimeAsync(20_000);
    for (const socket of sockets.clients) socket.send(JSON.stringify({ event: "heartbeat", data: {} }));
    await heartbeat;
    await vi.advanceTimersByTimeAsync(20_000);
    assert.equal(tickets, expected, "a healthy idle stream keeps no establishment deadline");
  });
}

test("the browser reads every event stream through readEventStream", () => {
  const src = new URL("../", import.meta.url);
  const readers = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "api/sessions.ts")
    .filter((file) => /\.getReader\(|\.pipeTo\(|for await \(.+\.body\b/u.test(readFileSync(new URL(file, src), "utf8")));
  assert.deepEqual(readers, [], "Read an event stream with readEventStream from src/api/sessions.ts instead of its own reader");
});
