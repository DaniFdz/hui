import assert from "node:assert/strict";
import test from "node:test";
import type { BotView } from "../shared/bots.ts";
import type { AutomationTask, AutomationTaskInput } from "../src/lib/automation-types.ts";
import { BotTemplateService, type BotTemplateDeps } from "./bot-template-import.ts";
import type { BotOffer } from "./bot-service.ts";
import type { BotOwnSkill } from "./bot-skills.ts";

const OFFER: BotOffer = {
  tools: [
    { name: "read", label: "Read files", description: "", group: "files", source: "Durable", powerful: false },
    { name: "bash", label: "Shell", description: "", group: "shell", source: "Durable", powerful: true },
    { name: "browser", label: "Browser", description: "", group: "hui", source: "HUI", powerful: true },
  ],
  skills: [{ name: "weather", path: "/home/u/.pi/agent/skills/weather/SKILL.md", description: "W", source: "~/.pi/agent/skills" }],
  alwaysOn: [],
  live: false,
};

function view(id: string, body: Record<string, unknown>): BotView {
  return {
    id, handle: String(body["handle"] ?? String(body["name"]).toLowerCase().replace(/[^a-z0-9]+/gu, "-")), name: String(body["name"]), cwd: `/bots/${id}`, sessionId: `session-${id}`,
    createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z", status: "idle", soul: Boolean(body["soul"]), unread: false, routines: 0,
    ...(body["disabledTools"] ? { disabledTools: body["disabledTools"] as string[] } : {}),
  };
}

/** A service over fakes that record what it asks for; `failRoutine` makes creating a routine fail. */
function harness(options: { failRoutine?: boolean; workerSkills?: boolean } = {}) {
  const calls: string[] = [];
  const created: Record<string, unknown>[] = [];
  const written: { botId: string; skills: readonly BotOwnSkill[] }[] = [];
  const routines: AutomationTaskInput[] = [];
  const sent: string[] = [];
  const existing = [view("old", { name: "Trip Planner", handle: "trip-planner" })];
  const deps: BotTemplateDeps = {
    bots: {
      list: async () => existing,
      create: async (body: unknown) => {
        calls.push("create");
        created.push(body as Record<string, unknown>);
        return view("new", body as Record<string, unknown>);
      },
      get: async (target: string) => view(target, { name: "Got" }),
      delete: async (target: string) => {
        calls.push(`delete ${target}`);
        return { queued: false };
      },
      send: async (_target: string, message: { text: string }) => {
        calls.push("send");
        sent.push(message.text);
        return { status: "sent" as const };
      },
      update: async () => view("new", { name: "x" }),
      catalog: async () => ({ tools: [], skills: [], alwaysOn: [], disabledTools: [], disabledSkills: [], live: false }),
      soul: async () => null,
      memory: async () => ({ status: { messages: 0, built: 0, pending: 0, viewBytes: 0, viewLines: 0, usage: { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } }, view: "" }),
    } as unknown as BotTemplateDeps["bots"],
    offer: async () => OFFER,
    models: async () => [{ provider: "anthropic", id: "claude-sonnet-4-5" }],
    routines: {
      tasks: async () => [],
      create: async (input) => {
        calls.push("routine");
        if (options.failRoutine) throw new Error("the automation store is broken");
        routines.push(input);
        return { id: "t", ...input } as unknown as AutomationTask;
      },
    },
    skills: (worker) => worker && !options.workerSkills ? undefined : {
      write: async (botId, skills) => {
        calls.push("skills");
        written.push({ botId, skills });
      },
      read: async () => [],
    },
    findWorker: async (target) => ({ id: "w1", name: target }),
    operator: async () => undefined,
    timezone: () => "UTC",
    fetchPage: async () => { throw new Error("no network in this test"); },
    now: () => Date.parse("2026-10-07T10:00:00Z"),
  };
  return { service: new BotTemplateService(deps), calls, created, written, routines, sent };
}

