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
import type { RuntimeEvent, RuntimeQuestion, TranscriptEntry } from "./types.ts";

// HUI's configuration directory is resolved at import time; never the operator's own.
const configDir = await mkdtemp(join(tmpdir(), "hui-bot-access-config-"));
process.env["XDG_CONFIG_HOME"] = configDir;
after(() => rm(configDir, { recursive: true, force: true }));
const { DurableHost, durableContext } = await import("./durable-host.ts");
const { startDurable, durableConversationId } = await import("./durable.ts");
const { BotDoc } = await import("./durable-bots.ts");
const access = await import("./durable-bot-access.ts");
const { durableBotConversations } = await import("../bot-conversations.ts");
const { bundledSkills } = await import("../bundled-skills.ts");
type DurableHost = import("./durable-host.ts").DurableHost;
type BotAccess = import("./durable-bots.ts").BotAccess;

/* ── pure rules ──────────────────────────────────────────────────────── */

test("a bot's chat is offered the tools on its list and the ones it always keeps, in offer order", () => {
  const offer = ["read", "write", "bash", "sessions_spawn", "fixture_echo", "zoom", "date", "message_bot", "request_access", "load_skill"].map((name) => ({ name }));
  const lists: BotAccess = { tools: ["fixture_echo", "read", "gone"], skills: [] };
  const always = access.alwaysKept(lists, ["zoom", "date"]);
  assert.deepEqual(access.botToolSelection(offer, lists, always).map((tool) => tool.name), ["read", "fixture_echo", "zoom", "date", "request_access"],
    "an extension's tool on the list stays; one that no longer exists is ignored; load_skill waits for a skill");
  const withSkill: BotAccess = { tools: ["message_bot"], skills: [{ name: "alpha", path: "/skills/alpha/SKILL.md" }] };
  assert.deepEqual(access.botToolSelection(offer, withSkill, access.alwaysKept(withSkill, [])).map((tool) => tool.name), ["message_bot", "request_access", "load_skill"]);
  assert.equal(access.botMayCall(null, "terminal"), true, "lists not recorded yet: everything, as before");
  assert.equal(access.botMayCall(lists, "read"), true);
  assert.equal(access.botMayCall(lists, "terminal"), false);
  assert.equal(access.botMayCall({ tools: [], skills: [] }, "request_access"), true, "its own tools need no list");
});

test("skills are named by name and source, bundled ones by their stable preference path", () => {
  const bundled = bundledSkills[0];
  assert.deepEqual(access.skillRef({ name: bundled.name, filePath: bundled.path }), { name: bundled.name, path: bundled.preferencePath });
  assert.deepEqual(access.skillRef({ name: "alpha", filePath: "/a/alpha/SKILL.md" }), { name: "alpha", path: "/a/alpha/SKILL.md" });
  const skills = [
    { name: "alpha", filePath: "/a/alpha/SKILL.md" },
    { name: "alpha", filePath: "/b/alpha/SKILL.md" },
    { name: "beta", filePath: "/a/beta/SKILL.md" },
    { name: bundled.name, filePath: bundled.path },
  ];
  assert.deepEqual(access.botSkills(skills, [{ name: "alpha", path: "/b/alpha/SKILL.md" }, { name: bundled.name, path: bundled.preferencePath }]),
    [skills[1], skills[3]], "same name, other source: not on the list");
  assert.deepEqual(access.botSkills(skills, [{ name: "renamed", path: "/a/beta/SKILL.md" }]), [], "the name is part of the identity");
});

