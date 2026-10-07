import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { waitFor } from "./test-support/wait-for.ts";

// One isolated gateway on Pi Durable: HUI's directory, PI's agent directory and a deterministic provider, all temporary.
const dir = await mkdtemp(join(tmpdir(), "hui-prompt-routes-"));
const agentDir = join(dir, "agent");
const workspace = join(dir, "workspace");
await mkdir(agentDir);
await mkdir(workspace);
process.env["XDG_CONFIG_HOME"] = join(dir, "config");
process.env["PI_CODING_AGENT_DIR"] = agentDir;
const provider = spawn(process.execPath, [fileURLToPath(new URL("../e2e/pi-provider-fixture.mjs", import.meta.url))], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HUI_E2E_PROVIDER_PORT: "0", HUI_E2E_WORKSPACE: workspace, HUI_E2E_PROVIDER_LOG: join(dir, "requests.jsonl") },
});
const [ready] = await once(provider.stdout!, "data");
const providerUrl = String(ready).match(/http:\/\/127\.0\.0\.1:\d+/u)?.[0];
assert(providerUrl, String(ready));
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "hui-e2e": {
  baseUrl: providerUrl, api: "anthropic-messages", apiKey: "***", models: [{
    id: "fixture", name: "fixture", reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }],
} } }));
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture" }));

const { middleware, startBackend, stopBackend } = await import("./hui.ts");
const { liveSessions } = await import("./live-sessions.ts");
let origin = "";
const server = createServer((request, response) => middleware(request, response, () => { response.writeHead(404).end(); }));

before(async () => {
  await startBackend();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  stopBackend();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const exit = once(provider, "exit");
  provider.kill();
  await exit;
  await rm(dir, { recursive: true, force: true });
});

async function call(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(origin + path, {
    method,
    headers: { "x-hui": "1", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/** The prompts the session holds with `text` in them. */
const prompts = (id: string, text: string) => liveSessions.transcript(id)
  .filter((entry) => entry.kind === "message" && entry.role === "user" && entry.text.includes(text)).length;

/** Until the session is idle with a reply after the latest prompt holding `text`: that turn is over. */
async function answered(id: string, text: string): Promise<void> {
  await waitFor(`the reply to ${text}`, () => {
    const entries = liveSessions.transcript(id);
    const prompt = entries.findLastIndex((entry) => entry.kind === "message" && entry.role === "user" && entry.text.includes(text));
    const replied = prompt >= 0 && entries.slice(prompt + 1).some((entry) => entry.kind === "message" && entry.role === "assistant");
    return replied && liveSessions.status(id) === "idle";
  }, { state: () => ({ status: liveSessions.status(id), transcript: liveSessions.transcript(id) }) });
}

test("a resent request id is answered with the first send's outcome and never runs twice, whichever route it comes back through", { timeout: 60_000 }, async () => {
  const created = await call("/__hui/sessions", "POST", { cwd: workspace, title: "Resends" });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = (created.body["session"] as { id: string; tool: string }).id;
  assert.equal((created.body["session"] as { tool: string }).tool, "durable");
  assert.equal((await call(`/__hui/sessions/${id}/open`, "POST", {})).status, 200);

  const first = await call(`/__hui/sessions/${id}/prompt`, "POST", { text: "RESEND_ONE", requestId: "req-1" });
  assert.deepEqual(first, { status: 200, body: { ok: true } });
  await answered(id, "RESEND_ONE");
  // The browser gave up waiting, so the composer sends it again; with the run over it would have started another.
  const resent = await call(`/__hui/sessions/${id}/follow-up`, "POST", { text: "RESEND_ONE", requestId: "req-1" });
  assert.deepEqual(resent, { status: 200, body: { ok: true, duplicate: true } });
  assert.equal(liveSessions.status(id), "idle", "nothing started");
  assert.equal(prompts(id, "RESEND_ONE"), 1);

  // Both on their way at once: one runs, the other waits for it instead of hitting "already working".
  const together = await Promise.all([
    call(`/__hui/sessions/${id}/prompt`, "POST", { text: "RESEND_TWO", requestId: "req-2" }),
    call(`/__hui/sessions/${id}/prompt`, "POST", { text: "RESEND_TWO", requestId: "req-2" }),
  ]);
  assert.deepEqual(together.map((reply) => reply.status), [200, 200], JSON.stringify(together));
  assert.deepEqual(together.map((reply) => reply.body["duplicate"] === true).sort(), [false, true]);
  await answered(id, "RESEND_TWO");
  assert.equal(prompts(id, "RESEND_TWO"), 1);

  // Without an id every send runs, as before; a malformed id is refused before anything runs.
  const plain = await call(`/__hui/sessions/${id}/prompt`, "POST", { text: "RESEND_THREE" });
  assert.equal(plain.status, 200, JSON.stringify(plain.body));
  await answered(id, "RESEND_THREE");
  const again = await call(`/__hui/sessions/${id}/prompt`, "POST", { text: "RESEND_THREE" });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  await answered(id, "RESEND_THREE");
  assert.equal(prompts(id, "RESEND_THREE"), 2);
  const refused = await call(`/__hui/sessions/${id}/prompt`, "POST", { text: "RESEND_FOUR", requestId: "has spaces" });
  assert.equal(refused.status, 400);
  assert.equal(prompts(id, "RESEND_FOUR"), 0);
});
