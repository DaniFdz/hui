import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { terminals } from "./terminals.ts";
import { attachTerminalTransport, createOutputBatcher, TERMINAL_BATCH_BYTES } from "./terminal-transport.ts";
import type { TerminalControlFrame } from "../shared/terminal-stream.ts";

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
  t.after(async () => { detach(); await stopBackend(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
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
  // Metadata arrives as JSON text, PTY output as raw binary bytes.
  const frames: TerminalControlFrame[] = [];
  const output: Buffer[] = [];
  const text = () => Buffer.concat(output).toString("utf8");
  ws.on("message", (data, binary) => {
    if (binary) output.push(data as Buffer); else frames.push(JSON.parse(data.toString()) as TerminalControlFrame);
  });
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
  await waitFrame(() => text().includes("AGENT_INPUT"));
  ws.send(JSON.stringify({ action: "input", data: "printf '\\033[31m%s\\033[0m\\n' RED_OUTPUT\r" }));
  await waitFrame(() => text().includes("RED_OUTPUT\u001b[0m"));
  assert.ok(text().includes("\u001b[31mRED_OUTPUT"), "control bytes travel unescaped");
  ws.send(JSON.stringify({ action: "resize", cols: 118, rows: 33 }));
  await waitFrame(() => frames.some((frame) => frame.type === "state" && frame.terminal.cols === 118));
  ws.send("not-json");
  await waitFrame(() => frames.some((frame) => frame.type === "error"));
  const errors = () => frames.filter((frame) => frame.type === "error").length;
  const before = errors();
  ws.send(Buffer.from("printf NEVER_RUN\r"), { binary: true });
  await waitFrame(() => errors() > before);
  assert.ok(!terminals.read("alpha", terminal.id).data.includes("NEVER_RUN"), "binary client messages never execute input");
  ws.close(); await once(ws, "close");
  assert.equal(terminals.activeCount, 1);
  const reconnected = connect(await ticket());
  type Message = [Buffer, boolean];
  const replayed = new Promise<[Message, Message]>((resolve) => {
    const messages: Message[] = [];
    reconnected.on("message", (data, binary) => { messages.push([data as Buffer, binary]); if (messages.length === 2) resolve([messages[0]!, messages[1]!]); });
  });
  const [[snapshotData, snapshotBinary], [replayData, replayBinary]] = await replayed;
  const snapshot = JSON.parse(snapshotData.toString()) as TerminalControlFrame;
  assert.equal(snapshotBinary, false);
  assert.ok(snapshot.type === "snapshot" && snapshot.replayBytes === replayData.length, "the snapshot announces its replay's exact size");
  assert.equal(replayBinary, true);
  assert.match(replayData.toString("utf8"), /AGENT_INPUT/);
  reconnected.close(); await once(reconnected, "close");
  await tool({ action: "close", sessionId: terminal.id });
  assert.equal(terminals.activeCount, 0);
  assert.equal((await api(`${path}/${terminal.id}`)).status, 404);
});

test("output batching sends the first chunk at once and joins a burst into bounded messages", () => {
  const sent: string[] = [];
  const timers: (() => void)[] = [];
  let cancelled = 0;
  const batcher = createOutputBatcher((bytes) => sent.push(bytes.toString()), (flush) => { timers.push(flush); return () => { cancelled++; }; });
  batcher.push(Buffer.from("$ "));
  assert.deepEqual(sent, ["$ "], "echo after a quiet period is not delayed");
  batcher.push(Buffer.from("a"));
  batcher.push(Buffer.from("b"));
  assert.deepEqual(sent, ["$ "]);
  timers.shift()!();
  assert.deepEqual(sent, ["$ ", "ab"], "a burst becomes one message");
  timers.shift()!();
  assert.equal(timers.length, 0, "a quiet tick stops the timer");
  batcher.push(Buffer.from("next"));
  assert.deepEqual(sent, ["$ ", "ab", "next"]);
  const big = Buffer.alloc(TERMINAL_BATCH_BYTES / 2, "x");
  batcher.push(big); batcher.push(big); batcher.push(Buffer.from("y"));
  assert.equal(sent.length, 4, "a full batch is sent without waiting");
  assert.equal(sent[3]!.length, TERMINAL_BATCH_BYTES);
  batcher.flush();
  assert.equal(sent.at(-1), "y", "flush sends what is pending, so a later state frame keeps its order");
  batcher.flush();
  assert.equal(sent.length, 5, "flushing nothing sends nothing");
  batcher.push(Buffer.from("dropped"));
  batcher.dispose();
  assert.equal(cancelled, 1);
  assert.ok(!sent.includes("dropped"), "a closed socket's pending output is discarded");
});