test("the catalog describes each tool: its group, its source and whether it is powerful", () => {
  assert.deepEqual(access.describeTool({ name: "bash" }, { kind: "coding" }), {
    name: "bash", label: "Shell", description: "Run shell commands", group: "shell", source: "Durable", powerful: true,
  });
  assert.deepEqual(access.describeTool({ name: "read" }, { kind: "coding" }), {
    name: "read", label: "Read files", description: "Read files and images", group: "files", source: "Durable", powerful: false,
  });
  const spawn = access.describeTool({ name: "sessions_spawn", description: "Start an isolated child session." }, { kind: "hui" });
  assert.deepEqual({ ...spawn, description: undefined }, { name: "sessions_spawn", label: "Spawn subagent", description: undefined, group: "hui", source: "HUI", powerful: true });
  assert.equal(spawn.description, "Spawn a subagent for independent background work");
  assert.equal(access.describeTool({ name: "suggest_task" }, { kind: "hui" }).powerful, false);
  assert.equal(access.describeTool({ name: "message_bot" }, { kind: "bot" }).group, "bots");
  assert.deepEqual(access.describeTool({ name: "fixture_echo", description: "Echoes text. More words." }, { kind: "extension", source: "user · fixture.js · fixture.js" }), {
    name: "fixture_echo", label: "fixture_echo", description: "Echoes text", group: "extension", source: "user · fixture.js · fixture.js", powerful: false,
  });
  for (const name of ["write", "edit", "terminal", "watcher", "browser", "sessions_send", "subagents"]) assert.ok(access.POWERFUL_TOOLS.has(name), name);
});

test("a bot's skills section loads skills with load_skill; its access section says what it has and can ask for", () => {
  const prompt = access.botSkillsPrompt([
    { name: "alpha", description: "Use <alpha> for A & B.", disableModelInvocation: false },
    { name: "hidden", description: "Only by command.", disableModelInvocation: true },
  ]);
  assert.match(prompt!, /Use the load_skill tool to load a skill/u);
  assert.match(prompt!, /<name>alpha<\/name>\n {4}<description>Use &lt;alpha&gt; for A &amp; B\.<\/description>/u);
  assert.doesNotMatch(prompt!, /hidden|read tool/u);
  assert.equal(access.botSkillsPrompt([]), undefined);
  const offer = [access.describeTool({ name: "read" }, { kind: "coding" }), access.describeTool({ name: "bash" }, { kind: "coding" })];
  const skills = [{ name: "alpha", filePath: "/s/alpha/SKILL.md", description: "Alpha work." }, { name: "beta", filePath: "/s/beta/SKILL.md", description: "Beta work." }];
  const text = access.botAccessText({ tools: ["read"], skills: [{ name: "alpha", path: "/s/alpha/SKILL.md" }] }, ["read", "request_access", "load_skill"], offer, skills);
  assert.match(text, /Your tools: read, request_access, load_skill\. Your skills: alpha\./u);
  assert.match(text, /Tools you can ask for:\n- bash: Run shell commands \(powerful/u);
  assert.match(text, /Skills you can ask for:\n- beta: Beta work\./u);
  assert.doesNotMatch(text, /- read:|- alpha:/u);
  assert.match(access.botAccessText({ tools: ["read", "bash"], skills: [] }, ["read", "bash"], offer, []), /There is nothing more to ask for\./u);
  const question = access.accessQuestion([offer[1]!, offer[0]!], [{ name: "beta", path: "/s/beta/SKILL.md" }], "To run the checks.");
  assert.deepEqual(question, { method: "select", title: "Allow access to bash (powerful), read and the beta skill?", message: "To run the checks.", options: ["Allow", "Deny"] });
});

/* ── a bot's chat in a real harness ──────────────────────────────────── */

function fakeMemory(): BotMemory {
  return {
    enable: async () => {}, configure: async () => {}, status: async () => undefined,
    view: async () => "", zoom: async () => "", html: async () => "", subscribe: () => () => {},
  };
}

const EXTENSION = "export default function (pi) {\n"
  + "  pi.registerTool({ name: 'fixture_echo', label: 'Echo', description: 'Echoes text.', promptSnippet: 'Echo text back', parameters: { type: 'object', properties: { text: { type: 'string' } } }, async execute(_id, params) { return { content: [{ type: 'text', text: 'echo: ' + params.text }], details: {} }; } });\n"
  + "  pi.registerTool({ name: 'fixture_other', label: 'Other', description: 'Another extension tool.', parameters: { type: 'object', properties: {} }, async execute() { return { content: [{ type: 'text', text: 'other' }], details: {} }; } });\n"
  + "}\n";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "hui-bot-access-"));
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "workspace");
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await mkdir(cwd);
  await writeFile(join(agentDir, "extensions", "fixture.js"), EXTENSION);
  for (const [name, description] of [["alpha", "Alpha procedures."], ["beta", "Beta procedures."]] as const) {
    await mkdir(join(agentDir, "skills", name, "references"), { recursive: true });
    await writeFile(join(agentDir, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nSKILL_BODY_${name.toUpperCase()}\n`);
    await writeFile(join(agentDir, "skills", name, "references", "notes.md"), `NOTES_${name.toUpperCase()}\n`);
  }
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
    baseUrl, api: "anthropic-messages", apiKey: "***", models: [{
      id: "fixture", name: "fixture", reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
  } } }));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture" }));
  const invocations: AgentToolInvocation[] = [];
  const host = new DurableHost({
    dir: join(dir, "store"), agentDir,
    readSettings: async () => normalizeSettings(undefined),
    invokeTool: async (invocation) => { invocations.push(invocation); return { text: "Queued for @bob." }; },
    lookupCaller: async () => undefined,
  });
  hosts.push(host);
  const port = durableBotConversations(host, fakeMemory());
  /** A bot's chat with these lists (`null`: not recorded, as before bots had them), open as a HUI session. */
  const bot = async (lists: BotAccess | null, huiSessionId = "bot-chat") => {
    const reference = await port.create({ botId: `bot-${huiSessionId}`, cwd, memory: { name: "Ada" } });
    const id = durableConversationId(reference)!;
    await setAccess(host, id, lists);
    const session = await startDurable({ cwd, sessionFile: reference, huiSessionId }, host);
    return { id, reference, session };
  };
  return { dir, agentDir, cwd, log, host, invocations, bot };
}

async function setAccess(host: DurableHost, id: ConversationId, lists: BotAccess | null): Promise<void> {
  await (await host.open()).commit(async (tx) => { (await tx.doc(BotDoc, id)).access = lists; }, durableContext);
}

type ProviderRequest = { system?: unknown; tools?: Array<{ name?: string }>; messages?: Array<{ role: string; content: unknown }> };
async function requests(log: string): Promise<ProviderRequest[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as ProviderRequest);
}
const toolNames = (request: ProviderRequest | undefined) => (request?.tools ?? []).map((tool) => tool.name);

/** The prompt that makes the fixture provider call these tools in one response. */
const calls = (...each: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify(each)).toString("base64url")}`;

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

function nextQuestion(session: DurableSession, timeoutMs = 20_000): Promise<RuntimeQuestion> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error("No question was asked.")); }, timeoutMs);
    const unsubscribe = session.subscribe((event: RuntimeEvent) => {
      if (event.type === "question") { clearTimeout(timer); unsubscribe(); resolve(event.question); }
    });
  });
}

