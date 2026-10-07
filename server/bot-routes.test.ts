import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { botKickoffName, type BotMemoryStatus, type BotsUpdate, type BotView } from "../shared/bots.ts";
import type { BotIO } from "../cli/bots.ts";
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
  baseUrl: providerUrl, api: "anthropic-messages", apiKey: "fixture-key", models: ["fixture", "other"].map((id) => ({
    id, name: id, reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  })),
} } }));
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture", defaultThinkingLevel: "low" }));

const { middleware, startBackend, stopBackend } = await import("./hui.ts");
const { liveSessions } = await import("./live-sessions.ts");
const { readRegistry } = await import("./sessions.ts");
const { durableHost } = await import("./runtimes/durable-host.ts");
const { optChatBotMemory } = await import("./bot-memory.ts");
const { botChat } = await import("../cli/bots.ts");
const { HUI_SETTINGS_FILE } = await import("./hui-settings.ts");
const { BotDoc } = await import("./runtimes/durable-bots.ts");
const { OptChatDoc } = await import("./runtimes/durable-optchat.ts");
const { durableContext } = await import("./runtimes/durable-host.ts");
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

async function call(path: string, method = "GET", body?: unknown, guard = true): Promise<{ status: number; body: Record<string, unknown>; text: string; type: string; headers: Headers }> {
  const response = await fetch(origin + path, {
    method,
    headers: { ...(guard ? { "x-hui": "1" } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* html */ }
  return { status: response.status, body: parsed, text, type: response.headers.get("content-type") ?? "", headers: response.headers };
}

const botOf = (reply: { body: Record<string, unknown> }) => reply.body["bot"] as BotView;
const EMPTY_MEMORY = { messages: 0, built: 0, pending: 0, viewBytes: 0, viewLines: 0, usage: { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } };

/** Resolves with a bot's memory status once `done` holds, as OptChat reports each change. */
async function memoryWhere(sessionId: string, done: (status: BotMemoryStatus) => boolean): Promise<BotMemoryStatus> {
  const reference = (await readRegistry()).find((record) => record.id === sessionId)?.piSessionFile;
  assert(reference, `no conversation for ${sessionId}`);
  return new Promise((resolve) => {
    let off = (): void => {};
    off = optChatBotMemory(durableHost()).subscribe(reference, (status) => {
      if (!done(status)) return;
      off();
      resolve(status);
    });
  });
}

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

/** Every request the provider received, compactor calls included. */
async function providerRequests(): Promise<Array<{ model?: string; system?: unknown; messages?: unknown }>> {
  return (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { model?: string; system?: unknown; messages?: unknown });
}

const says = (role: "user" | "assistant", text: string) => (entries: TranscriptEntry[]) =>
  entries.some((entry) => entry.kind === "message" && entry.role === role && entry.text.includes(text));

test("bots are created, read, edited, archived and restored through the guarded routes", { timeout: 120_000 }, async () => {
  assert.equal((await call("/__hui/bots", "GET", undefined, false)).status, 403, "the local-client guard applies");
  assert.deepEqual((await call("/__hui/bots")).body, { bots: [] });
  for (const [body, pattern] of [
    [{ name: "Ada", nickname: "x" }, /Unknown bot field: nickname/u],
    [{ name: "Ada", model: "hui-e2e/missing" }, /Unknown model: hui-e2e\/missing/u],
    [{ name: "Ada", cwd: join(dir, "missing") }, /No such directory/u],
    [{ name: "Ada", worker: "nowhere" }, /No worker named nowhere/u],
    [{ name: "Ada", instructions: "You are Ada." }, /no instructions any more: a bot's persona is its SOUL\.md/u],
    [{ name: "Ada", soul: "s".repeat(20_001) }, /SOUL\.md must be at most 20000 characters/u],
  ] as const) {
    const refused = await call("/__hui/bots", "POST", body);
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.match(String(refused.body["error"]), pattern);
  }
  assert.deepEqual((await call("/__hui/bots")).body, { bots: [] }, "a refused create leaves nothing");

  // These bots get a soul at creation, so no first-conversation turn runs beside the turns these tests start.
  const created = await call("/__hui/bots", "POST", { name: "Ada", title: "Researcher", soul: "# Who I am\nYou are Ada." });
  assert.equal(created.status, 201);
  const ada = botOf(created);
  assert.equal(ada.handle, "ada");
  assert.equal(ada.cwd, join(dir, "config", "hui", "bots", ada.id));
  assert.equal(ada.soul, true);
  assert.equal(await readFile(join(ada.cwd, "SOUL.md"), "utf8"), "# Who I am\nYou are Ada.\n");
  assert.equal(ada.routines, 0);
  assert.deepEqual(ada.memory, EMPTY_MEMORY, "its chat has OptChat memory from the start");
  assert.equal(botOf(await call("/__hui/bots", "POST", { name: "Bob", avatar: { emoji: "🐻" }, soul: "You are Bob." })).handle, "bob");
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
  const moved = await call("/__hui/bots/ada", "PATCH", { worker: "devbox" });
  assert.deepEqual([moved.status, moved.body["error"]], [400, "A bot stays on the machine it was created on."]);
  assert.equal(botOf(await call("/__hui/bots/ada")).worker, undefined, "a bot made here runs here");
  // The look: a face's shape and color beside the emoji; "" clears one key (emoji: "" switches to the face), null all.
  assert.deepEqual(botOf(await call("/__hui/bots/bob", "PATCH", { avatar: { shape: "heart", color: "#2FC49A" } })).avatar, { emoji: "🐻", color: "#2fc49a", shape: "heart" });
  assert.deepEqual(botOf(await call("/__hui/bots/bob", "PATCH", { avatar: { emoji: "" } })).avatar, { color: "#2fc49a", shape: "heart" });
  assert.deepEqual(botOf(await call("/__hui/bots/bob")).avatar, { color: "#2fc49a", shape: "heart" }, "kept in bots.json");
  assert.deepEqual(botOf(await call("/__hui/bots/bob", "PATCH", { avatar: { shape: "" } })).avatar, { color: "#2fc49a" });
  const shapeRefused = await call("/__hui/bots/bob", "PATCH", { avatar: { shape: "star" } });
  assert.equal(shapeRefused.status, 400);
  assert.match(String(shapeRefused.body["error"]), /Avatar shape must be one of: blob, round, triangle, heart, cookie/u);
  assert.equal(botOf(await call("/__hui/bots/bob", "PATCH", { avatar: null })).avatar, undefined);
  assert.equal((await call("/__hui/bots/ada", "PATCH", { handle: "bob" })).status, 409);

  // An empty memory: nothing to zoom into yet; the routes validate their input first.
  assert.deepEqual((await call("/__hui/bots/ada/memory")).body, { status: EMPTY_MEMORY, view: "<chat>\n\n</chat>" });
  assert.deepEqual((await call("/__hui/bots/ada/memory/zoom?id=0&n=1")).body, { text: "No line 0+1." });
  assert.equal((await call("/__hui/bots/ada/memory/zoom?id=x&n=1")).status, 400);
  assert.equal((await call("/__hui/bots/nobody/memory")).status, 404);
  assert.equal((await call("/__hui/bots/ada/memory", "POST", {})).status, 405);

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

test("a bot's memory is OptChat's: built summaries, the view, zoom down to a whole message, and its page", { timeout: 120_000 }, async () => {
  const mem = botOf(await call("/__hui/bots", "POST", { name: "Mem", soul: "You are Mem." }));
  // Over 512 bytes, so the compactor writes its line; the reply and the second message fit as they are.
  const long = `OPT_MEM <b>keep</b> ${"the blue door opens at nine ".repeat(20).trim()}`;
  for (const text of [long, "second message"]) {
    assert.deepEqual((await call("/__hui/bots/mem/messages", "POST", { text, wait: true, timeoutSeconds: 60 })).body, { status: "answered", reply: "Fixture response." });
  }
  // The log catches up and the compactor finishes beside the chat: wait until OptChat reports it.
  await memoryWhere(mem.sessionId, (status) => status.messages === 4 && status.pending === 0);
  const lines = ["user: FIXTURE_MEMORY OPT_MEM", "talk: Fixture response.", "user: second message", "talk: Fixture response."];
  const memory = await call("/__hui/bots/mem/memory");
  assert.equal(memory.status, 200);
  assert.deepEqual(memory.body, {
    status: { messages: 4, built: 7, pending: 0, viewBytes: Buffer.byteLength(lines.join("")), viewLines: 4, usage: { calls: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 } },
    view: `<chat>\n${lines.map((line, index) => `${index}+1|${line}`).join("\n")}\n</chat>`,
  }, "the long message is a summary line written by one compactor call; the rest are their own lines");
  assert.deepEqual(botOf(await call("/__hui/bots/mem")).memory, memory.body["status"], "the bot's view carries the same status");

  // From the top of the tree down to the original message.
  assert.deepEqual((await call("/__hui/bots/mem/memory/zoom?id=0&n=4")).body, { text: `0+2|${lines[0]} ${lines[1]}\n2+2|${lines[2]} ${lines[3]}` });
  assert.deepEqual((await call("/__hui/bots/mem/memory/zoom?id=0&n=2")).body, { text: `0+1|${lines[0]}\n1+1|${lines[1]}` });
  assert.deepEqual((await call("/__hui/bots/mem/memory/zoom?id=0&n=1")).body, { text: `0+0|user: ${long}` }, "the whole message, word for word");
  assert.deepEqual((await call("/__hui/bots/mem/memory/zoom?id=8&n=1")).body, { text: "No line 8+1." });

  // The browse page: the view, every message and each level, escaped, under a policy that runs and frames nothing.
  const page = await call("/__hui/bots/mem/memory/html");
  assert.equal(page.status, 200);
  assert.equal(page.type, "text/html; charset=utf-8");
  assert.match(page.text, /<title>OptChat memory of Mem<\/title>/u);
  assert.match(page.text, /<h2>View · 4 lines<\/h2>[\s\S]*<h2>ROOT · 4 messages<\/h2>[\s\S]*<h2>Level 2 · 1 nodes<\/h2>/u);
  assert.match(page.text, /&lt;b&gt;keep&lt;\/b&gt; the blue door/u);
  assert.doesNotMatch(page.text, /<b>keep<\/b>/u, "chat text never becomes markup");
  assert.deepEqual(Object.fromEntries(["content-security-policy", "x-content-type-options", "cache-control", "cross-origin-resource-policy"].map((name) => [name, page.headers.get(name)])), {
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    "cross-origin-resource-policy": "same-origin",
  });
});

test("a bot's memory page opens from a same-origin link, which cannot send x-hui; everything cross-site is refused", { timeout: 60_000 }, async () => {
  const load = (path: string, headers: Record<string, string>, method = "GET") => fetch(origin + path, { method, headers });
  const linked = await load("/__hui/bots/mem/memory/html", { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" });
  assert.equal(linked.status, 200, "a link on HUI's own page");
  assert.match(await linked.text(), /<title>OptChat memory of Mem<\/title>/u);
  assert.match(linked.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/u);
  for (const site of ["cross-site", "same-site", "none"]) {
    const refused = await load("/__hui/bots/mem/memory/html", { "sec-fetch-site": site });
    assert.equal(refused.status, 403, site);
    assert.deepEqual(await refused.json(), { error: "missing x-hui header" });
  }
  assert.equal((await load("/__hui/bots/mem/memory/html", {})).status, 403, "no browser attestation at all");
  assert.equal((await load("/__hui/bots/mem/memory/html", { "sec-fetch-site": "same-origin" }, "POST")).status, 405, "the page is read-only");
  assert.equal((await load("/__hui/bots/nobody/memory/html", { "sec-fetch-site": "same-origin" })).status, 404);
  // Only the page: every other bot route still needs x-hui.
  for (const path of ["/__hui/bots/mem/memory", "/__hui/bots/mem/memory/zoom?id=0&n=1", "/__hui/bots/mem", "/__hui/bots"]) {
    assert.equal((await load(path, { "sec-fetch-site": "same-origin" })).status, 403, path);
  }
});

test("clearing a bot's model and thinking puts its live chat back on the gateway defaults, as a new chat", { timeout: 120_000 }, async () => {
  const chosen = botOf(await call("/__hui/bots/mem", "PATCH", { model: "hui-e2e/other", thinking: "high" }));
  assert.deepEqual([chosen.model, chosen.thinking], ["hui-e2e/other", "high"]);
  assert.deepEqual([liveSessions.snapshot(chosen.sessionId).model?.id, liveSessions.currentThinking(chosen.sessionId)], ["other", "high"]);

  const cleared = await call("/__hui/bots/mem", "PATCH", { model: "", thinking: "" });
  assert.equal(cleared.status, 200);
  assert.deepEqual([botOf(cleared).model, botOf(cleared).thinking], [undefined, undefined], "no choice of its own: the default");
  assert.deepEqual([liveSessions.snapshot(chosen.sessionId).model?.id, liveSessions.currentThinking(chosen.sessionId)], ["fixture", "low"], "PI's default model and level");
  const record = (await readRegistry()).find((each) => each.id === chosen.sessionId);
  assert.deepEqual([record?.model, record?.thinking], [undefined, undefined], "its chat's record keeps no choice either");
  assert.deepEqual((await call("/__hui/bots/mem/messages", "POST", { text: "OPT_RESET after clearing", wait: true, timeoutSeconds: 60 })).body, { status: "answered", reply: "Fixture response." });
  const turn = (await providerRequests()).findLast((request) => JSON.stringify(request.messages).includes("OPT_RESET after clearing") && !JSON.stringify(request.system).includes("You write the memory of"));
  assert.equal(turn?.model, "fixture", "its next turn asks the default model");

  for (const [body, pattern] of [[{ model: "gpt" }, /provider\/id/u], [{ model: "hui-e2e/missing" }, /Unknown model/u], [{ thinking: "loud" }, /Thinking level/u]] as const) {
    const refused = await call("/__hui/bots/mem", "PATCH", body);
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.match(String(refused.body["error"]), pattern);
  }
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

/** A scripted terminal for `hui bot chat`: lines the test types, and everything written. */
function terminal() {
  let out = "";
  const watchers = new Set<() => void>();
  const queued: string[] = [];
  let ended = false;
  let wake: (() => void) | undefined;
  const written = (text: string) => {
    out += text;
    for (const watcher of [...watchers]) watcher();
  };
  const io: BotIO = {
    out: written,
    err: written,
    readStdin: async () => "",
    lines: () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          while (!queued.length && !ended) await new Promise<void>((resolve) => { wake = resolve; });
          return queued.length ? { done: false, value: queued.shift()! } : { done: true, value: undefined };
        },
        return: async () => { ended = true; wake?.(); return { done: true, value: undefined }; },
      }),
    }),
    onInterrupt: () => () => {},
    interactive: false,
    ask: async () => "",
    cwd: dir,
    timezone: "UTC",
  };
  return {
    io,
    get out() { return out; },
    type: (line: string) => { queued.push(line); wake?.(); },
    end: () => { ended = true; wake?.(); },
    /** Resolves once what was written matches. */
    until: (pattern: RegExp) => new Promise<void>((resolve) => {
      const check = () => {
        if (!pattern.test(out)) return;
        watchers.delete(check);
        resolve();
      };
      watchers.add(check);
      check();
    }),
  };
}

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
  assert.deepEqual(first.upserts.map((bot) => bot.handle).toSorted(), ["ada", "bob", "mem"]);
  assert.deepEqual(first.ids?.length, 3);
  await call("/__hui/bots/bob", "PATCH", { title: "Helper" });
  const changed = await next();
  assert.deepEqual(changed.upserts.map((bot) => [bot.handle, bot.title]), [["bob", "Helper"]]);
  assert.equal(changed.ids, undefined, "membership did not change");
  assert.ok(changed.revision > first.revision);
  stop.abort();
  await reader.cancel().catch(() => {});
});

test("a bot's voice is its language and call voice, and VoiceStudio's routes and voice fields are gone", { timeout: 60_000 }, async () => {
  const created = await call("/__hui/bots", "POST", { name: "Vox", voice: { language: "ES", live: "Sol" } });
  assert.equal(created.status, 201);
  assert.deepEqual(botOf(created).voice, { language: "es", live: "sol" });
  for (const voice of [{ profile: "vp-aria" }, { speed: 1.25 }]) {
    const refused = await call("/__hui/bots", "POST", { name: "Vox 2", voice });
    assert.equal(refused.status, 400, JSON.stringify(voice));
    assert.match(String(refused.body["error"]), /^Unknown voice field: (?:profile|speed)\.$/u);
    assert.equal((await call("/__hui/bots/vox", "PATCH", { voice })).status, 400, JSON.stringify(voice));
  }
  assert.deepEqual(botOf(await call("/__hui/bots/vox", "PATCH", { voice: { language: "" } })).voice, { live: "sol" }, "back to Auto");
  assert.deepEqual(botOf(await call("/__hui/bots/vox")).voice, { live: "sol" }, "stored, not just echoed");
  assert.equal(botOf(await call("/__hui/bots/vox", "PATCH", { voice: null })).voice, undefined);
  // The VoiceStudio connection, its voices, speech and transcription: no routes answer for them.
  for (const [path, method] of [
    ["/__hui/voice", "GET"], ["/__hui/voice", "PUT"], ["/__hui/voice", "DELETE"], ["/__hui/voices", "GET"],
    ["/__hui/voice/voices", "GET"], ["/__hui/voice/speech", "POST"], ["/__hui/voice/transcriptions", "POST"],
  ] as const) {
    assert.equal((await call(path, method, method === "PUT" || method === "POST" ? { url: "http://127.0.0.1:9", text: "hi" } : undefined)).status, 404, `${method} ${path}`);
  }
});

// Last: hui bot chat also follows the bot list, whose cached frame would otherwise lead the stream test.
test("hui bot chat shows what the bot gets from elsewhere before its reply, and never repeats what was typed in it", { timeout: 120_000 }, async () => {
  const bob = botOf(await call("/__hui/bots/bob"));
  const term = terminal();
  const chat = botChat(origin, bob, term.io);
  await term.until(/^Chatting with @bob \(Bob\)\. .*\n@bob: Fixture response\.\n$/u);
  // A typed line goes out once the live stream is attached, so its reply also proves the stream is.
  term.type("hello from the terminal");
  await term.until(/\n@bob: Fixture response\.\n@bob: Fixture response\.\n$/u);

  // A message from another client (the Bots tab, hui bot send), then a routine: each shown as a user line first.
  assert.deepEqual((await call("/__hui/bots/bob/messages", "POST", { text: "sent from elsewhere", wait: true, timeoutSeconds: 60 })).body, { status: "answered", reply: "Fixture response." });
  await term.until(/\n> sent from elsewhere\n@bob: Fixture response\.\n$/u);
  const created = await call("/__hui/automation/tasks", "POST", { name: "Ping", sessionId: bob.sessionId, prompt: "ping", schedule: { kind: "every", everyMs: 3_600_000 } });
  const task = created.body["task"] as { id: string };
  assert.equal((await call(`/__hui/automation/tasks/${task.id}/run`, "POST", {})).status, 202);
  await term.until(/\n> \[routine: Ping\] ping\n@bob: Fixture response\.\n$/u);
  term.end();
  assert.equal(await chat, 0);
  assert.doesNotMatch(term.out, /> hello from the terminal/u, "a line typed here is on screen already");
  await settledWith(bob.sessionId, says("user", "[routine: Ping] ping"));
});


test("settings.json saved while HUI had VoiceStudio loads, and the next save leaves its fields out", { timeout: 30_000 }, async () => {
  const before = await readFile(HUI_SETTINGS_FILE, "utf8").catch(() => undefined);
  await mkdir(dirname(HUI_SETTINGS_FILE), { recursive: true });
  await writeFile(HUI_SETTINGS_FILE, JSON.stringify({ profileName: "Dani", voice: { sendNotesImmediately: true }, calls: { engine: "voicestudio", voice: "sol" } }));
  try {
    const loaded = await call("/__hui/settings");
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body["voice"], undefined, "no voice-notes switch");
    assert.deepEqual(loaded.body["calls"], { voice: "sol" }, "no engine; the default call voice stays");
    assert.equal(loaded.body["profileName"], "Dani");
    assert.equal((await call("/__hui/settings", "PUT", loaded.body)).status, 200);
    const saved = JSON.parse(await readFile(HUI_SETTINGS_FILE, "utf8")) as Record<string, unknown>;
    assert.deepEqual([saved["profileName"], saved["calls"], "voice" in saved], ["Dani", { voice: "sol" }, false]);
    assert.doesNotMatch(JSON.stringify(saved), /sendNotesImmediately|engine|voicestudio/u);
  } finally {
    if (before === undefined) await rm(HUI_SETTINGS_FILE, { force: true });
    else await writeFile(HUI_SETTINGS_FILE, before);
  }
});

test("call routes take the x-hui guard like every other route, and say what calls need here", { timeout: 60_000 }, async () => {
  const offer = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
  for (const [path, method] of [["/__hui/calls", "GET"], ["/__hui/bots/mem/calls", "POST"], ["/__hui/bots/mem/calls/0f8fad5b-d9cb-469f-a165-70867728950e/lines", "POST"], ["/__hui/bots/mem/calls/0f8fad5b-d9cb-469f-a165-70867728950e", "DELETE"]] as const) {
    const refused = await call(path, method, method === "POST" ? { sdp: offer } : undefined, false);
    assert.equal(refused.status, 403, path);
    assert.deepEqual(refused.body, { error: "missing x-hui header" }, path);
  }
  const status = await call("/__hui/calls");
  assert.equal(status.status, 200);
  assert.deepEqual(status.body["chatgpt"], { signedIn: false }, "this gateway has no ChatGPT login");
  // Calls run on GPT-Live only, whatever settings.json says: without a ChatGPT login there is no call, and the gateway
  // says where to sign in.
  const unavailable = await call("/__hui/bots/mem/calls", "POST", { sdp: offer });
  assert.equal(unavailable.status, 409);
  assert.equal(unavailable.body["error"], "Sign in to ChatGPT in Settings → Models (OpenAI Codex) to call bots with GPT-Live.");
  assert.equal((await call("/__hui/bots/mem/calls/0f8fad5b-d9cb-469f-a165-70867728950e/heartbeat", "POST")).status, 404, "no such call");
});

test("deleting a bot, active or archived, removes its routines, its chat, its memory and its whole folder", { timeout: 120_000 }, async () => {
  const cleo = botOf(await call("/__hui/bots", "POST", { name: "Cleo", soul: "You are Cleo." }));
  await call("/__hui/bots/cleo/messages", "POST", { text: "OPT_CLEO remember the red door", wait: true, timeoutSeconds: 60 });
  await writeFile(join(cleo.cwd, "MEMORY.md"), "Cleo's own notes");
  const reference = (await readRegistry()).find((record) => record.id === cleo.sessionId)?.piSessionFile;
  assert(reference);
  const created = await call("/__hui/automation/tasks", "POST", {
    name: "Evening", sessionId: cleo.sessionId, prompt: "wrap up", schedule: { kind: "every", everyMs: 3_600_000 },
  });
  assert.equal(created.status, 201);
  const task = created.body["task"] as { id: string };
  assert.equal(botOf(await call("/__hui/bots/cleo", "DELETE")).archived, true, "without permanent=1 a DELETE archives");
  assert.deepEqual((await call("/__hui/bots/cleo/soul")).body, { soul: "You are Cleo." }, "archiving keeps SOUL.md");
  assert.equal(botOf(await call("/__hui/bots/cleo/restore", "POST", {})).archived, undefined);
  // Active: no need to archive first.
  const deleted = await call(`/__hui/bots/${cleo.id}?permanent=1`, "DELETE");
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { ok: true });
  assert.equal((await call(`/__hui/bots/${cleo.id}`)).status, 404);
  assert.equal(((await call("/__hui/bots?archived=1")).body["bots"] as BotView[]).some((bot) => bot.id === cleo.id), false);
  assert.equal((await readRegistry()).some((record) => record.id === cleo.sessionId), false, "its chat's session record is gone");
  assert.equal(((await call("/__hui/automation")).body["tasks"] as Array<{ id: string }>).some((each) => each.id === task.id), false, "and its routine");
  await assert.rejects(stat(cleo.cwd), { code: "ENOENT" }, "its whole folder went: SOUL.md and its own files");
  const id = Number(reference.slice("durable:".length)) as never;
  const harness = await durableHost().open();
  assert.deepEqual(await harness.snapshot(BotDoc, id, durableContext), { bot: "" }, "its conversation is no bot's chat any more");
  assert.equal((await harness.snapshot(OptChatDoc, id, durableContext))?.enabled, false, "and its memory is off");
  await assert.rejects(stat(join(dir, "config", "hui", "durable", "optchat", String(id))), { code: "ENOENT" }, "OptChat's files are gone");
  assert.equal((await call(`/__hui/bots/${cleo.id}?permanent=1`, "DELETE")).status, 404);
});

test("a bot whose worker is offline answers 503, like a memory HUI cannot read", async () => {
  const { botErrorStatus } = await import("./bot-routes.ts");
  const { BotWorkerOfflineError } = await import("./bots.ts");
  const { BotMemoryUnavailableError } = await import("./bot-memory.ts");
  assert.equal(botErrorStatus(new BotWorkerOfflineError("devbox, where this bot runs, is offline.")), 503);
  assert.equal(botErrorStatus(new BotMemoryUnavailableError()), 503);
});

/** The chat requests the provider got (OptChat's compactor calls left out). */
async function chatRequests(): Promise<Array<{ model?: string; system?: unknown; messages?: unknown }>> {
  return (await providerRequests()).filter((request) => !JSON.stringify(request.system).includes("You write the memory of"));
}

test("a bot without a soul speaks first on the primary model, writes SOUL.md itself with write_soul, and every request carries it", { timeout: 120_000 }, async (t) => {
  // Settings' primary model, which a bot without a model of its own starts on, as a new session does.
  const settingsFile = join(dir, "config", "hui", "settings.json");
  await writeFile(settingsFile, JSON.stringify({ models: { primary: "hui-e2e/other" } }));
  t.after(() => rm(settingsFile, { force: true }));
  const created = await call("/__hui/bots", "POST", { name: "Nova" });
  assert.equal(created.status, 201);
  const nova = botOf(created);
  assert.equal(nova.soul, false);
  const home = join(dir, "config", "hui", "bots", nova.id);
  const soulPath = join(home, "SOUL.md");

  // HUI starts its first turn by itself: a kickoff the chat shows as a note, then the bot's opening question.
  const opened = await settledWith(nova.sessionId, says("assistant", "What would you like me to look after for you?"));
  const users = opened.filter((entry) => entry.kind === "message" && entry.role === "user");
  assert.equal(users.length, 1, "nobody typed anything");
  assert.equal(users[0]?.kind === "message" ? botKickoffName(users[0].text) : undefined, "Nova");
  // Nova's own kickoff: Vox, created without a soul by an earlier test, had one too.
  const first = (await chatRequests()).find((request) => JSON.stringify(request.messages).includes("[HUI bot created]\\nname: Nova\\n"));
  assert.ok(first, "the kickoff reached the model");
  assert.equal(first.model, "other", "on Settings' primary model, not PI's default");
  const firstSystem = JSON.stringify(first.system);
  assert.ok(firstSystem.includes(JSON.stringify(`<soul>\nYou have no soul yet: ${soulPath} does not exist.`).slice(1, -1)), "the first conversation, with where to write SOUL.md");
  assert.match(firstSystem, /greet the operator in a sentence and ask what they expect from you/u, "Settings has no profile name here");
  assert.equal(botOf(await call(`/__hui/bots/${nova.id}`)).lastMessage?.text, "Hi, I'm new here. What would you like me to look after for you?", "the list previews the opener, not the kickoff");
  assert.deepEqual((await call(`/__hui/bots/${nova.id}/soul`)).body, { soul: null });

  // The operator answers; the bot saves SOUL.md with write_soul, and the next request carries it.
  const wrote = await call(`/__hui/bots/${nova.id}/messages`, "POST", { text: "E2E_WRITE_SOUL keep my notes tidy", wait: true, timeoutSeconds: 60 });
  assert.deepEqual(wrote.body, { status: "answered", reply: "I wrote my SOUL.md. Change it in the Soul tab, or just tell me." });
  assert.equal(await readFile(soulPath, "utf8"), "# Who I am\nE2E_SOUL_TEXT: a terse fixture bot.\n");
  assert.deepEqual((await call(`/__hui/bots/${nova.id}/soul`)).body, { soul: "# Who I am\nE2E_SOUL_TEXT: a terse fixture bot." });
  assert.equal(botOf(await call(`/__hui/bots/${nova.id}`)).soul, true, "the list sees it once that turn settled");
  await call(`/__hui/bots/${nova.id}/messages`, "POST", { text: "SOUL_NEXT what now?", wait: true, timeoutSeconds: 60 });
  const next = JSON.stringify((await chatRequests()).findLast((request) => JSON.stringify(request.messages).includes("SOUL_NEXT"))?.system);
  assert.ok(next.includes(JSON.stringify(`<soul>\nYour soul is ${soulPath}, which you wrote with the operator`).slice(1, -1)));
  assert.match(next, /E2E_SOUL_TEXT: a terse fixture bot\.\\n<\/soul>/u, "SOUL.md itself closes the section");
  assert.doesNotMatch(next, /You have no soul yet/u);

  // The operator replaces it through the guarded route; an empty soul brings the first conversation back.
  for (const [body, pattern] of [
    [{ soul: "s".repeat(20_001) }, /at most 20000 characters/u],
    [{ soul: 7 }, /SOUL\.md must be text/u],
    [{ text: "x" }, /Unknown soul field: text/u],
    [{}, /soul is required/u],
    [[], /must be an object/u],
  ] as const) {
    const refused = await call(`/__hui/bots/${nova.id}/soul`, "PUT", body);
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.match(String(refused.body["error"]), pattern);
  }
  assert.equal((await call(`/__hui/bots/${nova.id}/soul`, "PUT", { soul: "x" }, false)).status, 403, "the local-client guard applies");
  assert.equal((await call(`/__hui/bots/${nova.id}/soul`, "POST", { soul: "x" })).status, 405);
  assert.equal((await call("/__hui/bots/nobody/soul")).status, 404);
  assert.equal(await readFile(soulPath, "utf8"), "# Who I am\nE2E_SOUL_TEXT: a terse fixture bot.\n", "refusals change nothing");
  assert.deepEqual((await call("/__hui/bots/nova/soul", "PUT", { soul: "# Who I am\r\nOPERATOR_SOUL, by hand.\n" })).body, { soul: "# Who I am\nOPERATOR_SOUL, by hand." });
  assert.equal(await readFile(soulPath, "utf8"), "# Who I am\nOPERATOR_SOUL, by hand.\n");
  await call("/__hui/bots/nova/messages", "POST", { text: "SOUL_AFTER_PUT", wait: true, timeoutSeconds: 60 });
  assert.match(JSON.stringify((await chatRequests()).findLast((request) => JSON.stringify(request.messages).includes("SOUL_AFTER_PUT"))?.system), /OPERATOR_SOUL, by hand\./u);
  assert.deepEqual((await call("/__hui/bots/nova/soul", "PUT", { soul: "" })).body, { soul: null });
  await assert.rejects(stat(soulPath), { code: "ENOENT" });
  assert.equal(botOf(await call("/__hui/bots/nova")).soul, false);
  await call("/__hui/bots/nova/messages", "POST", { text: "SOUL_GONE", wait: true, timeoutSeconds: 60 });
  assert.match(JSON.stringify((await chatRequests()).findLast((request) => JSON.stringify(request.messages).includes("SOUL_GONE"))?.system), /<soul>\\nYou have no soul yet/u);

  // A soul given at creation: no kickoff, and its first request already carries it.
  const given = botOf(await call("/__hui/bots", "POST", { name: "Given", soul: "# Who I am\nGIVEN_SOUL." }));
  assert.equal(given.soul, true);
  await call("/__hui/bots/given/messages", "POST", { text: "GIVEN_HELLO", wait: true, timeoutSeconds: 60 });
  const givenUsers = liveSessions.transcript(given.sessionId).filter((entry) => entry.kind === "message" && entry.role === "user");
  assert.deepEqual(givenUsers.map((entry) => entry.kind === "message" ? entry.text : ""), ["GIVEN_HELLO"], "no first turn of its own");
  assert.match(JSON.stringify((await chatRequests()).findLast((request) => JSON.stringify(request.messages).includes("GIVEN_HELLO"))?.system), /GIVEN_SOUL\./u);

  // Deleting removes SOUL.md (HUI's file), then the home folder, empty.
  await call("/__hui/bots/given/soul", "PUT", { soul: "kept until the delete" });
  await call("/__hui/bots/given", "DELETE");
  await call(`/__hui/bots/${given.id}?permanent=1`, "DELETE");
  await assert.rejects(stat(join(dir, "config", "hui", "bots", given.id)), { code: "ENOENT" });
});


test("a bot created without a name is New Bot, asks what to call it, and names itself with set_profile", { timeout: 120_000 }, async () => {
  const created = await call("/__hui/bots", "POST", {});
  assert.equal(created.status, 201);
  const fresh = botOf(created);
  assert.deepEqual([fresh.name, fresh.handle], ["New Bot", "new-bot"]);
  await settledWith(fresh.sessionId, says("assistant", "What would you like me to look after"));
  const kickoff = (await chatRequests()).findLast((request) => JSON.stringify(request.messages).includes("[HUI bot created]\\nname: New Bot\\n"));
  assert.ok(kickoff, "its own kickoff");
  assert.match(JSON.stringify(kickoff.system), /You have no name yet/u, "it asks for a name first");
  const named = await call(`/__hui/bots/${fresh.id}/messages`, "POST", { text: "E2E_SET_PROFILE call yourself Echo", wait: true, timeoutSeconds: 60 });
  assert.deepEqual(named.body, { status: "answered", reply: "set_profile answered: Saved: you are Echo (@echo), Fixture tester. Tell the operator." });
  const echo = botOf(await call("/__hui/bots/echo"));
  assert.deepEqual([echo.id, echo.name, echo.title], [fresh.id, "Echo", "Fixture tester"], "the derived handle followed the name");
  assert.equal((await readRegistry()).find((record) => record.id === fresh.sessionId)?.title, "Echo");
  await call("/__hui/bots/echo/messages", "POST", { text: "NAMED_TURN hello", wait: true, timeoutSeconds: 60 });
  const next = JSON.stringify((await chatRequests()).findLast((request) => JSON.stringify(request.messages).includes("NAMED_TURN"))?.system);
  assert.match(next, /You are @echo \(Echo\)/u);
  assert.doesNotMatch(next, /You have no name yet/u);
  await call(`/__hui/bots/${fresh.id}?permanent=1`, "DELETE");
});
