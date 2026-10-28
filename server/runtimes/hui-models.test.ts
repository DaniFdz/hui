import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { waitFor } from "../test-support/wait-for.ts";
import { createSessionModelRuntime, writeProviderSelections } from "./hui-models.ts";

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