const reply = (entries: TranscriptEntry[]) => [...entries].reverse().find((entry) => entry.kind === "message" && entry.role === "assistant");
const answered = (text: string) => (entries: TranscriptEntry[]) => {
  const last = reply(entries);
  return last?.kind === "message" && last.text.includes(text);
};
const lastReply = (session: DurableSession) => {
  const last = reply(session.transcript());
  return last?.kind === "message" ? last.text : "";
};

test("a bot's chat is offered only the tools on its list, extension tools included; a session in its directory keeps them all", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id, session } = await f.bot({ tools: ["read", "fixture_echo"], skills: [] });
  const harness = await f.host.open();
  assert.deepEqual((await harness.snapshot(AgentDoc, id, durableContext))?.tools, ["read", "fixture_echo", "request_access"], "exactly these, in offer order");
  assert.deepEqual((await session.inspect()).tools.map((tool) => tool.name), ["read", "fixture_echo", "request_access"]);
  await session.prompt("plain turn");
  await settledWith(session, answered("Fixture response"));
  const [first] = await requests(f.log);
  assert.deepEqual(toolNames(first), ["read", "fixture_echo", "request_access"], "the provider sees only the bot's tools");
  const system = JSON.stringify(first?.system);
  assert.match(system, /<bot_access>/u);
  assert.match(system, /Your tools: read, fixture_echo, request_access\. Your skills: none\./u);
  assert.match(system, /- bash: Run shell commands \(powerful/u);
  assert.match(system, /- fixture_other: Another extension tool/u, "an extension's tool can be asked for");
  assert.match(system, /- alpha: Alpha procedures\./u);
  const offer = session.botOffer().map((tool) => tool.name);
  for (const name of ["read", "write", "edit", "bash", "terminal", "sessions_spawn", "fixture_echo", "fixture_other", "message_bot"]) assert.ok(offer.includes(name), name);
  assert.ok(!offer.includes("request_access") && !offer.includes("load_skill"), "its own tools are not on offer: it always has them");
  assert.equal(session.botOffer().find((tool) => tool.name === "fixture_other")?.group, "extension");

  const plain = await startDurable({ cwd: f.cwd, huiSessionId: "plain" }, f.host);
  const plainTools = (await plain.inspect()).tools.map((tool) => tool.name);
  for (const name of ["bash", "write", "fixture_other", "terminal"]) assert.ok(plainTools.includes(name), name);
  assert.ok(!plainTools.includes("request_access") && !plainTools.includes("message_bot"));
  assert.deepEqual(plain.botOffer(), []);
});

