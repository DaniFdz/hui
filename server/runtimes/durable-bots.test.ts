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
import type { BotMemory } from "../bot-memory.ts";
import type { DurableSession } from "./durable.ts";
import type { TranscriptEntry } from "./types.ts";

// HUI's configuration directory is resolved at import time; never the operator's own.
const configDir = await mkdtemp(join(tmpdir(), "hui-durable-bots-config-"));
process.env["XDG_CONFIG_HOME"] = configDir;
after(() => rm(configDir, { recursive: true, force: true }));
const { DurableHost, durableContext } = await import("./durable-host.ts");
const { startDurable, durableConversationId } = await import("./durable.ts");
const { BotDoc, MESSAGE_BOT_TOOL } = await import("./durable-bots.ts");
const { durableBotConversations } = await import("../bot-conversations.ts");
const { BotInputError } = await import("../bots.ts");
type DurableHost = import("./durable-host.ts").DurableHost;

/** Stands in for OptChat's document: written by `enable` inside the commit that creates the conversation. */
const MemoryMarker = defineDoc<{ name: string; model: string }>({
  kind: "test.bot-memory", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ name: "", model: "" }),
});

function fakeMemory(options: { failEnable?: boolean } = {}): BotMemory {
  return {
    available: true,
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
  hosts.push(host);
  return { dir, cwd, log, host, invocations };
}

type ProviderRequest = { system?: unknown; tools?: Array<{ name?: string }>; messages?: unknown };
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
  assert.doesNotMatch(JSON.stringify(request?.system), /<bots>|Roster for|message_bot/u);
  assert.ok(!(await session.inspect()).tools.some((tool) => tool.name === MESSAGE_BOT_TOOL));
  const harness = await f.host.open();
  const id = durableConversationId(session.sessionFile)!;
  assert.equal(await harness.snapshot(BotDoc, id, durableContext), undefined, "no bot document is written");
  const agent = await harness.snapshot(AgentDoc, id, durableContext);
  assert.equal(agent?.tools, undefined, "nothing is filtered: the stored agent is what it was before bots");
  assert.equal(agent?.extensions, undefined);
});

test("a bot's conversation is created in one commit with persona, bot document and memory, and offers message_bot", { timeout: 90_000 }, async (t) => {
  const f = await fixture(t);
  const port = durableBotConversations(f.host, fakeMemory());
  const reference = await port.create({
    botId: "bot-ada", cwd: f.cwd, instructions: "You are Ada. Answer tersely.", memory: { name: "Ada", model: "hui-e2e/cheap" },
  });
  const id = durableConversationId(reference)!;
  const harness = await f.host.open();
  assert.deepEqual(await harness.snapshot(BotDoc, id, durableContext), { bot: "bot-ada" });
  assert.deepEqual(await harness.snapshot(MemoryMarker, id, durableContext), { name: "Ada", model: "hui-e2e/cheap" }, "memory is enabled in the creating commit");
  assert.equal((await (await harness.conversation(id, durableContext))!.agent(durableContext)).instructions, "You are Ada. Answer tersely.");

  const session = await startDurable({ cwd: f.cwd, sessionFile: reference, huiSessionId: "ada-chat" }, f.host);
  assert.deepEqual((await harness.snapshot(AgentDoc, id, durableContext))?.extensions, { add: ["hui-bots-tools"] }, "only a bot's chat selects message_bot");
  const inspection = await session.inspect();
  assert.equal(inspection.tools.find((tool) => tool.name === MESSAGE_BOT_TOOL)?.source, "HUI");
  await session.prompt("E2E_MESSAGE_BOT tell bob hello");
  await settledWith(session, answered("message_bot answered: Queued for @bob."));
  assert.deepEqual(f.invocations, [{ callerSessionId: "ada-chat", action: MESSAGE_BOT_TOOL, params: { to: "@bob", message: "hello from the fixture" } }]);
  const [first] = await requests(f.log);
  const system = JSON.stringify(first?.system);
  assert.match(system, /You are Ada\. Answer tersely\./u, "the persona is the conversation's instructions");
  assert.match(system, /<bots>\\nRoster for bot-ada: @bob \(Bob\)\.\\n<\/bots>/u, "the bots section, tagged");
  assert.ok(first?.tools?.some((tool) => tool.name === MESSAGE_BOT_TOOL));
  assert.match(JSON.stringify(first?.system), /- message_bot: Message another bot of this HUI in its own chat/u, "listed with HUI's active tools");

  await port.configure(reference, { instructions: "You are Ada. Be thorough." });
  await session.prompt("second turn");
  await settledWith(session, (entries) => entries.filter((entry) => entry.kind === "message" && entry.role === "assistant").length >= 2);
  const latest = JSON.stringify((await requests(f.log)).at(-1)?.system);
  assert.match(latest, /You are Ada\. Be thorough\./u);
  assert.doesNotMatch(latest, /Answer tersely/u);
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
