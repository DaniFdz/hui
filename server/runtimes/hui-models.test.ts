import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { waitFor } from "../test-support/wait-for.ts";
import { createSessionModelRuntime, keyCommandFails, writeProviderSelections } from "./hui-models.ts";

const runtimes = ["PI providers only", "with a HUI provider selected"] as const;

async function runtimeWithKeyCommand(t: TestContext, kind: (typeof runtimes)[number], command: (dir: string) => string, stored?: string) {
  const dir = await mkdtemp(join(tmpdir(), "hui-key-command-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const agentDir = join(dir, "pi");
  await mkdir(agentDir);
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { keyed: {
    baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions", apiKey: `!${command(dir)}`, models: [{ id: "m" }],
  } } }));
  if (stored) await writeFile(join(agentDir, "auth.json"), JSON.stringify({ keyed: { type: "api_key", key: stored } }), { mode: 0o600 });
  if (kind === "with a HUI provider selected") await writeProviderSelections({ openai: { models: [] } }, join(dir, "hui"));
  const runtime = await createSessionModelRuntime(agentDir, join(dir, "hui"));
  const model = runtime.getModel("keyed", "m")!;
  const keys: Array<string | undefined> = [];
  runtime.registerNativeProvider({ ...runtime.getProvider("keyed")!, streamSimple: (_model, _context, options) => {
    keys.push(options?.apiKey);
    const output = createAssistantMessageEventStream();
    output.push({ type: "done", reason: "stop", message: fauxAssistantMessage("OK") });
    output.end();
    return output;
  } });
  return { dir, runtime, model, keys };
}

const waitsForReady = (dir: string) => `touch '${dir}/started'; while [ ! -e '${dir}/ready' ]; do sleep 0.01; done; echo sk-command`;

test.for(runtimes)("a models.json key command runs while the event loop keeps going, and its key reaches the request (%s)", async (kind, t) => {
  const { dir, runtime, model, keys } = await runtimeWithKeyCommand(t, kind, waitsForReady);
  const answered = waitFor("the key command to start", () => existsSync(join(dir, "started"))).then(() => writeFile(join(dir, "ready"), ""));
  const reply = await runtime.completeSimple(model, { messages: [] });
  await answered;
  assert.equal(reply.stopReason, "stop", String(reply.errorMessage));
  assert.deepEqual(keys, ["sk-command"]);
});

test.for(runtimes)("Stop ends a request whose key command is still running (%s)", async (kind, t) => {
  const { dir, runtime, model, keys } = await runtimeWithKeyCommand(t, kind, waitsForReady);
  const stop = new AbortController();
  const replying = runtime.completeSimple(model, { messages: [] }, { signal: stop.signal });
  await waitFor("the key command to start", () => existsSync(join(dir, "started")));
  stop.abort(new Error("Stopped by the operator"));
  assert.equal((await replying).errorMessage, "Stopped by the operator");
  assert.deepEqual(keys, []);
});

test.for(runtimes)("a stored credential still wins over the key command, and a failed command fails the request as PI's does (%s)", async (kind, t) => {
  const stored = await runtimeWithKeyCommand(t, kind, (dir) => `touch '${dir}/started'; echo sk-command`, "sk-stored");
  await stored.runtime.completeSimple(stored.model, { messages: [] });
  assert.deepEqual(stored.keys, ["sk-stored"]);
  assert.equal(existsSync(join(stored.dir, "started")), false, "the command never ran");

  const failing = await runtimeWithKeyCommand(t, kind, () => "exit 1");
  const reply = await failing.runtime.completeSimple(failing.model, { messages: [] });
  assert.equal(reply.stopReason, "error");
  assert.equal(reply.errorMessage, 'API key auth failed for provider keyed: Failed to resolve API key for provider "keyed" from shell command: exit 1');
  assert.deepEqual(failing.keys, []);
});

