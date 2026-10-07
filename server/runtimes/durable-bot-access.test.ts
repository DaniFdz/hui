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
const { botTurnOrigin, isBotAccessQuestion, botKickoffText } = await import("../../shared/bots.ts");
const { bundledSkills } = await import("../bundled-skills.ts");
type DurableHost = import("./durable-host.ts").DurableHost;
type BotAccess = import("./durable-bots.ts").BotAccess;
type BotSkillRef = import("./durable-bots.ts").BotSkillRef;

const NONE: BotAccess = { disabledTools: [], disabledSkills: [] };
const off = (disabledTools: string[], disabledSkills: BotSkillRef[] = []): BotAccess => ({ disabledTools, disabledSkills });
const names = (tools: readonly { name: string }[]) => tools.map((tool) => tool.name);

/* ── pure rules ──────────────────────────────────────────────────────── */

test("a bot's chat goes without what the operator turned off, and without its own tools while it has no use for them", () => {
  const offer = ["read", "write", "bash", "sessions_spawn", "fixture_echo", "zoom", "date", "message_bot", "request_access", "load_skill"].map((name) => ({ name }));
  // Nothing off: nothing to ask for, and read loads its skills.
  let plan = access.planBotTools(offer, NONE, { memory: ["zoom", "date"], skillsOn: 2, skillsOff: 0 });
  assert.deepEqual(names(plan.removed), ["request_access", "load_skill"]);
  assert.deepEqual(names(plan.listable), ["read", "write", "bash", "sessions_spawn", "fixture_echo", "message_bot"], "OptChat's memory and its own tools are not the operator's to turn off");
  // An extension's tool, one that no longer exists, and a memory tool turned off.
  plan = access.planBotTools(offer, off(["fixture_echo", "bash", "gone", "zoom", "request_access"]), { memory: ["zoom", "date"], skillsOn: 2, skillsOff: 0 });
  assert.deepEqual(names(plan.removed), ["bash", "fixture_echo", "load_skill"], "request_access stays while something is off");
  // Neither read nor bash: load_skill loads its skills.
  plan = access.planBotTools(offer, off(["read", "bash"]), { memory: [], skillsOn: 1, skillsOff: 0 });
  assert.deepEqual(names(plan.removed), ["read", "bash"]);
  // No skill on: no load_skill. A skill turned off is something to ask for.
  plan = access.planBotTools(offer, off(["read", "bash"]), { memory: [], skillsOn: 0, skillsOff: 1 });
  assert.deepEqual(names(plan.removed), ["read", "bash", "load_skill"]);
  plan = access.planBotTools(offer, NONE, { memory: [], skillsOn: 1, skillsOff: 1 });
  assert.deepEqual(names(plan.removed), ["load_skill"]);
  assert.equal(access.botMayCall(NONE, "terminal"), true);
  assert.equal(access.botMayCall(off(["terminal"]), "terminal"), false);
  assert.equal(access.botMayCall(off(["request_access", "load_skill"]), "request_access"), true, "its own tools can't be turned off");
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
    [skills[0], skills[2]], "same name, other source: still on");
  assert.deepEqual(access.botSkills(skills, [{ name: "renamed", path: "/a/beta/SKILL.md" }]), skills, "the name is part of the identity");
});

test("a skill in the catalog: bundled ones by their stable path from HUI defaults, others from the folder holding them, ~ for home", async () => {
  const { homedir } = await import("node:os");
  const home = homedir();
  assert.deepEqual(access.offeredSkill({ name: "notes", description: "Notes.", filePath: join(home, ".pi/agent/skills/notes/SKILL.md"), baseDir: join(home, ".pi/agent/skills/notes") }),
    { name: "notes", path: join(home, ".pi/agent/skills/notes/SKILL.md"), description: "Notes.", source: "~/.pi/agent/skills" });
  assert.equal(access.offeredSkill({ name: "x", description: "", filePath: "/srv/skills/x/SKILL.md", baseDir: "/srv/skills/x" }).source, "/srv/skills");
  const bundled = bundledSkills[0];
  assert.deepEqual(access.offeredSkill({ name: bundled.name, description: "B.", filePath: bundled.path, baseDir: join(bundled.path, "..") }),
    { name: bundled.name, path: bundled.preferencePath, description: "B.", source: "HUI defaults" });
});

