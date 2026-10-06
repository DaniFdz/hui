/**
 * The worker host's credential cache, through the stores its runtimes use and
 * a gateway connected to its socket. workers.test.ts runs whole sessions.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const root = await mkdtemp(join(tmpdir(), "hui-worker-host-"));
process.env["HOME"] = root;
process.env["XDG_CONFIG_HOME"] = join(root, "config");
process.env["XDG_DATA_HOME"] = join(root, "data");
process.env["PI_CODING_AGENT_DIR"] = join(root, "agent");
const { workerPaths } = await import("./paths.ts");
const { WorkerHost } = await import("./host.ts");
const { attachPeer } = await import("./protocol.ts");
const { brokeredStore, ownLogin } = await import("./credentials.ts");
type Store = ReturnType<typeof brokeredStore>;
type Frame = import("./protocol.ts").Frame;
type HostInfo = import("./host.ts").HostInfo;

const host = new WorkerHost(workerPaths());
await host.listen();
after(async () => {
  await host.close();
  await rm(root, { recursive: true, force: true });
});

/** A gateway serving `credentials`; resolves once the host has accepted it. */
async function gateway(credentials: Map<string, unknown>) {
  const socket = connect(host.paths.socket);
  const peer = attachPeer(socket, socket);
  peer.handle("credential", (params) => {
    const id = String(params["providerId"]);
    if (params["op"] === "delete") credentials.delete(id);
    return credentials.get(id) ?? null;
  });
  await peer.request("hello");
  return { disconnect: () => socket.destroy() };
}

/** The remote's own login, used when the host has no answer from a gateway. */
const own = { read: async (id: string) => ({ type: "api_key", key: `own-${id}` }) } as unknown as Store;
const store = brokeredStore("pi", () => own);

test("cached gateway credentials end at their expiry or deletion; then the remote's own login answers", async () => {
  const connected = await gateway(new Map<string, unknown>([
    ["soon", { type: "oauth", access: "gateway-soon", refresh: "r", expires: Date.now() + 500 }],
    ["later", { type: "oauth", access: "gateway-later", refresh: "r", expires: Date.now() + 3_600_000 }],
    ["deleted", { type: "api_key", key: "gateway-deleted" }],
  ]));
  for (const id of ["soon", "later", "deleted"]) assert.notEqual(await store.read(id), undefined);
  await store.delete("deleted");
  connected.disconnect();
  // Once the host notices the gateway left and the short token expires.
  for (const deadline = Date.now() + 30_000; (await store.read("soon") as { key?: string }).key !== "own-soon";) {
    if (Date.now() > deadline) throw new Error("The expired credential was still served from the cache.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal((await store.read("later") as { access?: string }).access, "gateway-later");
  assert.deepEqual(await store.read("deleted"), { type: "api_key", key: "own-deleted" });
});

test("the remote's own login is only opened once it exists, so no file appears outside HUI's directory", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-own-login-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, ".pi", "agent", "auth.json");
  const login = ownLogin(path);
  assert.equal(await login.read("fx"), undefined);
  assert.deepEqual(await login.list(), []);
  await login.delete("fx");
  assert.equal(existsSync(path), false);
  await mkdir(join(dir, ".pi", "agent"), { recursive: true });
  await writeFile(path, JSON.stringify({ fx: { type: "api_key", key: "own-key" } }));
  assert.deepEqual(await login.read("fx"), { type: "api_key", key: "own-key" });
});

test("folder suggestions list directories on the worker, not the gateway", async () => {
  await mkdir(join(root, "remote-project"), { recursive: true });
  await writeFile(join(root, "remote-file"), "");
  const socket = connect(host.paths.socket);
  const peer = attachPeer(socket, socket);
  try {
    const { directories } = await peer.request<{ directories: string[] }>("directories", { q: "~/remote" });
    assert.deepEqual(directories, ["~/remote-project/"]);
  } finally {
    socket.destroy();
  }
});

/** A gateway's view of the host's bot operations: requests, and the frames the host sends it. */
async function botGateway() {
  const socket = connect(host.paths.socket);
  const peer = attachPeer(socket, socket);
  const frames: Frame[] = [];
  peer.onFrame((frame) => frames.push(frame));
  // No logins: the host's models list nothing.
  peer.handle("credential", (params) => params["op"] === "list" ? [] : null);
  const hello = await peer.request<HostInfo>("hello");
  return { peer, frames, hello, disconnect: () => socket.destroy() };
}