test.for(runtimes)("keyCommandFails is true only while the key command fails, and Stop still ends it (%s)", async (kind, t) => {
  const signal = new AbortController().signal;
  const failing = await runtimeWithKeyCommand(t, kind, () => "exit 1");
  assert.equal(await keyCommandFails(failing.runtime, "keyed", signal), true);
  const working = await runtimeWithKeyCommand(t, kind, () => "echo sk-command");
  assert.equal(await keyCommandFails(working.runtime, "keyed", signal), false);
  const stored = await runtimeWithKeyCommand(t, kind, () => "exit 1", "sk-stored");
  assert.equal(await keyCommandFails(stored.runtime, "keyed", signal), false, "a stored credential never runs the command");
  const waiting = await runtimeWithKeyCommand(t, kind, waitsForReady);
  const stop = new AbortController();
  const checking = keyCommandFails(waiting.runtime, "keyed", stop.signal);
  await waitFor("the key command to start", () => existsSync(join(waiting.dir, "started")));
  stop.abort(new Error("Stopped by the operator"));
  await assert.rejects(checking, /Stopped by the operator/u);
});

type LocalGate = { isStarting: (provider: string) => boolean; waitWhileStarting: (provider: string, signal?: AbortSignal) => Promise<void> };

async function runtimeWithLocalGate(t: TestContext, gate: LocalGate) {
  const dir = await mkdtemp(join(tmpdir(), "hui-local-gate-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const agentDir = join(dir, "pi");
  await mkdir(agentDir);
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
    baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions", apiKey: "fixture", models: [{ id: "m" }],
  } } }));
  const runtime = await createSessionModelRuntime(agentDir, join(dir, "hui"), gate);
  const calls: string[] = [];
  runtime.registerNativeProvider({ ...runtime.getProvider("local")!, streamSimple: (_model, _context, options) => {
    calls.push(options?.headers?.["x-fixture"] ?? "called");
    const output = createAssistantMessageEventStream();
    output.push({ type: "done", reason: "stop", message: fauxAssistantMessage("OK") });
    output.end();
    return output;
  } });
  return { runtime, model: runtime.getModel("local", "m")!, calls };
}

test("a model request waits for a local server that is still starting", async (t) => {
  let release!: () => void;
  const started = new Promise<void>((resolve) => { release = resolve; });
  let asked = 0;
  const gate: LocalGate = {
    isStarting: () => true,
    waitWhileStarting: async () => { asked += 1; await started; },
  };
  const { runtime, model, calls } = await runtimeWithLocalGate(t, gate);
  const reply = runtime.completeSimple(model, { messages: [] });
  await waitFor("the model request to wait for the start", () => asked > 0);
  assert.deepEqual(calls, [], "the provider is not called while the server is starting");
  release();
  const message = await reply;
  assert.equal(message.stopReason, "stop", String(message.errorMessage));
  assert.deepEqual(calls, ["called"]);
});

test("a failed local start rejects the waiting model request with its reason", async (t) => {
  const gate: LocalGate = {
    isStarting: () => true,
    waitWhileStarting: async () => { throw new Error("Studio did not start: the command exited with code 3."); },
  };
  const { runtime, model, calls } = await runtimeWithLocalGate(t, gate);
  const message = await runtime.completeSimple(model, { messages: [] });
  assert.equal(message.stopReason, "error");
  assert.match(message.errorMessage ?? "", /Studio did not start: the command exited with code 3/u);
  assert.deepEqual(calls, [], "a failed start never reaches the provider");
});

test("a model request does not wait when no local start is in progress", async (t) => {
  let asked = 0;
  const gate: LocalGate = { isStarting: () => false, waitWhileStarting: async () => { asked += 1; } };
  const { runtime, model, calls } = await runtimeWithLocalGate(t, gate);
  const message = await runtime.completeSimple(model, { messages: [] });
  assert.equal(message.stopReason, "stop", String(message.errorMessage));
  assert.equal(asked, 0);
  assert.deepEqual(calls, ["called"]);
});

test("a cancelled waiting model request ends without reaching the provider", async (t) => {
  const gate: LocalGate = {
    isStarting: () => true,
    waitWhileStarting: async (_provider, signal) => {
      signal?.throwIfAborted();
      await new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
    },
  };
  const { runtime, model, calls } = await runtimeWithLocalGate(t, gate);
  const stop = new AbortController();
  const reply = runtime.completeSimple(model, { messages: [] }, { signal: stop.signal });
  stop.abort(new Error("Stopped by the operator"));
  const message = await reply;
  assert.equal(message.stopReason, "error");
  assert.match(message.errorMessage ?? "", /Stopped by the operator/u);
  assert.deepEqual(calls, []);
});