test("the catalog describes each tool: its group, its source and whether it is powerful", () => {
  assert.deepEqual(access.describeTool({ name: "bash" }, { kind: "coding" }), {
    name: "bash", label: "Shell", description: "Run shell commands", group: "shell", source: "Durable", powerful: true,
  });
  assert.deepEqual(access.describeTool({ name: "read" }, { kind: "coding" }), {
    name: "read", label: "Read files", description: "Read files and images", group: "files", source: "Durable", powerful: false,
  });
  const spawned = access.describeTool({ name: "sessions_spawn", description: "Start an isolated child session." }, { kind: "hui" });
  assert.deepEqual({ ...spawned, description: undefined }, { name: "sessions_spawn", label: "Spawn subagent", description: undefined, group: "hui", source: "HUI", powerful: true });
  assert.equal(spawned.description, "Spawn a subagent for independent background work");
  assert.equal(access.describeTool({ name: "suggest_task" }, { kind: "hui" }).powerful, false);
  assert.equal(access.describeTool({ name: "message_bot" }, { kind: "bot" }).group, "bots");
  assert.deepEqual(access.describeTool({ name: "fixture_echo", description: "Echoes text. More words." }, { kind: "extension", source: "user · fixture.js · fixture.js" }), {
    name: "fixture_echo", label: "fixture_echo", description: "Echoes text", group: "extension", source: "user · fixture.js · fixture.js", powerful: false,
  });
  for (const name of ["write", "edit", "terminal", "watcher", "browser", "sessions_send", "subagents"]) assert.ok(access.POWERFUL_TOOLS.has(name), name);
});

test("the access section names what is off and how to ask for it; a bot without file tools loads skills with load_skill", () => {
  const prompt = access.botSkillsPrompt([
    { name: "alpha", description: "Use <alpha> for A & B.", disableModelInvocation: false },
    { name: "hidden", description: "Only by command.", disableModelInvocation: true },
  ]);
  assert.match(prompt!, /Use the load_skill tool to load a skill/u);
  assert.match(prompt!, /<name>alpha<\/name>\n {4}<description>Use &lt;alpha&gt; for A &amp; B\.<\/description>/u);
  assert.doesNotMatch(prompt!, /hidden|read tool/u);
  assert.equal(access.botSkillsPrompt([]), undefined);
  const bash = access.describeTool({ name: "bash" }, { kind: "coding" });
  const text = access.botAccessText([bash], [{ name: "beta", description: "Beta work." }]);
  assert.match(text!, /^The operator turned off some of your tools and skills in this chat:\nTools:\n- bash: Run shell commands \(powerful\)\nSkills:\n- beta: Beta work\.\nIf a job truly needs one of them, ask for it with request_access/u);
  assert.doesNotMatch(access.botAccessText([], [{ name: "beta", description: "Beta work." }])!, /Tools:/u);
  assert.equal(access.botAccessText([], []), undefined, "nothing off, no section");
  const question = access.accessQuestion([bash, access.describeTool({ name: "read" }, { kind: "coding" })], [{ name: "beta", path: "/s/beta/SKILL.md" }], "To run the checks.");
  assert.deepEqual(question, { method: "select", title: "Allow access to bash (powerful), read and the beta skill?", message: "To run the checks.", options: ["Allow", "Deny"] });
});

