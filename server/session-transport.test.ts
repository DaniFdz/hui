import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { WebSocket as NodeWebSocket } from "ws";
import { attachSessionTransport, sessionStreamTicket } from "./session-transport.ts";
import { subscribeSession, type SessionConnection, type SessionStatus } from "../src/lib/sessions-store.ts";

test("session views stream over one-use, same-origin WebSocket tickets", { timeout: 10_000 }, async (t) => {
  let emit: (event: string, data: unknown) => void = () => {};
  let unsubscribed = 0;
  const server = createServer((request, response) => {
    const id = request.method === "POST" ? request.url?.match(/^\/__hui\/sessions\/([^/]+)\/connect$/u)?.[1] : undefined;
    if (!id) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ url: sessionStreamTicket(id) }));
  });
  const attach = () => attachSessionTransport(server, async (id, send) => {
    if (id === "gone") return undefined;
    emit = send;
    send("snapshot", { transcript: [], status: "idle" });
    return () => { unsubscribed += 1; };
  }, new Set(["127.0.0.1"]));
  let detach = attach();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const socketUrl = (path: string) => origin.replace("http:", "ws:") + path;
  // The browser globals the store relies on: relative fetches, location, and a
  // WebSocket that sends its page Origin.
  const saved = { fetch: globalThis.fetch, location: Reflect.get(globalThis, "location"), WebSocket: globalThis.WebSocket };
  Object.assign(globalThis, {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => saved.fetch(new URL(String(input), origin), init),
    location: { href: `${origin}/` },
    WebSocket: class extends NodeWebSocket { constructor(url: URL) { super(url, { origin }); } },
  });
  t.after(async () => {
    Object.assign(globalThis, saved);
    detach();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const refused = async (path: string, pageOrigin = origin) => {
    const [error] = await once(new NodeWebSocket(socketUrl(path), { origin: pageOrigin }), "error");
    assert.match((error as Error).message, /403/u);
  };
  await refused(sessionStreamTicket("alpha")!, "https://outside.example");
  await refused("/__hui/session-stream?ticket=invented");
  const ticket = sessionStreamTicket("alpha")!;
  const first = new NodeWebSocket(socketUrl(ticket), { origin });
  await once(first, "message");
  first.close();
  await refused(ticket);

  const connections: Array<[SessionConnection, string]> = [];
  const statuses: SessionStatus[] = [];
  let snapshots = 0;
  const until = async (check: () => boolean) => {
    for (const deadline = Date.now() + 3_000; !check(); await new Promise((resolve) => setTimeout(resolve, 10))) {
      assert.ok(Date.now() < deadline, "the expected stream state never arrived");
    }
  };
  const handlers = (label: string) => ({
    onSnapshot: () => { snapshots += 1; },
    onTranscript: () => {},
    onEvent: () => {},
    onStatus: (status: SessionStatus) => { statuses.push(status); },
    onModel: () => {},
    onThinking: () => {},
    onConnection: (state: SessionConnection, detail: string) => { connections.push([state, `${label}${detail}`]); },
  });

  const stops = [subscribeSession("alpha", handlers("alpha: "))];
  t.after(() => stops.forEach((stop) => stop()));
  await until(() => snapshots === 1);
  assert.deepEqual(connections, [["live", "alpha: "]]);
  emit("status", { status: "running" });
  await until(() => statuses.length === 1);
  assert.deepEqual(statuses, ["running"]);
  // A dropped socket (a gateway restart) reconnects with a fresh ticket and snapshot.
  detach();
  detach = attach();
  await until(() => snapshots === 2);
  assert.deepEqual(connections.map(([state]) => state), ["live", "reconnecting", "live"]);
  const closedBefore = unsubscribed;
  emit("closed", {});
  await until(() => connections.length === 4 && unsubscribed === closedBefore + 1);
  assert.deepEqual(connections[3], ["stopped", "alpha: pi exited — this session is no longer streaming."]);

  stops.push(subscribeSession("gone", handlers("gone: ")));
  await until(() => connections.length === 5);
  assert.deepEqual(connections[4], ["stopped", "gone: This session no longer exists."]);
});
