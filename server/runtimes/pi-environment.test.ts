import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runPiCommand } from "../pi-mutations.ts";
import { piEnvironment } from "./pi-environment.ts";
import { runPiUtilityPrompt } from "./pi.ts";

test("isolated utility SDK, utility CLI and installer CLI resolve session headers without extensions", { timeout: 30_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-utility-env-"));
  const agentDir = join(dir, "agent");
  await mkdir(agentDir);
  const headers: string[] = [];
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* Consume the model request. */ }
    const id = request.headers["x-client-session-id"];
    if (typeof id !== "string" || !id) {
      response.writeHead(400); response.end("Missing client session ID"); return;
    }
    headers.push(id);
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", model: "mini", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Utility header works" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const previous = { ...process.env };
  t.after(async () => {
    process.env = previous;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  delete process.env["PI_CLIENT_SESSION_ID"];
  delete process.env["HUI_PI_CLI"];
  process.env["PI_CODING_AGENT_DIR"] = agentDir;
  process.env["XDG_CONFIG_HOME"] = join(dir, "config");
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: {
    baseUrl: `http://127.0.0.1:${address.port}`, api: "anthropic-messages", apiKey: "fixture-not-a-secret",
    headers: { "x-client-session-id": "${PI_CLIENT_SESSION_ID}" },
    models: [{ id: "mini", name: "Fixture Mini", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  for (const backend of ["sdk", "cli"]) {
    process.env["HUI_PI_BACKEND"] = backend;
    assert.equal(await runPiUtilityPrompt({ cwd: dir, agentDir, model: "fixture/mini", prompt: "Say hello" }), "Utility header works");
  }
  const result = await runPiCommand([
    "--print", "--no-session", "--no-extensions", "--no-skills", "--no-context-files",
    "--thinking", "minimal", "--model", "fixture/mini", "--tools", "read,bash,write,edit", "Say hello",
  ], { cwd: agentDir, timeoutMs: 10_000 });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Utility header works/u);
  assert.equal(headers.length, 3);
  assert.equal(new Set(headers).size, 3, "independent auxiliary jobs need independent identities");
  for (const id of headers) assert.match(id, /^[0-9a-f-]{36}$/u);
  assert.equal(process.env["PI_CLIENT_SESSION_ID"], undefined, "child identities must not leak into the gateway");
});

test("PI child environment preserves explicit identity and inherited variables", () => {
  const base = { PI_CLIENT_SESSION_ID: "operator-id", OTHER_SETTING: "retained" };
  assert.deepEqual(piEnvironment(base), base);
  assert.notEqual(piEnvironment({ PI_CLIENT_SESSION_ID: " " })["PI_CLIENT_SESSION_ID"], " ");
  assert.notEqual(piEnvironment({})["PI_CLIENT_SESSION_ID"], piEnvironment({})["PI_CLIENT_SESSION_ID"]);
});
