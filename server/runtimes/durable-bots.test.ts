import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test, type TestContext } from "node:test";
import { AgentDoc, defineDoc, type ConversationId, type ToolExecutionApi } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { normalizeSettings } from "../../src/lib/settings.ts";
import type { AgentToolInvocation } from "../agent-tools-bridge.ts";
import type { BotMemoryStatus } from "../../shared/bots.ts";
import type { BotMemory } from "../bot-memory.ts";
import type { DurableSession } from "./durable.ts";
import type { TranscriptEntry } from "./types.ts";

// HUI's configuration directory is resolved at import time; never the operator's own.
const configDir = await mkdtemp(join(tmpdir(), "hui-durable-bots-config-"));
process.env["XDG_CONFIG_HOME"] = configDir;
after(() => rm(configDir, { recursive: true, force: true }));
const { DurableHost, durableContext } = await import("./durable-host.ts");
const { startDurable, durableConversationId, durableReference } = await import("./durable.ts");
const { BotDoc, MESSAGE_BOT_TOOL, firstConversationSection, readSoulFile, soulSection } = await import("./durable-bots.ts");
const { OptChatDoc } = await import("./durable-optchat.ts");
const { durableBotConversations } = await import("../bot-conversations.ts");
const { BotMemoryUnavailableError, optChatBotMemory } = await import("../bot-memory.ts");
const { BotInputError } = await import("../bots.ts");
type DurableHost = import("./durable-host.ts").DurableHost;

/** Stands in for OptChat's document: written by `enable` inside the commit that creates the conversation. */
const MemoryMarker = defineDoc<{ name: string; model: string }>({
  kind: "test.bot-memory", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ name: "", model: "" }),
});

function fakeMemory(options: { failEnable?: boolean } = {}): BotMemory {
  return {
    enable: async (tx, conversationId, settings) => {
      if (options.failEnable) throw new Error("OptChat refused");
      const marker = await tx.doc(MemoryMarker, conversationId);
      marker.name = settings.name;
      marker.model = settings.model ?? "";
    },
    configure: async () => {},
    status: async () => undefined,
    view: async () => "",
    zoom: async () => "",
    html: async () => "",
    subscribe: () => () => {},
  };
}

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "hui-durable-bots-"));
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "workspace");
  await mkdir(agentDir);
  await mkdir(cwd);
  const log = join(dir, "requests.jsonl");
  const provider = spawn(process.execPath, [fileURLToPath(new URL("../../e2e/pi-provider-fixture.mjs", import.meta.url))], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HUI_E2E_PROVIDER_PORT: "0", HUI_E2E_WORKSPACE: cwd, HUI_E2E_PROVIDER_LOG: log },
  });
  const hosts: DurableHost[] = [];
  t.after(async () => {
    for (const host of hosts) await host.close().catch(() => {});
    const exit = once(provider, "exit");
    provider.kill();
    await exit;
    await rm(dir, { recursive: true, force: true });
  });
  const [ready] = await once(provider.stdout!, "data");
  const baseUrl = String(ready).match(/http:\/\/127\.0\.0\.1:\d+/u)?.[0];
  assert(baseUrl, String(ready));
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "hui-e2e": {
    baseUrl, api: "anthropic-messages", apiKey: "fixture-key", models: ["fixture", "cheap"].map((id) => ({
      id, name: id, reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  } } }));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture", defaultThinkingLevel: "low" }));
  const invocations: AgentToolInvocation[] = [];
  const host = new DurableHost({
    dir: join(dir, "store"), agentDir,
    readSettings: async () => normalizeSettings(undefined),
    invokeTool: async (invocation) => {
      invocations.push(invocation);
      return { text: "Queued for @bob." };
    },
    lookupCaller: async () => undefined,
  });
  host.botSection = async (botId) => `Roster for ${botId}: @bob (Bob).`;
  const homes = join(dir, "homes");
  host.botSouls = { home: (botId) => join(homes, botId), operator: async () => "Alex" };
  hosts.push(host);
  return { dir, cwd, log, host, invocations, homes };
}

type ProviderRequest = { model?: string; system?: unknown; tools?: Array<{ name?: string }>; messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }> };
async function requests(log: string): Promise<ProviderRequest[]> {
  return (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as ProviderRequest);
}

