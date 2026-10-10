import assert from "node:assert/strict";
import test from "node:test";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { BotCatalog, BotCatalogTool, BotView } from "../../shared/bots.ts";
import {
  BotToolsController, botToolsKey, botToolsSummary, groupBotTools, matchingSkills, parseBotCatalog, skillsAfter, toolsAfter, type BotToolsApi,
} from "./bot-tools.ts";
import { parseBot } from "./bots.ts";

const tool = (name: string, group: BotCatalogTool["group"], extra: Partial<BotCatalogTool> = {}): BotCatalogTool => ({
  name, label: name, description: `the ${name} tool`, group, source: group === "extension" ? "user · a.js" : "HUI", powerful: false, enabled: true, ...extra,
});

const CATALOG: BotCatalog = {
  tools: [
    tool("read", "files"), tool("bash", "shell", { powerful: true, enabled: false }), tool("sessions_spawn", "hui", { powerful: true }),
    tool("echo", "extension"), tool("weather", "extension", { source: "user · b.js" }), tool("other", "extension"), tool("message_bot", "bots"),
  ],
  skills: [
    { name: "alpha", path: "/s/alpha/SKILL.md", description: "Writes release notes.", source: "/s", enabled: true },
    { name: "beta", path: "/s/beta/SKILL.md", description: "Triage bugs.", source: "HUI defaults", enabled: false },
  ],
  alwaysOn: [{ name: "write_soul", description: "Rewrite its SOUL.md" }],
  disabledTools: ["bash"],
  disabledSkills: [{ name: "beta", path: "/s/beta/SKILL.md" }],
  live: true,
};

test("tools group as Files, Shell, HUI, each extension by its source, then Bots, keeping their order", () => {
  assert.deepEqual(groupBotTools(CATALOG.tools).map((group) => [group.title, group.source ?? "", group.tools.map((each) => each.name)]), [
    ["Files", "", ["read"]], ["Shell", "", ["bash"]], ["HUI", "", ["sessions_spawn"]],
    ["Extension", "user · a.js", ["echo", "other"]], ["Extension", "user · b.js", ["weather"]], ["Bots", "", ["message_bot"]],
  ]);
  assert.deepEqual(groupBotTools([]), []);
});

test("the summary says everything is on, or how much is off", () => {
  assert.equal(botToolsSummary(CATALOG), "1 of 7 tools and 1 of 2 skills are off.");
  assert.equal(botToolsSummary({ tools: [tool("read", "files")], skills: [] }), "Everything is on: 1 tool and 0 skills.");
  assert.equal(botToolsSummary({ tools: [tool("read", "files", { enabled: false })], skills: [] }), "1 of 1 tool is off.");
  assert.equal(botToolsSummary({ tools: [], skills: CATALOG.skills }), "1 of 2 skills is off.");
});

test("skills are searched by every word in their name, description or source; switches change whole lists", () => {
  assert.deepEqual(matchingSkills(CATALOG.skills, "  ").map((skill) => skill.name), ["alpha", "beta"]);
  assert.deepEqual(matchingSkills(CATALOG.skills, "BUGS triage").map((skill) => skill.name), ["beta"]);
  assert.deepEqual(matchingSkills(CATALOG.skills, "defaults").map((skill) => skill.name), ["beta"]);
  assert.deepEqual(matchingSkills(CATALOG.skills, "nothing"), []);
  assert.deepEqual(toolsAfter(CATALOG, "bash", true), []);
  assert.deepEqual(toolsAfter(CATALOG, "read", false), ["bash", "read"]);
  assert.deepEqual(skillsAfter(CATALOG, CATALOG.skills[1]!, true), []);
  assert.deepEqual(skillsAfter(CATALOG, CATALOG.skills[0]!, false), [{ name: "beta", path: "/s/beta/SKILL.md" }, { name: "alpha", path: "/s/alpha/SKILL.md" }]);
});