test("who started a turn is read as set_profile reads it, and an access request says so to the operator", () => {
  assert.deepEqual(botTurnOrigin("[routine: Morning digest] check the inbox"), { kind: "routine", name: "Morning digest" });
  assert.deepEqual(botTurnOrigin("[from @scout] found it"), { kind: "bot", handle: "scout" });
  assert.deepEqual(botTurnOrigin("[from @scout · hop 2] found it"), { kind: "bot", handle: "scout" });
  assert.deepEqual(botTurnOrigin(botKickoffText("Ada")), { kind: "kickoff" });
  for (const text of ["please look", "[from scout] no @", "[routine without colon]", undefined]) assert.deepEqual(botTurnOrigin(text), { kind: "operator" }, String(text));
  assert.equal(access.turnNote("[routine: Morning digest] go"), "Asked during the routine \"Morning digest\".");
  assert.equal(access.turnNote("[from @scout] go"), "Asked while handling a message from @scout.");
  assert.equal(access.turnNote(botKickoffText("Ada")), "Asked in its first turn, before you wrote.");
  assert.equal(access.turnNote("hi"), undefined);
  const bash = access.describeTool({ name: "bash" }, { kind: "coding" });
  const question = access.accessQuestion([bash], [], "To run tests.", access.turnNote("[from @scout] run them"));
  assert.equal(question.method === "select" && question.message, "To run tests.\n\nAsked while handling a message from @scout.");
  assert.equal(isBotAccessQuestion(question), true, "the catalog finds it among the chat's questions");
  assert.equal(isBotAccessQuestion({ method: "select", title: "Pick a colour", options: ["Allow", "Deny"] }), false);
  assert.equal(isBotAccessQuestion({ method: "confirm", title: "Allow access to bash?" }), false);
});

test("request_access lets one request per bot wait for the operator; the next may ask once it is answered", async () => {
  const asked: unknown[] = [];
  let answer!: (response: { value: string }) => void;
  let applied = 0;
  const offer = [access.describeTool({ name: "write" }, { kind: "coding" }), access.describeTool({ name: "edit" }, { kind: "coding" })];
  const chat = {
    botOffer: () => offer,
    availableSkills: async () => [],
    ask: (question: unknown) => { asked.push(question); return new Promise<{ value: string }>((resolve) => { answer = resolve; }); },
    applyTools: async () => { applied += 1; },
    runInput: () => "[routine: Morning digest] check the inbox",
  };
  const tool = access.botAccessParts({ chat: () => chat, skills: async () => [], agentDir: "/nowhere" }).tools.find((each) => each.name === "request_access")!;
  const state = { bot: "bot-a", disabledTools: ["write", "edit"], disabledSkills: [] as BotSkillRef[] };
  const api = {
    conversationId: 1 as unknown as ConversationId, callId: "call",
    snapshot: async () => state,
    agent: async () => ({ tools: [{ name: "read" }, { name: "request_access" }] }),
    commit: async (change: (tx: unknown) => unknown) => change({ doc: async () => state }),
  } as unknown as ToolExecutionApi;
  const first = tool.execute({ tools: ["write"], reason: "First." } as never, api, BACKGROUND_CONTEXT);
  while (!asked.length) await new Promise((resolve) => setImmediate(resolve));
  assert.match(JSON.stringify(asked[0]), /First\.\\n\\nAsked during the routine \\"Morning digest\\"\./u, "a routine's turn may ask; the operator is told");
  const second = await tool.execute({ tools: ["edit"], reason: "Second." } as never, api, BACKGROUND_CONTEXT);
  assert.equal(second.isError, true);
  assert.match(JSON.stringify(second.content), /Another access request is already waiting for the operator/u);
  assert.equal(asked.length, 1, "the second never reached the operator");
  answer({ value: "Allow" });
  const done = await first;
  assert.deepEqual(done.control, { addTools: ["write"] });
  assert.deepEqual(state.disabledTools, ["edit"], "turned back on");
  assert.equal(applied, 1, "the chat's tools are offered again at once");
  const again = tool.execute({ tools: ["edit"], reason: "Now." } as never, api, BACKGROUND_CONTEXT);
  while (asked.length < 2) await new Promise((resolve) => setImmediate(resolve));
  answer({ value: "Deny" });
  assert.match(JSON.stringify((await again).content), /The operator denied the request/u);
  assert.deepEqual(state.disabledTools, ["edit"]);
  assert.equal(applied, 1);
});

/* ── a bot's chat in a real harness ──────────────────────────────────── */

function fakeMemory(): BotMemory {
  return {
    enable: async () => {}, configure: async () => {}, disable: async () => {}, purge: async () => {}, status: async () => undefined,
    view: async () => "", zoom: async () => "", html: async () => "", subscribe: () => () => {},
  };
}