test("a bot whose lists are not recorded keeps every tool, without the tools only lists need, and a version 1 document reads as such", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  // The bot document as releases before the lists wrote it.
  const V1 = defineDoc<{ bot: string }>({ kind: "hui.bot", version: 1, scope: "conversation", history: "latest", fork: "current", initial: () => ({ bot: "" }) });
  const harness = await f.host.open();
  const created = await harness.createConversation({
    ownership: { kind: "ownerless" }, agent: { cwd: f.cwd },
    init: async (tx, conversationId) => { (await tx.doc(V1, conversationId)).bot = "bot-old"; },
  }, durableContext);
  assert.deepEqual(await harness.snapshot(BotDoc, created.id, durableContext), { bot: "bot-old", access: null }, "version 1 reads without lists");
  const session = await startDurable({ cwd: f.cwd, sessionFile: `durable:${created.id}`, huiSessionId: "old-chat" }, f.host);
  const tools = (await session.inspect()).tools.map((tool) => tool.name);
  for (const name of ["read", "write", "bash", "terminal", "fixture_other", "message_bot"]) assert.ok(tools.includes(name), name);
  assert.ok(!tools.includes("request_access") && !tools.includes("load_skill"));
  assert.doesNotMatch(JSON.stringify(await session.inspect()), /<bot_access>/u);
});

test("the HUI tool bridge refuses a bot's call to a HUI tool that isn't on its list, whatever it was offered", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id } = await f.bot({ tools: ["sessions_list"], skills: [] });
  const harness = await f.host.open();
  const api = (callId: string) => ({
    conversationId: id, callId,
    snapshot: (doc: never, conversationId: ConversationId, context: never) => harness.snapshot(doc, conversationId, context),
  }) as unknown as ToolExecutionApi;
  const huiTool = (name: string) => f.host.huiTools.find((tool) => tool.name === name)!;
  await assert.rejects(huiTool("sessions_history").execute({ sessionKey: "child" } as never, api("c1"), BACKGROUND_CONTEXT), /doesn't have the sessions_history tool\. Ask the operator for it with request_access/u);
  await assert.rejects(huiTool("terminal").execute({ action: "list" } as never, api("c2"), BACKGROUND_CONTEXT), /doesn't have the terminal tool/u);
  const messageBot = f.host.botTools.find((tool) => tool.name === "message_bot")!;
  const refused = await messageBot.execute({ to: "bob", message: "hi" } as never, api("c3"), BACKGROUND_CONTEXT);
  assert.equal(refused.isError, true);
  assert.match(JSON.stringify(refused.content), /doesn't have the message_bot tool/u, "message_bot can be turned off too");
  assert.equal(f.invocations.length, 0, "nothing reached HUI");
  await huiTool("sessions_list").execute({} as never, api("c4"), BACKGROUND_CONTEXT);
  assert.deepEqual(f.invocations.map((invocation) => invocation.action), ["sessions_list"], "a tool on the list reaches HUI");
});

test("request_access: Allow adds the tool to the lists and to the very next request", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id, session } = await f.bot({ tools: [], skills: [] });
  const asked = nextQuestion(session);
  await session.prompt(calls({ name: "request_access", input: { tools: ["bash"], reason: "To run the project's checks." } }));
  const question = await asked;
  assert.deepEqual({ ...question, id: undefined }, { id: undefined, method: "select", title: "Allow access to bash (powerful)?", message: "To run the project's checks.", options: ["Allow", "Deny"] });
  assert.deepEqual(session.pendingQuestions().map((each) => each.id), [question.id], "a session question, answered like any other");
  await session.respondQuestion(question.id, { value: "Allow" });
  await settledWith(session, answered("tool answered: The operator allowed it: you now have bash, from your next step."));
  const harness = await f.host.open();
  assert.deepEqual((await harness.snapshot(BotDoc, id, durableContext))?.access, { tools: ["bash"], skills: [] });
  const logged = await requests(f.log);
  assert.deepEqual(toolNames(logged[0]), ["request_access"], "a new bot starts with nothing but its own tools");
  assert.deepEqual(toolNames(logged[1]), ["request_access", "bash"], "the request after the answer offers it");
  assert.match(JSON.stringify(logged[1]?.system), /Your tools: request_access, bash\./u);
  assert.ok(((await harness.snapshot(AgentDoc, id, durableContext))?.tools as string[]).includes("bash"));
  await session.applyTools();
  assert.deepEqual((await session.inspect()).tools.map((tool) => tool.name), ["bash", "request_access"], "and it stays on a fresh selection");
});

