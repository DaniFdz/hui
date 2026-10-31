import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, test, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { sendPrompt, subscribeSession, type SessionConnection, type SessionStreamHandlers } from "./sessions.ts";

const offline = vi.hoisted(() => ({ outdated: false }));

vi.mock("./offline.ts", () => {
  class OutdatedBuildError extends Error {
    constructor() {
      super("HUI has a newer build. Reload HUI to continue.");
      this.name = "OutdatedBuildError";
    }
  }
  return {
    OutdatedBuildError,
    assertCurrentBuild: async () => {
      if (offline.outdated) throw new OutdatedBuildError();
    },
    prepareOffline: () => {},
  };
});

function handlers(overrides: Partial<SessionStreamHandlers> = {}): SessionStreamHandlers {
  return {
    onSnapshot: () => {},
    onTranscript: () => {},
    onEvent: () => {},
    onStatus: () => {},
    onModel: () => {},
    onThinking: () => {},
    onConnection: () => {},
    ...overrides,
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

async function until(check: () => boolean, what: string): Promise<void> {
  for (const deadline = performance.now() + 5_000; !check();) {
    assert.ok(performance.now() < deadline, what);
    await wait(10);
  }
}

type FakeGateway = {
  tickets(): number;
  health(): number;
  sends(): number;
  sockets: WebSocket[];
  releaseSend(): void;
  close(): Promise<void>;
};

async function gateway(onSocket: (socket: WebSocket, ticket: number) => void): Promise<FakeGateway> {
  const wss = new WebSocketServer({ noServer: true });
  const sockets: WebSocket[] = [];
  const replies: Array<() => void> = [];
  let tickets = 0;
  let health = 0;
  let sends = 0;
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    if (request.method === "POST" && path.endsWith("/connect")) {
      tickets += 1;
      response.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ url: `/__hui/session-stream?ticket=${tickets}` }));
      return;
    }
    if (request.method === "GET" && path === "/__hui/health") {
      health += 1;
      response.writeHead(200, { "content-type": "application/json" }).end('{"status":"online"}');
      return;
    }
    if (request.method === "POST" && path.endsWith("/prompt")) {
      sends += 1;
      replies.push(() => response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}'));
      return;
    }
    response.writeHead(404).end();
  });
  server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (client) => {
      sockets.push(client);
      onSocket(client, tickets);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  vi.stubGlobal("location", new URL(origin));
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    realFetch(new URL(String(input), origin), init));
  return {
    tickets: () => tickets,
    health: () => health,
    sends: () => sends,
    sockets,
    releaseSend: () => {
      for (const reply of replies.splice(0)) reply();
    },
    close: async () => {
      for (const socket of sockets) socket.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function stubBrowser(): { window: EventTarget; document: EventTarget & { visibilityState: string } } {
  const pageWindow = new EventTarget();
  const pageDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", pageWindow);
  vi.stubGlobal("document", pageDocument);
  return { window: pageWindow, document: pageDocument };
}

const SNAPSHOT = '{"event":"snapshot","data":{"transcript":[],"status":"idle"}}';
const HEARTBEAT = '{"event":"heartbeat","data":{}}';

beforeEach(() => {
  offline.outdated = false;
});

test("a heartbeat proves the socket is alive but never admits live state", { timeout: 20_000 }, async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  const gw = await gateway((socket) => socket.send(HEARTBEAT));
  t.onTestFinished(gw.close);
  const states: SessionConnection[] = [];
  const stop = subscribeSession("alpha", handlers({ onConnection: (state) => states.push(state) }));
  t.onTestFinished(stop);

  await until(() => gw.sockets.length === 1, "the view should connect");
  await settle();
  assert.equal(states.length, 0, "a keepalive frame is not admission");

  gw.sockets[0]?.send(SNAPSHOT);
  await until(() => states.includes("live"), "the snapshot should admit live state");
  stop();
});

test("a held live revision accepts replayed text without waiting for another snapshot", async (t) => {
  const gw = await gateway((socket) => socket.send('{"event":"event","data":{"type":"text","delta":"replayed"}}'));
  t.onTestFinished(gw.close);
  const states: SessionConnection[] = [];
  const text: string[] = [];
  const stop = subscribeSession("alpha", handlers({
    onConnection: (state) => states.push(state),
    onEvent: (event) => { if (event.type === "text") text.push(event.delta); },
  }), 7);
  t.onTestFinished(stop);
  await until(() => states.includes("live"), "a replay on the held snapshot should become live");
  assert.deepEqual(text, ["replayed"]);
  assert.equal(gw.tickets(), 1);
});

test("an opening socket that only receives heartbeats is replaced after 20 seconds", { timeout: 20_000 }, async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  const gw = await gateway((socket) => socket.send(HEARTBEAT));
  t.onTestFinished(gw.close);
  const states: SessionConnection[] = [];
  const stop = subscribeSession("alpha", handlers({ onConnection: (state) => states.push(state) }));
  t.onTestFinished(stop);

  await until(() => gw.sockets.length === 1, "the view should connect");
  await settle();
  vi.advanceTimersByTime(19_999);
  await settle();
  assert.equal(gw.tickets(), 1, "a heartbeat does not extend the wait for the first state frame");
  assert.equal(states.length, 0, "the stream never became live");

  vi.advanceTimersByTime(1);
  await settle();
  await until(() => gw.sockets[0]?.readyState === WebSocket.CLOSED, "the opening socket should be dropped");
  vi.advanceTimersByTime(1_000);
  await settle();
  await until(() => gw.tickets() === 2, "a new ticket should replace the stuck opening");
  stop();
});