const EXTENSION = "export default function (pi) {\n"
  + "  pi.registerTool({ name: 'fixture_echo', label: 'Echo', description: 'Echoes text.', promptSnippet: 'Echo text back', parameters: { type: 'object', properties: { text: { type: 'string' } } }, async execute(_id, params) { return { content: [{ type: 'text', text: 'echo: ' + params.text }], details: {} }; } });\n"
  + "  pi.registerTool({ name: 'fixture_other', label: 'Other', description: 'Another extension tool.', parameters: { type: 'object', properties: {} }, async execute() { return { content: [{ type: 'text', text: 'other' }], details: {} }; } });\n"
  + "}\n";
const LATER = "export default function (pi) {\n"
  + "  pi.registerTool({ name: 'fixture_later', label: 'Later', description: 'Installed after the bot was set up.', parameters: { type: 'object', properties: {} }, async execute() { return { content: [{ type: 'text', text: 'later' }], details: {} }; } });\n"
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
  /** A bot's chat with these lists, open as a HUI session. */
  const bot = async (lists: BotAccess, huiSessionId = "bot-chat") => {
    const reference = await port.create({ botId: `bot-${huiSessionId}`, cwd, memory: { name: "Ada" } });
    const id = durableConversationId(reference)!;
    await (await host.open()).commit(async (tx) => {
      const doc = await tx.doc(BotDoc, id);
      doc.disabledTools = [...lists.disabledTools];
      doc.disabledSkills = lists.disabledSkills.map((ref) => ({ ...ref }));
    }, durableContext);
    const session = await startDurable({ cwd, sessionFile: reference, huiSessionId }, host);
    return { id, reference, session };
  };
  /** How a bot's lists name one of the directory's skills. */
  const ref = async (name: string) => access.skillRef((await host.prompt.loader(cwd)).getSkills().skills.find((skill) => skill.name === name)!);
  return { dir, agentDir, cwd, log, host, invocations, bot, ref };
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
const replies = (session: DurableSession) => session.transcript().filter((entry) => entry.kind === "message" && entry.role === "assistant").length;

test("a bot has every tool and skill a session in its directory has until the operator turns some off, and its requests are unchanged", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const plain = await startDurable({ cwd: f.cwd, huiSessionId: "plain" }, f.host);
  const plainTools = names((await plain.inspect()).tools);
  const { id, session } = await f.bot(NONE);
  assert.deepEqual(names((await session.inspect()).tools), [...plainTools, "message_bot", "write_soul", "set_profile"], "every tool, message_bot and its soul and profile tools");
  assert.deepEqual((await (await f.host.open()).snapshot(AgentDoc, id, durableContext))?.tools, { remove: ["request_access", "load_skill"] },
    "its own tools wait until it has a use for them");
  assert.deepEqual(names(session.botOffer()), [...plainTools, "message_bot"], "the operator can turn off any of them but its essentials");
  assert.equal(session.botOffer().find((tool) => tool.name === "fixture_other")?.group, "extension");
  assert.deepEqual(plain.botOffer(), []);
  await session.prompt("plain turn");
  await settledWith(session, answered("Fixture response"));
  const [first] = await requests(f.log);
  assert.deepEqual(toolNames(first), [...plainTools, "message_bot", "write_soul", "set_profile"]);
  const system = JSON.stringify(first?.system);
  assert.match(system, /Use the read tool to load a skill's file/u, "PI's own skills section, every skill");
  assert.match(system, /<name>alpha<\/name>[^]*<name>beta<\/name>/u);
  assert.doesNotMatch(system, /<bot_access>|request_access|load_skill/u);
});