test("request_access: Deny refuses and changes nothing; a typed answer reaches the bot", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id, session } = await f.bot({ tools: ["read"], skills: [] });
  let asked = nextQuestion(session);
  await session.prompt(calls({ name: "request_access", input: { tools: ["write"], reason: "To save notes." } }));
  await session.respondQuestion((await asked).id, { value: "Deny" });
  await settledWith(session, answered("tool answered: The operator denied the request."));
  asked = nextQuestion(session);
  await session.prompt(calls({ name: "request_access", input: { tools: ["write"], reason: "To save notes." } }));
  await session.respondQuestion((await asked).id, { value: "Use the notes folder through message_bot instead" });
  await settledWith(session, answered("The operator didn't allow it and wrote: Use the notes folder through message_bot instead"));
  asked = nextQuestion(session);
  await session.prompt(calls({ name: "request_access", input: { tools: ["write"], reason: "To save notes." } }));
  await session.cancelQuestion((await asked).id);
  await settledWith(session, answered("The operator dismissed the request without answering."));
  const harness = await f.host.open();
  assert.deepEqual((await harness.snapshot(BotDoc, id, durableContext))?.access, { tools: ["read"], skills: [] });
  assert.ok((await requests(f.log)).every((request) => !toolNames(request).includes("write")), "never offered");
});

test("request_access refuses unknown names with the valid ones and asks nothing; one request waits at a time", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id, session } = await f.bot({ tools: ["read"], skills: [] });
  let questions = 0;
  session.subscribe((event) => { if (event.type === "question") questions += 1; });
  await session.prompt(calls({ name: "request_access", input: { tools: ["teleport", "read"], skills: ["gamma"], reason: "Because." } }));
  await settledWith(session, answered("tool answered:"));
  const refusal = lastReply(session);
  assert.match(refusal, /No tool named teleport\. You can ask for: write, edit, bash, /u);
  assert.doesNotMatch(refusal, /ask for: read|, read,/u, "what it has is not offered again");
  assert.match(refusal, /fixture_other/u);
  assert.match(refusal, /No skill named gamma\. You can ask for: alpha, beta, create-verification-skill, git-selective-staging\./u, "HUI's bundled skills too");
  assert.equal(questions, 0);

  await session.prompt(calls({ name: "request_access", input: { tools: ["read"], reason: "Again." } }));
  await settledWith(session, answered("tool answered: You already have read."));
  assert.equal(questions, 0);

  // Two requests in one round: the operator never has two waiting. Durable runs the round's calls one after another
  // here, so the second asks once the first is answered; were they to overlap, the second would be refused.
  const answers = ["Allow", "Deny"];
  let most = 0;
  session.subscribe((event) => {
    if (event.type !== "question") return;
    most = Math.max(most, session.pendingQuestions().length);
    const value = answers.shift() ?? "Deny";
    setImmediate(() => { void session.respondQuestion(event.question.id, { value }); });
  });
  await session.prompt(calls(
    { name: "request_access", input: { tools: ["write"], reason: "First." } },
    { name: "request_access", input: { tools: ["edit"], reason: "Second." } },
  ));
  await settledWith(session, answered("tool answered:"));
  const both = lastReply(session);
  assert.match(both, /The operator allowed it: you now have (write|edit), from your next step\./u);
  assert.match(both, /The operator denied the request\.|Another access request is already waiting for the operator\./u);
  assert.equal(most, 1, "never more than one request waits for the operator");
  const granted = (await (await f.host.open()).snapshot(BotDoc, id, durableContext))?.access?.tools;
  assert.equal(granted?.length, 2);
  assert.ok(granted?.[0] === "read" && ["write", "edit"].includes(granted[1]!));
});

