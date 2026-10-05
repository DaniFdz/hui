import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import type { BotsUpdate, BotView } from "../shared/bots.ts";
import type { TranscriptEntry } from "./runtimes/types.ts";

// One isolated gateway: HUI's directory, PI's agent directory and a deterministic provider, all temporary.
const dir = await mkdtemp(join(tmpdir(), "hui-bot-routes-"));
const agentDir = join(dir, "agent");
const workspace = join(dir, "workspace");
await mkdir(agentDir);
await mkdir(workspace);
process.env["XDG_CONFIG_HOME"] = join(dir, "config");
process.env["PI_CODING_AGENT_DIR"] = agentDir;
const log = join(dir, "requests.jsonl");
const provider = spawn(process.execPath, [fileURLToPath(new URL("../e2e/pi-provider-fixture.mjs", import.meta.url))], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HUI_E2E_PROVIDER_PORT: "0", HUI_E2E_WORKSPACE: workspace, HUI_E2E_PROVIDER_LOG: log },
});
const [ready] = await once(provider.stdout!, "data");
const providerUrl = String(ready).match(/http:\/\/127\.0\.0\.1:\d+/u)?.[0];
assert(providerUrl, String(ready));
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "hui-e2e": {
  baseUrl: providerUrl, api: "anthropic-messages", apiKey: "fixture-key", models: [{
    id: "fixture", name: "fixture", reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }],
} } }));
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture", defaultThinkingLevel: "low" }));

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