test("what the operator turns off leaves a bot's offer, extension tools included, and a tool installed later is on", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id, session } = await f.bot(off(["bash", "fixture_other", "terminal"]));
  const tools = names((await session.inspect()).tools);
  for (const name of ["bash", "fixture_other", "terminal", "load_skill"]) assert.ok(!tools.includes(name), name);
  for (const name of ["read", "write", "fixture_echo", "sessions_spawn", "message_bot", "request_access"]) assert.ok(tools.includes(name), name);
  assert.deepEqual((await (await f.host.open()).snapshot(AgentDoc, id, durableContext))?.tools, { remove: ["bash", "terminal", "fixture_other", "load_skill"] }, "removed by name");
  await session.prompt("plain turn");
  await settledWith(session, answered("Fixture response"));
  const [first] = await requests(f.log);
  assert.deepEqual(toolNames(first), tools, "the provider sees exactly that offer");
  assert.match(JSON.stringify(first?.system), /<bot_access>\\nThe operator turned off some of your tools and skills in this chat:\\nTools:\\n- bash: Run shell commands \(powerful\)\\n- terminal: Read and operate the user's shared terminal \(powerful\)\\n- fixture_other: Another extension tool\\nIf a job truly needs one of them, ask for it with request_access/u);

  await writeFile(join(f.agentDir, "extensions", "later.js"), LATER);
  await session.reload();
  const reloaded = names((await session.inspect()).tools);
  assert.ok(reloaded.includes("fixture_later"), "a tool installed later is on until the operator turns it off");
  assert.ok(!reloaded.includes("bash") && !reloaded.includes("fixture_other"), "what was off stays off");
  assert.ok(session.botOffer().some((tool) => tool.name === "fixture_later"));
  const plain = await startDurable({ cwd: f.cwd, huiSessionId: "plain" }, f.host);
  assert.ok(names((await plain.inspect()).tools).includes("bash"), "a session in the same directory keeps it");
});

test("the HUI tool bridge refuses a bot's call to a HUI tool the operator turned off, whatever it was offered", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id } = await f.bot(off(["sessions_history", "terminal", "message_bot"]));
  const harness = await f.host.open();
  const api = (callId: string) => ({
    conversationId: id, callId,
    snapshot: (doc: never, conversationId: ConversationId, context: never) => harness.snapshot(doc, conversationId, context),
  }) as unknown as ToolExecutionApi;
  const huiTool = (name: string) => f.host.huiTools.find((tool) => tool.name === name)!;
  await assert.rejects(huiTool("sessions_history").execute({ sessionKey: "child" } as never, api("c1"), BACKGROUND_CONTEXT), /The operator turned off sessions_history in this bot's chat\. Ask for it with request_access/u);
  await assert.rejects(huiTool("terminal").execute({ action: "list" } as never, api("c2"), BACKGROUND_CONTEXT), /turned off terminal/u);
  const messageBot = f.host.botTools.find((tool) => tool.name === "message_bot")!;
  const refused = await messageBot.execute({ to: "bob", message: "hi" } as never, api("c3"), BACKGROUND_CONTEXT);
  assert.equal(refused.isError, true);
  assert.match(JSON.stringify(refused.content), /turned off message_bot/u, "message_bot can be turned off too");
  assert.equal(f.invocations.length, 0, "nothing reached HUI");
  await huiTool("sessions_list").execute({} as never, api("c4"), BACKGROUND_CONTEXT);
  assert.deepEqual(f.invocations.map((invocation) => invocation.action), ["sessions_list"], "a tool that is on reaches HUI");
});

test("request_access: Allow turns the tool back on for the very next request", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id, session } = await f.bot(off(["bash"]));
  const asked = nextQuestion(session);
  await session.prompt(calls({ name: "request_access", input: { tools: ["bash"], reason: "To run the project's checks." } }));
  const question = await asked;
  assert.deepEqual({ ...question, id: undefined }, { id: undefined, method: "select", title: "Allow access to bash (powerful)?", message: "To run the project's checks.", options: ["Allow", "Deny"] });
  assert.deepEqual(session.pendingQuestions().map((each) => each.id), [question.id], "a session question, answered like any other");
  await session.respondQuestion(question.id, { value: "Allow" });
  await settledWith(session, answered("tool answered: The operator allowed it: you now have bash, from your next step."));
  const harness = await f.host.open();
  assert.deepEqual((await harness.snapshot(BotDoc, id, durableContext))?.disabledTools, []);
  const logged = await requests(f.log);
  assert.ok(!toolNames(logged[0]).includes("bash") && toolNames(logged[0]).includes("request_access"));
  assert.ok(toolNames(logged[1]).includes("bash"), "the request after the answer offers it");
  assert.ok(!toolNames(logged[1]).includes("request_access"), "with nothing left to ask for");
  assert.doesNotMatch(JSON.stringify(logged[1]?.system), /<bot_access>/u);
});