test("request_access lets one request per bot wait for the operator; the next may ask once it is answered", async () => {
  const asked: unknown[] = [];
  let answer!: (response: { value: string }) => void;
  const offer = [access.describeTool({ name: "write" }, { kind: "coding" }), access.describeTool({ name: "edit" }, { kind: "coding" })];
  const chat = {
    botOffer: () => offer,
    availableSkills: async () => [],
    ask: (question: unknown) => { asked.push(question); return new Promise<{ value: string }>((resolve) => { answer = resolve; }); },
  };
  const tool = access.botAccessParts({ chat: () => chat, skills: async () => [], agentDir: "/nowhere" }).tools.find((each) => each.name === "request_access")!;
  const state = { bot: "bot-a", access: { tools: [] as string[], skills: [] } };
  const api = {
    conversationId: 1 as unknown as ConversationId, callId: "call",
    snapshot: async () => state,
    agent: async () => ({ tools: [{ name: "request_access" }] }),
    commit: async (change: (tx: unknown) => unknown) => change({ doc: async () => state }),
  } as unknown as ToolExecutionApi;
  const first = tool.execute({ tools: ["write"], reason: "First." } as never, api, BACKGROUND_CONTEXT);
  while (!asked.length) await new Promise((resolve) => setImmediate(resolve));
  const second = await tool.execute({ tools: ["edit"], reason: "Second." } as never, api, BACKGROUND_CONTEXT);
  assert.equal(second.isError, true);
  assert.match(JSON.stringify(second.content), /Another access request is already waiting for the operator/u);
  assert.equal(asked.length, 1, "the second never reached the operator");
  answer({ value: "Allow" });
  const done = await first;
  assert.deepEqual(done.control, { addTools: ["write"] });
  assert.deepEqual(state.access, { tools: ["write"], skills: [] });
  const again = tool.execute({ tools: ["edit"], reason: "Now." } as never, api, BACKGROUND_CONTEXT);
  while (asked.length < 2) await new Promise((resolve) => setImmediate(resolve));
  answer({ value: "Deny" });
  assert.match(JSON.stringify((await again).content), /The operator denied the request/u);
  assert.deepEqual(state.access, { tools: ["write"], skills: [] });
});