test("the catalog is narrowed on the way in, and a bot's lists come with its record", () => {
  const parsed = parseBotCatalog({
    ...CATALOG, tools: [...CATALOG.tools, { label: "no name" }, { name: "odd", group: "weird" }], skills: [...CATALOG.skills, { name: "x" }],
    request: { id: "q", sessionId: "s", title: "Allow access to bash (powerful)?", message: "Why." }, extra: true,
  });
  assert.equal(parsed.tools.length, 8);
  assert.equal(parsed.tools.at(-1)?.group, "extension", "an unknown group is an extension's");
  assert.equal(parsed.skills.length, 2);
  assert.deepEqual(parsed.request, { id: "q", sessionId: "s", title: "Allow access to bash (powerful)?", message: "Why." });
  assert.throws(() => parseBotCatalog({ tools: [] }), /did not come back/u);
  assert.equal(parseBotCatalog({ ...CATALOG, request: { id: "q" } }).request, undefined);
  const bot = parseBot({ id: "b", name: "Ada", sessionId: "s", disabledTools: ["bash", 3], disabledSkills: [{ name: "beta", path: "/p" }, { name: "x" }] });
  assert.deepEqual([bot?.disabledTools, bot?.disabledSkills], [["bash"], [{ name: "beta", path: "/p" }]]);
  assert.equal("disabledTools" in parseBot({ id: "b", name: "Ada", sessionId: "s" })!, false);
});

class Host implements ReactiveControllerHost {
  updates = 0;
  controllers: ReactiveController[] = [];
  addController(controller: ReactiveController) { this.controllers.push(controller); }
  removeController() {}
  requestUpdate() { this.updates += 1; }
  get updateComplete() { return Promise.resolve(true); }
}

const BOT = { id: "bot-a", name: "Ada", sessionId: "s-a", status: "idle", updatedAt: "2026-10-07T00:00:00.000Z" } as BotView;

test("the controller reads the catalog for one bot, saves one whole list at a time, and answers the request", async () => {
  const calls: string[] = [];
  let catalog: BotCatalog = { ...CATALOG, request: { id: "q-1", sessionId: "s-a", title: "Allow access to bash (powerful)?", message: "Why." } };
  let release: (() => void) | undefined;
  const api: BotToolsApi = {
    load: async (id) => { calls.push(`load ${id}`); return catalog; },
    save: async (id, change) => {
      calls.push(`save ${id} ${JSON.stringify(change)}`);
      await new Promise<void>((resolve) => { release = resolve; });
      catalog = { ...catalog, disabledTools: change.disabledTools ?? catalog.disabledTools };
    },
    answer: async (sessionId, questionId, value) => { calls.push(`answer ${sessionId} ${questionId} ${value}`); catalog = { ...catalog, disabledTools: [] }; delete catalog.request; },
  };
  const host = new Host();
  const tools = new BotToolsController(host, api);
  assert.equal(host.controllers[0], tools);
  assert.equal(tools.props(BOT).state.loading, true, "nothing read yet");
  await tools.refresh(BOT);
  let props = tools.props(BOT);
  assert.equal(props.state.catalog?.request?.id, "q-1");
  props.onToggleTool("read", false);
  props.onToggleTool("sessions_spawn", false);
  assert.equal(tools.state.saving, true);
  assert.deepEqual(calls, ["load bot-a", "save bot-a {\"disabledTools\":[\"bash\",\"read\"]}"], "no second list while the first is on its way");
  tools.follow({ ...BOT, updatedAt: "later" });
  assert.equal(calls.length, 2, "the stream waits for the save too");
  release!();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.slice(2), ["load bot-a"], "the saved lists are read back");
  assert.deepEqual(tools.state.catalog?.disabledTools, ["bash", "read"]);
  props = tools.props(BOT);
  props.onAnswer("Allow");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.slice(3), ["answer s-a q-1 Allow", "load bot-a"]);
  assert.equal(tools.state.catalog?.request, undefined);
  // The stream: only a change the catalog shows reads it again.
  tools.follow({ ...BOT, updatedAt: "later" });
  const before = calls.length;
  tools.follow({ ...BOT, updatedAt: "later" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, before, "the same key: nothing to read");
  assert.equal(botToolsKey({ status: "waiting", updatedAt: "x" }), "waiting|x");
  // Another bot starts clean; a failed read keeps what was shown.
  tools.reset("bot-b");
  assert.equal(tools.state.catalog, undefined);
  api.load = async () => { throw new Error("gateway down"); };
  await tools.refresh({ ...BOT, id: "bot-b" });
  assert.equal(tools.state.error, "gateway down");
});