test("request_access: Deny refuses and changes nothing; a typed answer reaches the bot", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id, session } = await f.bot(off(["write"]));
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
  assert.deepEqual((await harness.snapshot(BotDoc, id, durableContext))?.disabledTools, ["write"]);
  assert.ok((await requests(f.log)).every((request) => !toolNames(request).includes("write")), "never offered");
});

test("request_access refuses unknown names with the ones that are off, and asks nothing for what the bot has", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id, session } = await f.bot(off(["bash", "fixture_other", "write", "edit"], [await f.ref("beta")]));
  let questions = 0;
  session.subscribe((event) => { if (event.type === "question") questions += 1; });
  await session.prompt(calls({ name: "request_access", input: { tools: ["teleport", "read"], skills: ["gamma"], reason: "Because." } }));
  await settledWith(session, answered("tool answered:"));
  assert.equal(lastReply(session), "tool answered: No tool named teleport. You can ask for: write, edit, bash, fixture_other. No skill named gamma. You can ask for: beta.");
  await session.prompt(calls({ name: "request_access", input: { tools: ["read"], skills: ["alpha"], reason: "Again." } }));
  await settledWith(session, answered("tool answered: You already have read and the alpha skill."));
  assert.equal(questions, 0);

  // Two requests in one round: the operator never has two waiting. Durable runs this round's calls one after the
  // other, so the second asks once the first is answered; were they to overlap, the second would be refused.
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
  await settledWith(session, (entries) => answered("tool answered:")(entries) && replies(session) >= 3);
  const both = lastReply(session);
  assert.match(both, /The operator allowed it: you now have (write|edit), from your next step\./u);
  assert.match(both, /The operator denied the request\.|Another access request is already waiting for the operator\./u);
  assert.equal(most, 1, "never more than one request waits for the operator");
  const left = (await (await f.host.open()).snapshot(BotDoc, id, durableContext))?.disabledTools;
  assert.ok(left?.length === 3 && left[0] === "bash" && left[1] === "fixture_other" && ["write", "edit"].includes(left[2]!), JSON.stringify(left));
});

test("a bot's prompt and /skill: offer only the skills that are on; a session in its directory keeps them all", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const plain = await startDurable({ cwd: f.cwd, huiSessionId: "plain" }, f.host);
  const { session } = await f.bot(off([], [await f.ref("beta")]));
  const tools = names((await session.inspect()).tools);
  assert.ok(tools.includes("request_access") && !tools.includes("load_skill"), "a turned-off skill is something to ask for; read loads the rest");
  await session.prompt("plain turn");
  await settledWith(session, answered("Fixture response"));
  const system = JSON.stringify((await requests(f.log))[0]?.system);
  assert.match(system, /Use the read tool to load a skill's file/u);
  assert.match(system, /<name>alpha<\/name>/u);
  assert.doesNotMatch(system, /<name>beta<\/name>/u, "a skill that is off is not in the prompt");
  assert.match(system, /Skills:\\n- beta: Beta procedures\./u);
  const commands = (await session.listCommands()).filter((command) => command.source === "skill").map((command) => command.name);
  assert.deepEqual(commands, ["skill:alpha", "skill:create-verification-skill", "skill:git-selective-staging"]);
  await session.prompt("/skill:beta please");
  await settledWith(session, () => replies(session) >= 2);
  await session.prompt("/skill:alpha please");
  await settledWith(session, () => replies(session) >= 3);
  const users = (await requests(f.log)).slice(1).map((request) => JSON.stringify(request.messages?.at(-1)));
  assert.match(users[0]!, /\/skill:beta please/u, "not one of its skills: sent as typed");
  assert.doesNotMatch(users[0]!, /SKILL_BODY_BETA/u);
  assert.match(users[1]!, /<skill name=\\"alpha\\"[^]*SKILL_BODY_ALPHA[^]*please/u);

  const plainCommands = (await plain.listCommands()).filter((command) => command.source === "skill").map((command) => command.name);
  assert.deepEqual(plainCommands.sort(), ["skill:alpha", "skill:beta", "skill:create-verification-skill", "skill:git-selective-staging"]);
  await plain.prompt("plain session turn");
  await settledWith(plain, answered("Fixture response"));
  assert.match(JSON.stringify((await requests(f.log)).at(-1)?.system), /<name>alpha<\/name>[^]*<name>beta<\/name>/u);
});