/** Resolves once the session settles with a transcript `predicate` accepts. */
function settledWith(session: DurableSession, predicate: (entries: TranscriptEntry[]) => boolean, timeoutMs = 30_000): Promise<TranscriptEntry[]> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (session.isStreaming || !predicate(session.transcript())) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(session.transcript());
    };
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Expected transcript never arrived: ${JSON.stringify(session.transcript())}`)); }, timeoutMs);
    const unsubscribe = session.subscribe((event) => { if (event.type === "settled") check(); });
    check();
  });
}

const answered = (text: string) => (entries: TranscriptEntry[]) =>
  entries.some((entry) => entry.kind === "message" && entry.role === "assistant" && entry.text.includes(text));

async function conversations(host: DurableHost): Promise<number> {
  const harness = await host.open();
  return harness.commit(async (tx) => (await tx.scanConversations({}, 1_000)).items.length, durableContext);
}

test("a plain conversation is offered no message_bot and no bots section; its requests are unchanged", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "plain" }, f.host);
  await session.prompt("plain turn");
  await settledWith(session, answered("Fixture response"));
  const [request] = await requests(f.log);
  assert.ok(request?.tools?.some((tool) => tool.name === "bash"), "the ordinary tools are offered");
  assert.ok(!request?.tools?.some((tool) => tool.name === MESSAGE_BOT_TOOL));
  assert.doesNotMatch(JSON.stringify(request?.system), /<bots>|Roster for|message_bot|<soul>|SOUL\.md/u);
  assert.ok(!(await session.inspect()).tools.some((tool) => tool.name === MESSAGE_BOT_TOOL));
  const harness = await f.host.open();
  const id = durableConversationId(session.sessionFile)!;
  assert.equal(await harness.snapshot(BotDoc, id, durableContext), undefined, "no bot document is written");
  const agent = await harness.snapshot(AgentDoc, id, durableContext);
  assert.equal(agent?.tools, undefined, "nothing is filtered: the stored agent is what it was before bots");
  assert.equal(agent?.extensions, undefined);
});

test("a bot's conversation is created in one commit with bot document and memory, offers message_bot, and reads SOUL.md on every request", { timeout: 90_000 }, async (t) => {
  const f = await fixture(t);
  const port = durableBotConversations(f.host, fakeMemory());
  const reference = await port.create({ botId: "bot-ada", cwd: f.cwd, memory: { name: "Ada", model: "hui-e2e/cheap" } });
  const id = durableConversationId(reference)!;
  const harness = await f.host.open();
  assert.deepEqual(await harness.snapshot(BotDoc, id, durableContext), { bot: "bot-ada" });
  assert.deepEqual(await harness.snapshot(MemoryMarker, id, durableContext), { name: "Ada", model: "hui-e2e/cheap" }, "memory is enabled in the creating commit");
  assert.equal((await (await harness.conversation(id, durableContext))!.agent(durableContext)).instructions, undefined, "no persona in the conversation: it is SOUL.md");
  const soulFile = join(f.homes, "bot-ada", "SOUL.md");
  await mkdir(join(f.homes, "bot-ada"), { recursive: true });
  await writeFile(soulFile, "# Who I am\nYou are Ada. Answer tersely.\n");

  const session = await startDurable({ cwd: f.cwd, sessionFile: reference, huiSessionId: "ada-chat" }, f.host);
  assert.deepEqual((await harness.snapshot(AgentDoc, id, durableContext))?.extensions, { add: ["hui-bots-tools"] }, "only a bot's chat selects message_bot");
  const inspection = await session.inspect();
  assert.equal(inspection.tools.find((tool) => tool.name === MESSAGE_BOT_TOOL)?.source, "HUI");
  await session.prompt("E2E_MESSAGE_BOT tell bob hello");
  await settledWith(session, answered("message_bot answered: Queued for @bob."));
  assert.deepEqual(f.invocations, [{ callerSessionId: "ada-chat", action: MESSAGE_BOT_TOOL, params: { to: "@bob", message: "hello from the fixture" } }]);
  const [first] = await requests(f.log);
  const system = JSON.stringify(first?.system);
  assert.ok(system.includes(JSON.stringify(`<soul>\n${soulSection(soulFile, "# Who I am\nYou are Ada. Answer tersely.")}\n</soul>`).slice(1, -1)), "the soul section: the file's path, then SOUL.md");
  assert.match(system, /<bots>\\nRoster for bot-ada: @bob \(Bob\)\.\\n<\/bots>/u, "the bots section, tagged");
  assert.ok(system.indexOf("<bots>") < system.indexOf("<soul>"), "the soul last, where a persona goes");
  assert.ok(first?.tools?.some((tool) => tool.name === MESSAGE_BOT_TOOL));
  assert.match(JSON.stringify(first?.system), /- message_bot: Message another bot of this HUI in its own chat/u, "listed with HUI's active tools");

  // The bot (or the operator) rewrites SOUL.md: the next request carries the new one. Without it, the first conversation.
  await writeFile(soulFile, "# Who I am\nYou are Ada. Be thorough.\n");
  await session.prompt("second turn");
  await settledWith(session, (entries) => entries.filter((entry) => entry.kind === "message" && entry.role === "assistant").length >= 2);
  const second = JSON.stringify((await requests(f.log)).at(-1)?.system);
  assert.match(second, /You are Ada\. Be thorough\./u);
  assert.doesNotMatch(second, /Answer tersely/u);
  await rm(soulFile);
  await session.prompt("third turn");
  await settledWith(session, (entries) => entries.filter((entry) => entry.kind === "message" && entry.role === "assistant").length >= 3);
  const latest = JSON.stringify((await requests(f.log)).at(-1)?.system);
  assert.ok(latest.includes(JSON.stringify(firstConversationSection(soulFile, "Alex")).slice(1, -1)), "no SOUL.md: the first conversation, greeting the operator by name");
  assert.doesNotMatch(latest, /Be thorough/u);

  // A bot from before SOUL.md had Durable instructions; clearing them leaves only the soul section.
  await (await harness.conversation(id, durableContext))!.configure({ instructions: "LEGACY_PERSONA" }, durableContext);
  await port.configure(reference, { instructions: null });
  assert.equal((await (await harness.conversation(id, durableContext))!.agent(durableContext)).instructions, undefined);
  await session.prompt("fourth turn");
  await settledWith(session, (entries) => entries.filter((entry) => entry.kind === "message" && entry.role === "assistant").length >= 4);
  assert.doesNotMatch(JSON.stringify((await requests(f.log)).at(-1)?.system), /LEGACY_PERSONA/u);
  assert.deepEqual(await port.lastMessage(reference), {
    role: "assistant", text: "Fixture response.", at: (await port.lastMessage(reference))!.at,
  });
  assert.match((await port.lastMessage(reference))!.at!, /^\d{4}-\d{2}-\d{2}T/u);
});

test("a failed memory enable creates no conversation, an unknown model is refused, and the tool is inert outside bots", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const before = await conversations(f.host);
  await assert.rejects(durableBotConversations(f.host, fakeMemory({ failEnable: true })).create({ botId: "bot-x", cwd: f.cwd, memory: { name: "X" } }), /OptChat refused/u);
  assert.equal(await conversations(f.host), before, "the creating commit rolled back as a whole");
  const port = durableBotConversations(f.host, fakeMemory());
  await assert.rejects(port.create({ botId: "bot-y", cwd: f.cwd, model: "hui-e2e/missing", memory: { name: "Y" } }), BotInputError);
  await assert.rejects(port.create({ botId: "bot-y", cwd: f.cwd, memory: { name: "Y", model: "nowhere/model" } }), BotInputError);
  await assert.rejects(port.checkModel("hui-e2e/missing"), /Unknown model/u);
  await port.checkModel("hui-e2e/cheap");

  const [tool] = f.host.botTools;
  assert.equal(tool?.name, MESSAGE_BOT_TOOL);
  const notABot = { conversationId: 7 as unknown as ConversationId, snapshot: async () => undefined } as unknown as ToolExecutionApi;
  const result = await tool!.execute({ to: "bob", message: "hi" } as never, notABot, BACKGROUND_CONTEXT);
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /only available in a bot's chat/u);
  assert.deepEqual(f.invocations, [], "nothing reached HUI");
});

/** Resolves with the bot memory's status once `done` holds, checking it on every change. */
function memoryWhere(memory: BotMemory, reference: string, done: (status: BotMemoryStatus) => boolean, timeoutMs = 30_000): Promise<BotMemoryStatus> {
  return new Promise((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => { off(); reject(new Error("Expected memory status never arrived.")); }, timeoutMs);
    off = memory.subscribe(reference, (status) => { if (done(status)) { clearTimeout(timer); off(); resolve(status); } });
  });
}

test("with OptChat's adapter a bot's chat has memory from its creating commit, zoom and date beside message_bot, and fresh turns", { timeout: 90_000 }, async (t) => {
  const f = await fixture(t);
  const memory = optChatBotMemory(f.host);
  const port = durableBotConversations(f.host, memory);
  const reference = await port.create({ botId: "bot-ada", cwd: f.cwd, memory: { name: "Ada", model: "hui-e2e/cheap", thinking: "low" } });
  await mkdir(join(f.homes, "bot-ada"), { recursive: true });
  await writeFile(join(f.homes, "bot-ada", "SOUL.md"), "You are Ada. Answer tersely.\n");
  const id = durableConversationId(reference)!;
  const harness = await f.host.open();
  assert.deepEqual(await harness.snapshot(OptChatDoc, id, durableContext), { enabled: true, name: "Ada", model: "hui-e2e/cheap", thinking: "low" }, "on in the creating commit");
  const session = await startDurable({ cwd: f.cwd, sessionFile: reference, huiSessionId: "ada-chat" }, f.host);
  assert.deepEqual((await harness.snapshot(AgentDoc, id, durableContext))?.extensions, { add: ["hui-optchat-tools", "hui-bots-tools"] }, "zoom and date beside message_bot");
  const offered = (await session.inspect()).tools.map((tool) => tool.name);
  assert.deepEqual(["zoom", "date", MESSAGE_BOT_TOOL].filter((name) => offered.includes(name)), ["zoom", "date", MESSAGE_BOT_TOOL]);

  // Over 512 bytes: the compactor writes its line, on the bot's memory model.
  const long = `OPT_ADA ${"remember the blue door ".repeat(30).trim()}`;
  await session.prompt(long);
  await settledWith(session, answered("Fixture response"));
  await session.prompt("OPT_NEXT what now?");
  await settledWith(session, (entries) => entries.filter((entry) => entry.kind === "message" && entry.role === "assistant").length >= 2);
  const logged = await requests(f.log);
  const compactor = logged.filter((request) => JSON.stringify(request.system).includes("You write the memory of Ada"));
  assert.deepEqual(compactor.map((request) => request.model), ["cheap"], "one summary, by the memory model");
  const second = logged.filter((request) => !compactor.includes(request)).find((request) => JSON.stringify(request.messages).includes("OPT_NEXT"));
  assert.equal(second?.messages?.length, 1, "the second turn starts fresh: no earlier message travels raw");
  const head = second!.messages![0]!.content as Array<{ type: string; text?: string }>;
  assert.deepEqual(head.map((block) => block.text), ["<chat>\n0+1|user: FIXTURE_MEMORY OPT_ADA\n1+1|talk: Fixture response.\n</chat>", "OPT_NEXT what now?"]);
  const system = JSON.stringify(second!.system);
  const order = [/You are Ada, an AI agent that works for one user in a single chat/u, /<bots>/u, /<soul>/u, /You are Ada\. Answer tersely\./u].map((pattern) => system.search(pattern));
  assert.ok(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]!)), `OptChat's prompt, the bots section, then the soul last, where OptChat expects the user's instructions: ${order.join(", ")}`);

  // Read back through the port, as the bot routes do.
  const status = await memoryWhere(memory, reference, (current) => current.messages === 4 && current.pending === 0);
  const lines = ["user: FIXTURE_MEMORY OPT_ADA", "talk: Fixture response.", "user: OPT_NEXT what now?", "talk: Fixture response."];
  assert.deepEqual(status, {
    messages: 4, built: 7, pending: 0, viewBytes: Buffer.byteLength(lines.join("")), viewLines: 4,
    usage: { calls: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 },
  }, "every node built; the fixture reports one token in and one out per call");
  assert.equal(await memory.view(reference), `<chat>\n${lines.map((line, index) => `${index}+1|${line}`).join("\n")}\n</chat>`);
  assert.equal(await memory.zoom(reference, 0, 4), "0+2|user: FIXTURE_MEMORY OPT_ADA talk: Fixture response.\n2+2|user: OPT_NEXT what now? talk: Fixture response.");
  assert.equal(await memory.zoom(reference, 0, 2), "0+1|user: FIXTURE_MEMORY OPT_ADA\n1+1|talk: Fixture response.");
  assert.equal(await memory.zoom(reference, 0, 1), `0+0|user: ${long}`, "down to the whole message");
  assert.equal(await memory.zoom(reference, 4, 4), "No line 4+4.");
  assert.match(await memory.html(reference), /<title>OptChat memory of Ada<\/title>[\s\S]*remember the blue door/u);
  await memory.configure(reference, { name: "Ada Prime" });
  assert.deepEqual(await harness.snapshot(OptChatDoc, id, durableContext), { enabled: true, name: "Ada Prime" }, "the whole setting: the compactor is the chat's own model again");

  // A conversation without OptChat has no memory to read.
  const plain = await startDurable({ cwd: f.cwd, huiSessionId: "plain" }, f.host);
  const plainReference = durableReference(Number(plain.sessionId) as ConversationId);
  assert.equal(await memory.status(plainReference), undefined);
  await assert.rejects(memory.view(plainReference), BotMemoryUnavailableError);
  await assert.rejects(memory.zoom("not-durable", 0, 1), BotMemoryUnavailableError);
});


test("the soul section: SOUL.md after its path and the rule to change it only when asked, cut at 20,000 characters with a note", () => {
  const file = "/home/me/.config/hui/bots/b1/SOUL.md";
  const section = soulSection(file, "# Who I am\nAda.");
  assert.equal(section, soulSection(file, "# Who I am\nAda."), "byte-stable while the file is");
  assert.ok(section.startsWith(`Your soul is ${file}, which you wrote with the operator`));
  assert.match(section, /When the operator asks you to change any of it, update SOUL\.md with your file tools \(at most 20,000 characters\) and tell them what you changed/u);
  assert.ok(section.endsWith("\n\n# Who I am\nAda."));
  const long = soulSection(file, "x".repeat(20_005));
  assert.ok(long.includes(`\n\n${"x".repeat(20_000)}\n\n[SOUL.md has 20,005 characters; only the first 20,000 are shown here. Shorten it.]`));
  assert.ok(!long.includes("x".repeat(20_001)));
});

test("the first conversation: greet, ask what the operator expects a question or two at a time, request first, then write SOUL.md", () => {
  const file = "/home/me/.config/hui/bots/b1/SOUL.md";
  const named = firstConversationSection(file, "  Alex   Doe ");
  assert.equal(named, firstConversationSection(file, "Alex Doe"), "byte-stable while the name is");
  assert.match(named, /^You have no soul yet: \/home\/me\/\.config\/hui\/bots\/b1\/SOUL\.md does not exist\./u);
  assert.match(named, /your first conversation with the operator, Alex Doe, which starts now/u);
  assert.match(named, /greet Alex Doe by name in a sentence and ask what they expect from you/u);
  for (const part of [
    "The operator's request always comes first", "This is a ritual, not a gate",
    "what you should look after, how you should work and sound, how proactive to be and when to message them, and what you must not do",
    "Ask one or two questions at a time", "never a questionnaire",
    "Your name and look are already set in HUI: never ask about them",
    "A message from a routine (\"[routine: …]\") or another bot (\"[from @…]\") is not the operator",
    "\"[HUI bot created]\" is HUI telling you that you were just created: open the conversation",
    `write ${file} with your write tool`, "\"Who I am\", \"What I look after\", \"How I work\", \"When I reach out\" and \"Boundaries\"",
    "a short summary of it", "in the Soul tab of your panel in HUI, or by just telling you",
  ]) assert.ok(named.includes(part), part);
  const nameless = firstConversationSection(file, undefined);
  assert.match(nameless, /your first conversation with the operator, which starts now/u);
  assert.match(nameless, /greet the operator in a sentence/u);
  assert.doesNotMatch(nameless, /by name/u);
});

test("SOUL.md is read trimmed, as none when missing or blank, and at most 256 KiB", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-soul-read-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "SOUL.md");
  assert.equal(await readSoulFile(file), undefined);
  assert.equal(await readSoulFile(join(dir, "missing", "SOUL.md")), undefined);
  await writeFile(file, " \n\t\n");
  assert.equal(await readSoulFile(file), undefined, "only whitespace is none");
  await writeFile(file, "\n# Who I am\nAda.\n\n");
  assert.equal(await readSoulFile(file), "# Who I am\nAda.");
  await writeFile(file, "a".repeat(300 * 1024));
  assert.equal((await readSoulFile(file))?.length, 256 * 1024);
});

test("a host with no SOUL.md resolver (a worker, until it has one) leaves the soul section out", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  f.host.botSouls = undefined;
  const reference = await durableBotConversations(f.host, fakeMemory()).create({ botId: "bot-ada", cwd: f.cwd, memory: { name: "Ada" } });
  const session = await startDurable({ cwd: f.cwd, sessionFile: reference, huiSessionId: "ada-chat" }, f.host);
  await session.prompt("plain turn");
  await settledWith(session, answered("Fixture response"));
  const system = JSON.stringify((await requests(f.log)).at(-1)?.system);
  assert.match(system, /<bots>/u);
  assert.doesNotMatch(system, /<soul>|SOUL\.md/u);
});
