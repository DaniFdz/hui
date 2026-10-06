/**
 * The worker host's credential cache, through the stores its runtimes use and
 * a gateway connected to its socket. workers.test.ts runs whole sessions.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
const { invokeAgentTool } = await import("../agent-tools-bridge.ts");
type Store = ReturnType<typeof brokeredStore>;

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

test("a session's secret request is answered on the gateway, written here, and its Stop reaches the gateway", async (t) => {
  const socket = connect(host.paths.socket);
  const peer = attachPeer(socket, socket);
  t.after(() => socket.destroy());
  const asked: Record<string, unknown>[] = [];
  let held: AbortSignal | undefined;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  peer.handle("secret-request", (params, signal) => {
    asked.push(params);
    if ((params["params"] as { label?: string }).label !== "Held") return { status: "provided", label: "Token", value: "s3cr3t-on-the-worker" };
    held = signal;
    entered();
    return new Promise(() => undefined);
  });
  await peer.request("hello");

  const delivered = await invokeAgentTool({ callerSessionId: "remote-key", action: "secret_request", params: { label: "Token", reason: "Log in" } }) as { status: string; path: string };
  assert.equal(delivered.status, "provided");
  assert.equal(await readFile(delivered.path, "utf8"), "s3cr3t-on-the-worker");
  assert.equal((await stat(delivered.path)).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(delivered).includes("s3cr3t"), "the agent gets the path, never the value");
  assert.deepEqual(asked[0], { key: "remote-key", params: { label: "Token", reason: "Log in" } });

  const stop = new AbortController();
  const pending = invokeAgentTool({ callerSessionId: "remote-key", action: "secret_request", params: { label: "Held", reason: "Stop me" }, signal: stop.signal });
  await started;
  stop.abort();
  await assert.rejects(pending, /cancelled/u);
  if (!held!.aborted) await new Promise((resolve) => held!.addEventListener("abort", resolve, { once: true }));
});