async function call(path: string, method = "GET", body?: unknown, guard = true): Promise<{ status: number; body: Record<string, unknown>; text: string; type: string }> {
  const response = await fetch(origin + path, {
    method,
    headers: { ...(guard ? { "x-hui": "1" } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* html */ }
  return { status: response.status, body: parsed, text, type: response.headers.get("content-type") ?? "" };
}

const botOf = (reply: { body: Record<string, unknown> }) => reply.body["bot"] as BotView;

/** Resolves once a session is idle with a transcript `predicate` accepts. */
function settledWith(id: string, predicate: (entries: TranscriptEntry[]) => boolean): Promise<TranscriptEntry[]> {
  return new Promise((resolve) => {
    let done = false;
    const check = () => {
      if (done || liveSessions.status(id) !== "idle" || !predicate(liveSessions.transcript(id))) return;
      done = true;
      watched.unsubscribe();
      resolve(liveSessions.transcript(id));
    };
    const watched = liveSessions.watch(id, check);
    check();
  });
}

const says = (role: "user" | "assistant", text: string) => (entries: TranscriptEntry[]) =>
  entries.some((entry) => entry.kind === "message" && entry.role === role && entry.text.includes(text));

test("bots are created, read, edited, archived and restored through the guarded routes", { timeout: 120_000 }, async () => {
  assert.equal((await call("/__hui/bots", "GET", undefined, false)).status, 403, "the local-client guard applies");
  assert.deepEqual((await call("/__hui/bots")).body, { bots: [] });
  for (const [body, pattern] of [
    [{}, /name is required/u],
    [{ name: "Ada", nickname: "x" }, /Unknown bot field: nickname/u],
    [{ name: "Ada", model: "hui-e2e/missing" }, /Unknown model: hui-e2e\/missing/u],
    [{ name: "Ada", cwd: join(dir, "missing") }, /No such directory/u],
  ] as const) {
    const refused = await call("/__hui/bots", "POST", body);
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.match(String(refused.body["error"]), pattern);
  }
  assert.deepEqual((await call("/__hui/bots")).body, { bots: [] }, "a refused create leaves nothing");

  const created = await call("/__hui/bots", "POST", { name: "Ada", title: "Researcher", instructions: "You are Ada." });
  assert.equal(created.status, 201);
  const ada = botOf(created);
  assert.equal(ada.handle, "ada");
  assert.equal(ada.cwd, join(dir, "config", "hui", "bots", ada.id));
  assert.equal(ada.routines, 0);
  assert.equal(ada.memory, undefined, "no OptChat in this build yet");
  assert.equal(botOf(await call("/__hui/bots", "POST", { name: "Bob", avatar: { emoji: "🐻" } })).handle, "bob");
  assert.deepEqual(((await call("/__hui/bots")).body["bots"] as BotView[]).map((bot) => bot.handle), ["ada", "bob"]);
  assert.equal(botOf(await call(`/__hui/bots/${ada.id}`)).handle, "ada");
  assert.equal(botOf(await call("/__hui/bots/bob")).avatar?.emoji, "🐻", "a handle addresses a bot too");
  assert.equal((await call("/__hui/bots/nobody")).status, 404);
  assert.equal((await call("/__hui/bots/ada", "PUT", {})).status, 405);
  assert.equal((await call("/__hui/bots/ada/restore", "GET")).status, 405);

  // The chat is an ordinary Durable session that names its bot.
  const sessions = (await call("/__hui/sessions")).body["groups"] as Array<{ sessions: Array<{ id: string; tool: string; title: string; bot?: unknown }> }>;
  const chat = sessions.flatMap((group) => group.sessions).find((session) => session.id === ada.sessionId);
  assert.deepEqual([chat?.tool, chat?.title, chat?.bot], ["durable", "Ada", { id: ada.id, handle: "ada", name: "Ada" }]);

  assert.equal(botOf(await call("/__hui/bots/ada", "PATCH", { title: "Lead" })).title, "Lead");
  assert.equal((await call("/__hui/bots/ada", "PATCH", {})).status, 400);
  assert.equal((await call("/__hui/bots/ada", "PATCH", { handle: "bob" })).status, 409);

  // Memory needs OptChat; until this build wires it, the routes say so (and still validate their input first).
  assert.equal((await call("/__hui/bots/ada/memory")).status, 503);
  assert.equal((await call("/__hui/bots/ada/memory/zoom?id=0&n=1")).status, 503);
  assert.equal((await call("/__hui/bots/ada/memory/zoom?id=x&n=1")).status, 400);
  assert.equal((await call("/__hui/bots/ada/memory/html")).status, 503);

  // A forever chat refuses what would reset, shorten, fork or delete it.
  for (const [path, method, body] of [["clear", "POST", {}], ["compact", "POST", {}], ["rewind", "POST", { entryId: "1" }]] as const) {
    const refused = await call(`/__hui/sessions/${ada.sessionId}/${path}`, method, body);
    assert.equal(refused.status, 409, path);
    assert.match(String(refused.body["error"]), /@ada's forever chat/u);
  }
  const deleted = await call(`/__hui/sessions/${ada.sessionId}`, "DELETE");
  assert.equal(deleted.status, 409);
  assert.match(String(deleted.body["error"]), /archive the bot instead/u);

  const archived = await call("/__hui/bots/bob", "DELETE");
  assert.equal(archived.status, 200);
  assert.equal(botOf(archived).archived, true);
  assert.deepEqual(((await call("/__hui/bots")).body["bots"] as BotView[]).map((bot) => bot.handle), ["ada"]);
  assert.deepEqual(((await call("/__hui/bots?archived=1")).body["bots"] as BotView[]).map((bot) => bot.handle), ["bob"]);
  assert.equal((await call("/__hui/bots/bob/messages", "POST", { text: "hello?" })).status, 409);
  assert.equal(botOf(await call("/__hui/bots/bob/restore", "POST", {})).archived, undefined);
});

test("messages reach the chat, a wait returns the reply, and message_bot crosses to another bot", { timeout: 120_000 }, async () => {
  const bots = (await call("/__hui/bots")).body["bots"] as BotView[];
  const ada = bots.find((bot) => bot.handle === "ada")!;
  const bob = bots.find((bot) => bot.handle === "bob")!;
  for (const [body, pattern] of [
    [{}, /A message is required/u],
    [{ text: "/clear" }, /\/clear is a HUI command/u],
    [{ text: "hi", timeoutSeconds: 5 }, /timeoutSeconds needs wait/u],
    [{ text: "hi", wait: "yes" }, /wait must be a boolean/u],
    [{ text: "hi", tone: "warm" }, /Unknown message field/u],
  ] as const) {
    const refused = await call("/__hui/bots/ada/messages", "POST", body);
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.match(String(refused.body["error"]), pattern);
  }
  const answered = await call("/__hui/bots/ada/messages", "POST", { text: "hello there", wait: true, timeoutSeconds: 60 });
  assert.equal(answered.status, 200);
  assert.deepEqual(answered.body, { status: "answered", reply: "Fixture response." });

  const relayed = await call("/__hui/bots/ada/messages", "POST", { text: "E2E_MESSAGE_BOT say hello to bob", wait: true, timeoutSeconds: 60 });
  assert.deepEqual(relayed.body, { status: "answered", reply: "message_bot answered: Queued for @bob." });
  await settledWith(bob.sessionId, (entries) => says("user", "[from @ada] hello from the fixture")(entries) && says("assistant", "Fixture response.")(entries));

  const sent = await call("/__hui/bots/ada/messages", "POST", { text: "no need to wait" });
  assert.equal(sent.status, 202);
  assert.deepEqual(sent.body, { status: "sent" });
  await settledWith(ada.sessionId, says("user", "no need to wait"));
  assert.equal(botOf(await call("/__hui/bots/ada/stop", "POST", {})).status, "idle", "stopping an idle bot changes nothing");
  const view = botOf(await call("/__hui/bots/ada"));
  assert.equal(view.lastMessage?.role, "assistant");
  assert.equal(view.lastMessage?.text, "Fixture response.");
});

test("a routine runs marked as one, and archiving the bot disables it", { timeout: 120_000 }, async () => {
  const ada = botOf(await call("/__hui/bots/ada"));
  const created = await call("/__hui/automation/tasks", "POST", {
    name: "Morning", sessionId: ada.sessionId, prompt: "status report", schedule: { kind: "every", everyMs: 3_600_000 },
  });
  assert.equal(created.status, 201);
  const task = created.body["task"] as { id: string };
  assert.equal(botOf(await call("/__hui/bots/ada")).routines, 1);
  assert.equal((await call(`/__hui/automation/tasks/${task.id}/run`, "POST", {})).status, 202);
  await settledWith(ada.sessionId, (entries) => {
    const index = entries.findIndex((entry) => entry.kind === "message" && entry.role === "user" && entry.text === "[routine: Morning] status report");
    return index >= 0 && entries.slice(index + 1).some((entry) => entry.kind === "message" && entry.role === "assistant");
  });

  assert.equal(botOf(await call("/__hui/bots/ada", "DELETE")).archived, true);
  const tasks = (await call("/__hui/automation")).body["tasks"] as Array<{ id: string; enabled: boolean }>;
  assert.equal(tasks.find((each) => each.id === task.id)?.enabled, false);
  assert.equal(botOf(await call("/__hui/bots/ada/restore", "POST", {})).routines, 1);
  assert.equal(((await call("/__hui/automation")).body["tasks"] as Array<{ id: string; enabled: boolean }>).find((each) => each.id === task.id)?.enabled, false, "restoring leaves it off");
});

test("the bot list streams: the whole list first, then the bots that changed", { timeout: 60_000 }, async () => {
  const stop = new AbortController();
  const response = await fetch(`${origin}/__hui/bots/events`, { headers: { "x-hui": "1" }, signal: stop.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/u);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const next = async (): Promise<BotsUpdate> => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (frame.startsWith("event: bots")) return JSON.parse(frame.slice(frame.indexOf("data: ") + 6)) as BotsUpdate;
        continue;
      }
      const { value, done } = await reader.read();
      assert.equal(done, false);
      buffer += decoder.decode(value, { stream: true });
    }
  };
  const first = await next();
  assert.deepEqual(first.upserts.map((bot) => bot.handle).toSorted(), ["ada", "bob"]);
  assert.deepEqual(first.ids?.length, 2);
  await call("/__hui/bots/bob", "PATCH", { title: "Helper" });
  const changed = await next();
  assert.deepEqual(changed.upserts.map((bot) => [bot.handle, bot.title]), [["bob", "Helper"]]);
  assert.equal(changed.ids, undefined, "membership did not change");
  assert.ok(changed.revision > first.revision);
  stop.abort();
  await reader.cancel().catch(() => {});
});