test("a bot's prompt lists only its skills, through load_skill; /skill: offers only them; a session in its directory keeps all", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const plain = await startDurable({ cwd: f.cwd, huiSessionId: "plain" }, f.host);
  const alpha = (await plain.availableSkills()).find((skill) => skill.name === "alpha")!;
  const { session } = await f.bot({ tools: [], skills: [access.skillRef(alpha)] });
  assert.deepEqual((await session.inspect()).tools.map((tool) => tool.name), ["request_access", "load_skill"], "load_skill comes with its first skill");
  await session.prompt("plain turn");
  await settledWith(session, answered("Fixture response"));
  const system = JSON.stringify((await requests(f.log))[0]?.system);
  assert.match(system, /<skills>\\nThe following skills provide specialized instructions for specific tasks\.\\nUse the load_skill tool/u);
  assert.match(system, /<name>alpha<\/name>/u);
  assert.doesNotMatch(system, /<name>beta<\/name>/u, "an unselected skill is not in the prompt");
  assert.doesNotMatch(system, /Use the read tool/u);
  assert.match(system, /Your skills: alpha\./u);
  assert.match(system, /Skills you can ask for:\\n- beta: Beta procedures\./u);
  const commands = (await session.listCommands()).filter((command) => command.source === "skill").map((command) => command.name);
  assert.deepEqual(commands, ["skill:alpha"]);
  await session.prompt("/skill:beta please");
  await settledWith(session, (entries) => entries.filter((entry) => entry.kind === "message" && entry.role === "assistant").length >= 2);
  await session.prompt("/skill:alpha please");
  await settledWith(session, (entries) => entries.filter((entry) => entry.kind === "message" && entry.role === "assistant").length >= 3);
  const users = (await requests(f.log)).slice(1).map((request) => JSON.stringify(request.messages?.at(-1)));
  assert.match(users[0]!, /\/skill:beta please/u, "not one of its skills: sent as typed");
  assert.doesNotMatch(users[0]!, /SKILL_BODY_BETA/u);
  assert.match(users[1]!, /<skill name=\\"alpha\\"[^]*SKILL_BODY_ALPHA[^]*please/u);

  const plainCommands = (await plain.listCommands()).filter((command) => command.source === "skill").map((command) => command.name);
  assert.deepEqual(plainCommands.sort(), ["skill:alpha", "skill:beta", "skill:create-verification-skill", "skill:git-selective-staging"]);
  await plain.prompt("plain session turn");
  await settledWith(plain, answered("Fixture response"));
  const plainSystem = JSON.stringify((await requests(f.log)).at(-1)?.system);
  assert.match(plainSystem, /Use the read tool to load a skill's file/u, "PI's own section, every skill");
  assert.match(plainSystem, /<name>alpha<\/name>[^]*<name>beta<\/name>/u);
});

test("load_skill returns one of the bot's skills or a file inside it, and refuses other skills and paths that leave it", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const plain = await startDurable({ cwd: f.cwd, huiSessionId: "plain" }, f.host);
  const alpha = (await plain.availableSkills()).find((skill) => skill.name === "alpha")!;
  const { session } = await f.bot({ tools: [], skills: [access.skillRef(alpha)] });
  await session.prompt(calls(
    { name: "load_skill", input: { name: "alpha" } },
    { name: "load_skill", input: { name: "alpha", path: "references/notes.md" } },
    { name: "load_skill", input: { name: "alpha", path: "../beta/SKILL.md" } },
    { name: "load_skill", input: { name: "beta" } },
  ));
  await settledWith(session, answered("tool answered:"));
  const [skill, notes, escape, other] = lastReply(session).replace(/^tool answered: /u, "").split(" | ");
  assert.match(skill!, /^<skill name="alpha" location="[^"]+alpha\/SKILL\.md">\nReferences are relative to [^\n]+alpha\.\n\n# alpha\n\nSKILL_BODY_ALPHA\n<\/skill>$/u);
  assert.equal(notes, "NOTES_ALPHA\n");
  assert.match(escape!, /\.\.\/beta\/SKILL\.md is not a file inside the alpha skill's directory\./u);
  assert.match(other!, /You have no skill named "beta"\. Your skills: alpha\. Ask the operator for one with request_access\./u);
});

test("a skill granted through request_access is in the next request's prompt, with load_skill", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id, session } = await f.bot({ tools: [], skills: [] });
  const asked = nextQuestion(session);
  await session.prompt(calls({ name: "request_access", input: { skills: ["beta"], reason: "For the beta procedures." } }));
  const question = await asked;
  assert.equal(question.method === "select" && question.title, "Allow access to the beta skill?");
  await session.respondQuestion(question.id, { value: "Allow" });
  await settledWith(session, answered("you now have the beta skill, from your next step. Load a skill with load_skill."));
  const [first, second] = await requests(f.log);
  assert.doesNotMatch(JSON.stringify(first?.system), /<skills>/u);
  assert.deepEqual(toolNames(second), ["request_access", "load_skill"]);
  assert.match(JSON.stringify(second?.system), /<skills>[^]*<name>beta<\/name>/u);
  const lists = (await (await f.host.open()).snapshot(BotDoc, id, durableContext))?.access;
  assert.deepEqual(lists?.skills.map((skill) => skill.name), ["beta"]);
  assert.match(lists!.skills[0]!.path, /beta\/SKILL\.md$/u);
});