const GROK_LIKE = {
  format: "grok", name: "Trip Planner", soul: "Plan trips.", opener: "Where to?",
  memories: [{ name: "Home", text: "Madrid" }],
  skills: [{ name: "Weather", description: "Weather for a trip", content: "Check it." }],
  routines: [{ name: "Deals", prompt: "Find deals", schedule: "weekdays at 8" }],
  integrations: [{ name: "Web search" }, { name: "Gmail" }],
  model: "sonnet", tools: ["Read"], dropped: [], notes: [],
};

test("the plan: a unique handle, a skill renamed away from its directory's, the tools a list keeps, a resolved model, disabled routines, mapped integrations", async () => {
  const { service } = harness();
  const preview = await service.preview({ source: { kind: "text", text: JSON.stringify({ spec: "chara_card_v2", data: { name: "Trip Planner", description: "Plans." } }) } });
  assert.equal(preview.bot.handle, "trip-planner-2", "@trip-planner is taken");
  const { service: other, created, written, routines, sent, calls } = harness();
  const result = await other.create({ template: GROK_LIKE });
  assert.deepEqual(calls, ["create", "skills", "routine", "send"], "the bot, then its skills and routines, then its first turn");
  const body = created[0]!;
  assert.equal(body["model"], "anthropic/claude-sonnet-4-5");
  assert.deepEqual(body["disabledTools"], ["bash", "browser"], "a tools list only turns tools off");
  assert.match(String(body["soul"]), /^Plan trips\.\n\n## What you already know\n[\s\S]*- \*\*Home:\*\* Madrid$/u);
  assert.deepEqual(written[0]!.skills.map((skill) => skill.name), ["weather-2"], "the directory already has a weather skill");
  assert.match(written[0]!.skills[0]!.text, /^---\nname: "weather-2"\ndescription: "Weather for a trip"\n---\n\nCheck it\.\n$/u);
  assert.deepEqual(routines.map((routine) => [routine.name, routine.enabled, routine.schedule, routine.sessionId]), [["Deals", false, { kind: "cron", expression: "0 8 * * 1-5", timezone: "UTC" }, "session-new"]]);
  assert.match(sent[0]!, /^\[HUI bot created\]\nname: Trip Planner\n[\s\S]*\n\nWhere to\?$/u);
  assert.deepEqual([result.skills, result.routines, result.opener, result.warnings], [["weather-2"], 1, true, []]);
  const planned = await harness().service.preview({ source: { kind: "text", text: JSON.stringify(GROK_LIKE) } }).catch((error: unknown) => error);
  assert.ok(planned instanceof Error, "a template is not a source: the preview reads sources only");
});

test("a template whose job is in its memories keeps them: its description stands in as the persona", async () => {
  const { service, created } = harness();
  await service.create({ template: { format: "grok", name: "Weekly Planner", description: "Plans the week", soul: "", memories: [{ name: "memory 1", text: "Owns the weekly plan." }], skills: [], routines: [], integrations: [], dropped: [], notes: [] } });
  assert.match(String(created[0]!["soul"]), /^Plans the week\n\n## What you already know\n[\s\S]*- \*\*memory 1:\*\* Owns the weekly plan\.$/u);
});

test("a failure after the bot exists deletes it again, so half an import never stays", async () => {
  const { service, calls } = harness({ failRoutine: true });
  await assert.rejects(service.create({ template: GROK_LIKE }), /the automation store is broken/u);
  assert.deepEqual(calls, ["create", "skills", "routine", "delete new"]);
});

test("on a worker that can't keep a bot's own skills they are listed as dropped, and the rest still imports", async () => {
  const { service, calls } = harness({ workerSkills: false });
  const preview = await service.preview({ source: { kind: "text", text: "---\nname: helper\ndescription: Helps\n---\nHelp." }, worker: "devbox" });
  assert.deepEqual(preview.bot.worker, { id: "w1", name: "devbox" });
  const result = await service.create({ template: { ...GROK_LIKE, opener: undefined }, worker: "devbox" });
  assert.deepEqual(result.skills, []);
  assert.deepEqual(calls, ["create", "routine"]);
});