test("a socket silent before its first frame is replaced within one minute", { timeout: 20_000 }, async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  let upgraded = false;
  const gw = await gateway((socket) => {
    socket.once("pong", () => { upgraded = true; });
    socket.ping();
  });
  t.onTestFinished(gw.close);
  const states: SessionConnection[] = [];
  const stop = subscribeSession("alpha", handlers({ onConnection: (state) => states.push(state) }));
  t.onTestFinished(stop);

  await until(() => upgraded, "the transport should finish its handshake");
  await settle();
  vi.advanceTimersByTime(59_999);
  await settle();
  assert.equal(gw.tickets(), 1);
  assert.equal(states.length, 0, "a protocol pong is not application state");
  vi.advanceTimersByTime(1);
  await settle();
  await until(() => gw.sockets[0]?.readyState === WebSocket.CLOSED, "a socket silent since upgrade should be dropped");
  vi.advanceTimersByTime(1_000);
  await settle();
  await until(() => gw.tickets() === 2, "the silent opening should get a new ticket");
  assert.ok(!states.includes("live"));
  stop();
});

test("a silent live stream reconnects after 40 seconds", { timeout: 20_000 }, async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  const gw = await gateway((socket) => socket.send(SNAPSHOT));
  t.onTestFinished(gw.close);
  const states: SessionConnection[] = [];
  const stop = subscribeSession("alpha", handlers({ onConnection: (state) => states.push(state) }));
  t.onTestFinished(stop);

  await until(() => states.includes("live"), "the snapshot should admit live state");
  vi.advanceTimersByTime(39_999);
  await settle();
  assert.equal(gw.tickets(), 1);
  assert.equal(gw.sockets[0]?.readyState, WebSocket.OPEN);

  vi.advanceTimersByTime(1);
  await settle();
  await until(() => gw.sockets[0]?.readyState === WebSocket.CLOSED, "40 seconds of silence should drop the socket");
  vi.advanceTimersByTime(1_000);
  await settle();
  await until(() => gw.tickets() === 2, "a silent socket should be replaced");
  stop();
});

test("a send the gateway has not answered makes the socket prove it is alive", { timeout: 20_000 }, async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  const gw = await gateway((socket) => socket.send(SNAPSHOT));
  t.onTestFinished(gw.close);
  const states: SessionConnection[] = [];
  const stop = subscribeSession("alpha", handlers({ onConnection: (state) => states.push(state) }));
  t.onTestFinished(stop);

  await until(() => states.includes("live"), "the snapshot should admit live state");
  const sending = sendPrompt("alpha", "hello");
  await until(() => gw.sends() === 1, "the send should reach the gateway");

  vi.advanceTimersByTime(5_000);
  await settle();
  assert.equal(gw.sockets[0]?.readyState, WebSocket.OPEN, "five unanswered seconds alone replace nothing");
  vi.advanceTimersByTime(9_999);
  await settle();
  assert.equal(gw.sockets[0]?.readyState, WebSocket.OPEN, "the check still waits for proof");

  vi.advanceTimersByTime(1);
  await settle();
  vi.advanceTimersByTime(1_000);
  await until(() => gw.tickets() === 2, "ten more silent seconds should reconnect");

  gw.releaseSend();
  assert.deepEqual(await sending, { duplicate: false }, "the HTTP send keeps its own outcome");
  stop();
});