async function until<T>(read: () => T | undefined, label: string): Promise<T> {
  for (const deadline = Date.now() + 30_000; ;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("a bot's conversation and memory are made in the host's own store, in its own folder there, and read back through the host", async () => {
  const gateway = await botGateway();
  const { peer, frames } = gateway;
  try {
    assert.ok(gateway.hello.features?.includes("bots"), "hello says the host runs bots");
    const created = await peer.request<{ reference: string; cwd: string }>("bot.create", { botId: "bot-ada", instructions: "You are Ada.", memory: { name: "Ada" } });
    assert.match(created.reference, /^durable:\d+$/u);
    // A private folder under HUI's data directory on the worker, as the gateway makes one under its configuration.
    assert.equal(created.cwd, join(host.paths.dataDir, "bots", "bot-ada"));
    assert.equal((await stat(created.cwd)).mode & 0o777, 0o700);
    const reference = created.reference;

    // OptChat is on from the creating commit: an empty memory, read through the host.
    const status = await peer.request<{ status?: { messages: number; viewLines: number } }>("bot.memory.status", { reference });
    assert.equal(status.status?.messages, 0);
    const view = await peer.request<{ text: string; status?: { messages: number } }>("bot.memory.view", { reference });
    assert.equal(view.text, "<chat>\n\n</chat>");
    assert.equal(view.status?.messages, 0, "the view comes with the status it counts");
    assert.deepEqual(await peer.request("bot.memory.zoom", { reference, id: 0, n: 1 }), { text: "No line 0+1." });
    assert.match((await peer.request<{ text: string }>("bot.memory.html", { reference })).text, /<html/iu);

    // A watched memory reports its status, now and as it changes: a call's record joins the chat and its memory.
    await peer.request("bot.memory.watch", { references: [reference] });
    await until(() => frames.find((frame) => frame.t === "bot.memory.status" && frame["reference"] === reference), "the first report");
    const record = { call: "call-1", bot: "Ada", startedAt: Date.parse("2026-10-06T20:00:00Z"), endedAt: Date.parse("2026-10-06T20:03:00Z"), summary: "Talked about **trips**.", lines: [{ role: "user", text: "Hi", at: Date.parse("2026-10-06T20:00:05Z") }] };
    await peer.request("bot.call-record", { reference, record });
    await until(() => frames.find((frame) => frame.t === "bot.memory.status" && (frame["status"] as { messages?: number }).messages === 1), "the call to reach the memory");
    const last = await peer.request<{ message?: { role: string; text: string; at?: string } }>("bot.last-message", { reference });
    assert.deepEqual(last.message, { role: "assistant", text: "📞 Call · 3 min · Talked about trips.", at: "2026-10-06T20:03:00.000Z" });
    await assert.rejects(peer.request("bot.call-record", { reference, record: { call: "x" } }), /record is not valid/u);

    // Instructions, the directory and the memory's settings change in place; a directory must exist there.
    await mkdir(join(root, "bot-work"), { recursive: true });
    await peer.request("bot.configure", { reference, instructions: null, cwd: "~/bot-work" });
    await peer.request("bot.memory.configure", { reference, settings: { name: "Ada Two", thinking: "low" } });
    await assert.rejects(peer.request("bot.configure", { reference, cwd: "~/missing" }), /No such directory on the remote/u);
    assert.deepEqual(await peer.request("bot.directory", { cwd: "~/bot-work" }), { cwd: join(root, "bot-work") });
    await assert.rejects(peer.request("bot.directory", { cwd: "bot-work" }), /absolute or start with ~\//u);

    // A bot that names a directory works there; one that does not exist creates nothing.
    const placed = await peer.request<{ reference: string; cwd: string }>("bot.create", { botId: "bot-placed", memory: { name: "Placed" }, cwd: "~/bot-work" });
    assert.equal(placed.cwd, join(root, "bot-work"));
    assert.notEqual(placed.reference, reference);
    await assert.rejects(peer.request("bot.create", { botId: "bot-lost", memory: { name: "Lost" }, cwd: "~/missing" }), /No such directory on the remote/u);
    await assert.rejects(peer.request("bot.create", { botId: "bot-bad", memory: { name: "Bad" }, model: "nobody/none" }), /Unknown model: nobody\/none/u);
    assert.equal(existsSync(join(host.paths.dataDir, "bots", "bot-bad")), false, "a refused create leaves no folder behind");

    // The folder the host made goes only while empty: a bot's files never do.
    await writeFile(join(created.cwd, "notes.md"), "kept");
    assert.deepEqual(await peer.request("bot.remove-home", { botId: "bot-ada" }), { removed: false });
    assert.equal(existsSync(join(created.cwd, "notes.md")), true);
    await peer.request("bot.create", { botId: "bot-empty", memory: { name: "Empty" } });
    assert.deepEqual(await peer.request("bot.remove-home", { botId: "bot-empty" }), { removed: true });
    assert.equal(existsSync(join(host.paths.dataDir, "bots", "bot-empty")), false);
    assert.deepEqual(await peer.request("bot.remove-home", { botId: "bot-never" }), { removed: false });

    // Only this store's references.
    await assert.rejects(peer.request("bot.memory.view", { reference: "/tmp/session.jsonl" }), /conversation reference is required/u);
  } finally {
    gateway.disconnect();
  }
});

