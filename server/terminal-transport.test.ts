import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { terminals } from "./terminals.ts";
import { attachTerminalTransport } from "./terminal-transport.ts";
import type { TerminalEvent } from "../src/lib/terminal-types.ts";

test("guarded HTTP, one-use same-origin WebSocket tickets and agent bridge share one PTY", { timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-terminal-api-"));
  process.env["XDG_CONFIG_HOME"] = dir;
  process.env["SHELL"] = "/bin/sh";
  await mkdir(join(dir, "hui"));
  await writeFile(join(dir, "hui", "sessions.json"), JSON.stringify({ version: 1, sessions: [
    { id: "alpha", title: "Alpha", tool: "pi", cwd: dir, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: "beta", title: "Beta", tool: "pi", cwd: dir, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ], groups: [] }));
  const { middleware, stopBackend } = await import("./hui.ts");
  const { agentToolEnvironment } = await import("./agent-tools-bridge.ts");
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404).end(); }));
  const detach = attachTerminalTransport(server, new Set(["127.0.0.1"]));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { detach(); stopBackend(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
  const api = (path: string, body?: unknown, guard = true) => fetch(origin + path, { method: body === undefined ? "GET" : "POST", headers: { ...(guard ? { "x-hui": "1" } : {}), "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const path = "/__hui/sessions/alpha/terminals";
  assert.equal((await api(path, {}, false)).status, 403);
  assert.equal((await api(path, { cols: 999 })).status, 400);
  const created = await api(path, {});
  assert.equal(created.status, 201);
  const { terminal } = await created.json();
  assert.equal(terminal.cwd, dir);
  assert.equal((await api(`/__hui/sessions/beta/terminals/${terminal.id}`)).status, 404);
  assert.equal((await api(`${path}/${terminal.id}/connect`, {}, false)).status, 403);
  const ticket = async () => (await (await api(`${path}/${terminal.id}/connect`, {})).json()).url as string;
  const connect = (url: string, pageOrigin = origin) => new WebSocket(origin.replace("http:", "ws:") + url, { origin: pageOrigin });
  const rejected = async (url: string, pageOrigin: string) => {
    const ws = connect(url, pageOrigin);
    const [error] = await once(ws, "error");
    assert.match(error.message, /403/);
  };
  await rejected(await ticket(), "https://outside.example");
  await rejected("/__hui/terminal-stream?ticket=invalid", origin);
  const capability = await ticket();
  const ws = connect(capability);
  const frames: TerminalEvent[] = [];
  ws.on("message", (data) => frames.push(JSON.parse(data.toString()) as TerminalEvent));
  await once(ws, "open");
  const waitFrame = (check: () => boolean) => new Promise<void>((resolve, reject) => {
    const done = () => { if (check()) { clearTimeout(timer); ws.off("message", done); resolve(); } };
    const timer = setTimeout(() => { ws.off("message", done); reject(new Error("Expected terminal frame did not arrive.")); }, 5000);
    ws.on("message", done); done();
  });
  await waitFrame(() => frames.some(({ type }) => type === "snapshot"));
  await rejected(capability, origin);
  ws.send(JSON.stringify({ action: "input", data: "printf '%s%s\\n' BROWSER_ INPUT\r" }));
  await waitFrame(() => terminals.read("alpha", terminal.id).data.includes("BROWSER_INPUT"));
  const env = await agentToolEnvironment("alpha");
  const tool = async (params: Record<string, unknown>) => {
    const response = await fetch(`${env["HUI_AGENT_BRIDGE_URL"]}/invoke`, { method: "POST", headers: { authorization: `Bearer ${env["HUI_AGENT_BRIDGE_TOKEN"]}`, "content-type": "application/json" }, body: JSON.stringify({ callerSessionId: "alpha", action: "terminal", params }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  };
  assert.equal((await tool({ action: "list" })).terminals[0].id, terminal.id);
  assert.match((await tool({ action: "read", sessionId: terminal.id })).data, /BROWSER_INPUT/);
  await tool({ action: "input", sessionId: terminal.id, data: "printf '%s%s\\n' AGENT_ INPUT\r" });
  await waitFrame(() => frames.some((frame) => frame.type === "data" && frame.data.includes("AGENT_INPUT")));
  ws.send(JSON.stringify({ action: "resize", cols: 118, rows: 33 }));
  await waitFrame(() => frames.some((frame) => frame.type === "state" && frame.terminal.cols === 118));
  ws.send("not-json");
  await waitFrame(() => frames.some((frame) => frame.type === "error"));
  ws.close(); await once(ws, "close");
  assert.equal(terminals.activeCount, 1);
  const reconnected = connect(await ticket());
  const [replay] = await once(reconnected, "message");
  assert.match(JSON.parse(replay.toString()).data, /AGENT_INPUT/);
  reconnected.close(); await once(reconnected, "close");
  await tool({ action: "close", sessionId: terminal.id });
  assert.equal(terminals.activeCount, 0);
  assert.equal((await api(`${path}/${terminal.id}`)).status, 404);
});