test("a frame within the send grace keeps the socket", { timeout: 20_000 }, async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  const gw = await gateway((socket) => socket.send(SNAPSHOT));
  t.onTestFinished(gw.close);
  const states: SessionConnection[] = [];
  let received = false;
  const stop = subscribeSession("alpha", handlers({ onConnection: (state) => states.push(state), onStatus: () => { received = true; } }));
  t.onTestFinished(stop);

  await until(() => states.includes("live"), "the snapshot should admit live state");
  const sending = sendPrompt("alpha", "hello");
  await until(() => gw.sends() === 1, "the send should reach the gateway");
  vi.advanceTimersByTime(5_000);
  await settle();
  vi.advanceTimersByTime(9_000);
  await settle();
  gw.sockets[0]?.send('{"event":"status","data":{"status":"idle"}}');
  await until(() => received, "the state frame should arrive within the grace");
  vi.advanceTimersByTime(1_000);
  await settle();
  assert.equal(gw.sockets[0]?.readyState, WebSocket.OPEN, "incoming traffic proves the socket is alive");
  assert.equal(gw.tickets(), 1);

  gw.releaseSend();
  assert.deepEqual(await sending, { duplicate: false });
  stop();
});

test("returning online ends the backoff once and leaves a live socket alone", { timeout: 20_000 }, async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  const browser = stubBrowser();
  const gw = await gateway((socket, ticket) => {
    if (ticket === 1) socket.close();
    else socket.send(SNAPSHOT);
  });
  t.onTestFinished(gw.close);
  const states: SessionConnection[] = [];
  const stop = subscribeSession("alpha", handlers({ onConnection: (state) => states.push(state) }));
  t.onTestFinished(stop);

  await until(() => states.includes("reconnecting"), "the first socket should drop");
  browser.window.dispatchEvent(new Event("online"));
  browser.window.dispatchEvent(new Event("focus"));
  browser.document.dispatchEvent(new Event("visibilitychange"));
  await until(() => gw.tickets() === 2, "fresh evidence should end the backoff without waiting it out");
  assert.equal(gw.health(), 1, "the wake signals share one probe");

  await until(() => states.includes("live"), "the second socket should admit live state");
  browser.window.dispatchEvent(new Event("focus"));
  await settle();
  assert.equal(gw.tickets(), 2, "focus never replaces a live socket");
  assert.equal(gw.health(), 1, "a live socket needs no probe");
  stop();
});

test("a page from another build stops instead of retrying", { timeout: 20_000 }, async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  offline.outdated = true;
  const gw = await gateway(() => {});
  t.onTestFinished(gw.close);
  const states: Array<[SessionConnection, string]> = [];
  const stop = subscribeSession("alpha", handlers({ onConnection: (state, detail) => states.push([state, detail]) }));
  t.onTestFinished(stop);

  await until(() => states.length === 1, "the build check should settle the stream");
  assert.deepEqual(states.map(([state]) => state), ["outdated"]);
  assert.match(states[0]?.[1] ?? "", /newer build/u);
  assert.equal(gw.tickets(), 0, "no ticket is minted for a page from another build");

  vi.advanceTimersByTime(120_000);
  await settle();
  assert.equal(gw.tickets(), 0);
  assert.equal(states.length, 1, "a terminal refusal does not retry");
  stop();
});

test("stopping a stream closes its socket, timers and wake listeners", { timeout: 20_000 }, async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  const browser = stubBrowser();
  const gw = await gateway((socket) => socket.send(SNAPSHOT));
  t.onTestFinished(gw.close);
  const states: SessionConnection[] = [];
  const stop = subscribeSession("alpha", handlers({ onConnection: (state) => states.push(state) }));

  await until(() => states.includes("live"), "the snapshot should admit live state");
  stop();
  stop();
  await until(() => gw.sockets[0]?.readyState === WebSocket.CLOSED, "stopping should close the socket");
  const seen = states.length;

  vi.advanceTimersByTime(120_000);
  await settle();
  browser.window.dispatchEvent(new Event("online"));
  browser.window.dispatchEvent(new Event("focus"));
  browser.document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(gw.tickets(), 1);
  assert.equal(gw.health(), 0, "a stopped stream keeps no wake listeners");
  assert.equal(states.length, seen);
});