test("a bot with neither read nor bash loads its skills with load_skill, which refuses skills that are off and paths that leave the skill", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { session } = await f.bot(off(["read", "bash"], [await f.ref("beta")]));
  assert.ok(names((await session.inspect()).tools).includes("load_skill"));
  await session.prompt(calls(
    { name: "load_skill", input: { name: "alpha" } },
    { name: "load_skill", input: { name: "alpha", path: "references/notes.md" } },
    { name: "load_skill", input: { name: "alpha", path: "../beta/SKILL.md" } },
    { name: "load_skill", input: { name: "beta" } },
    { name: "load_skill", input: { name: "gamma" } },
  ));
  await settledWith(session, answered("tool answered:"));
  const system = JSON.stringify((await requests(f.log))[0]?.system);
  assert.match(system, /<skills>\\nThe following skills provide specialized instructions for specific tasks\.\\nUse the load_skill tool/u);
  assert.match(system, /<name>alpha<\/name>/u);
  assert.doesNotMatch(system, /<name>beta<\/name>|Use the read tool/u);
  const [skill, notes, escape, other, unknown] = lastReply(session).replace(/^tool answered: /u, "").split(" | ");
  assert.match(skill!, /^<skill name="alpha" location="[^"]+alpha\/SKILL\.md">\nReferences are relative to [^\n]+alpha\.\n\n# alpha\n\nSKILL_BODY_ALPHA\n<\/skill>$/u);
  assert.equal(notes, "NOTES_ALPHA\n");
  assert.equal(escape, "../beta/SKILL.md is not a file inside the alpha skill's directory.");
  assert.equal(other, "The operator turned off the beta skill. Ask for it with request_access if the job needs it.");
  assert.equal(unknown, "You have no skill named \"gamma\". Your skills: alpha, create-verification-skill, git-selective-staging.");
});

test("a skill turned back on through request_access is in the next request's prompt", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const { id, session } = await f.bot(off(["read", "bash"], [await f.ref("beta")]));
  const asked = nextQuestion(session);
  await session.prompt(calls({ name: "request_access", input: { skills: ["beta"], reason: "For the beta procedures." } }));
  const question = await asked;
  assert.equal(question.method === "select" && question.title, "Allow access to the beta skill?");
  await session.respondQuestion(question.id, { value: "Allow" });
  await settledWith(session, answered("you now have the beta skill, from your next step. Load a skill with load_skill."));
  const [first, second] = await requests(f.log);
  assert.doesNotMatch(JSON.stringify(first?.system), /<name>beta<\/name>/u);
  assert.match(JSON.stringify(second?.system), /<skills>[^]*<name>beta<\/name>/u);
  assert.ok(toolNames(second).includes("load_skill"));
  assert.deepEqual((await (await f.host.open()).snapshot(BotDoc, id, durableContext))?.disabledSkills, []);
});

test("the conversations port writes the lists in the creating commit, reads and replaces them, and lists what can be turned off", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const port = durableBotConversations(f.host, fakeMemory());
  const beta = await f.ref("beta");
  const builtin = await port.offer(undefined, f.cwd);
  assert.equal(builtin.live, false);
  assert.ok(builtin.tools.some((tool) => tool.name === "bash") && builtin.tools.some((tool) => tool.name === "message_bot"));
  assert.ok(!builtin.tools.some((tool) => tool.name === "fixture_echo"), "no chat runs yet: no extension's tools");
  assert.ok(!builtin.tools.some((tool) => ["write_soul", "set_profile", "request_access", "load_skill"].includes(tool.name)), "a bot's own tools are never offered");
  assert.deepEqual(builtin.alwaysOn.map((tool) => tool.name), ["write_soul", "set_profile", "request_access", "load_skill", "zoom", "date"]);
  const bundled = builtin.skills.find((skill) => skill.name === "create-verification-skill");
  assert.equal(bundled?.source, "HUI defaults");
  assert.equal(bundled?.path, "hui:skill:create-verification-skill", "a bundled skill by its stable path");
  assert.deepEqual(builtin.skills.find((skill) => skill.name === "beta"), { ...beta, description: "Beta procedures.", source: join(f.agentDir, "skills") });

  const reference = await port.create({ botId: "bot-port", cwd: f.cwd, memory: { name: "Port" }, access: off(["bash"], [beta]) });
  const id = durableConversationId(reference)!;
  const harness = await f.host.open();
  assert.deepEqual(await harness.snapshot(BotDoc, id, durableContext), { bot: "bot-port", disabledTools: ["bash"], disabledSkills: [beta] }, "in the creating commit");
  assert.deepEqual(await port.access(reference), off(["bash"], [beta]));
  const session = await startDurable({ cwd: f.cwd, sessionFile: reference, huiSessionId: "port-chat" }, f.host);
  assert.ok(!names((await session.inspect()).tools).includes("bash"), "the first turn already goes without it");
  const live = await port.offer(reference, f.cwd);
  assert.equal(live.live, true);
  assert.ok(live.tools.some((tool) => tool.name === "fixture_echo" && tool.group === "extension"), "a running chat lists its extensions' tools");

  await port.setAccess(reference, off(["fixture_echo"]));
  assert.deepEqual(await harness.snapshot(BotDoc, id, durableContext), { bot: "bot-port", disabledTools: ["fixture_echo"] }, "an empty list leaves the document");
  const tools = names((await session.inspect()).tools);
  assert.ok(tools.includes("bash") && !tools.includes("fixture_echo"), "the running chat is offered its tools again at once");
  await port.setAccess(reference, NONE);
  assert.deepEqual(await harness.snapshot(BotDoc, id, durableContext), { bot: "bot-port" });
  await port.setAccess(reference, off(["bash"]));
  await port.forget(reference);
  assert.deepEqual(await harness.snapshot(BotDoc, id, durableContext), { bot: "" }, "a forgotten chat keeps no lists");
  await assert.rejects(port.setAccess(reference, off(["bash"])), /no bot's chat/u);
});

test("a bot document from before the lists reads as nothing turned off, and an older HUI still reads one with lists", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  // The bot document as releases before the lists define it.
  const V1 = defineDoc<{ bot: string }>({ kind: "hui.bot", version: 1, scope: "conversation", history: "latest", fork: "current", initial: () => ({ bot: "" }) });
  const harness = await f.host.open();
  const created = await harness.createConversation({
    ownership: { kind: "ownerless" }, agent: { cwd: f.cwd },
    init: async (tx, conversationId) => { (await tx.doc(V1, conversationId)).bot = "bot-old"; },
  }, durableContext);
  assert.deepEqual(await harness.snapshot(BotDoc, created.id, durableContext), { bot: "bot-old" });
  assert.deepEqual(await f.host.botStateFor(created.id), { bot: "bot-old", disabledTools: [], disabledSkills: [] }, "absent lists: nothing off");
  const { id: restricted } = await f.bot(off(["bash"], [await f.ref("beta")]), "restricted");
  const old = await harness.snapshot(V1, restricted, durableContext);
  assert.equal(old?.bot, "bot-restricted", "the same version: an older HUI reads it and ignores the lists, so a rollback keeps the chat");
  const plain = await startDurable({ cwd: f.cwd, huiSessionId: "plain" }, f.host);
  const session = await startDurable({ cwd: f.cwd, sessionFile: `durable:${created.id}`, huiSessionId: "old-chat" }, f.host);
  assert.deepEqual(names((await session.inspect()).tools), [...names((await plain.inspect()).tools), "message_bot", "write_soul", "set_profile"], "every tool, as before");
});
