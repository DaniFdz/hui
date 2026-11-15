/**
 * The chief route: a group's label is read exactly as the group routes read it, a group without a project directory gets
 * no chief, and the pack's skills go to the host that keeps the new bot's home — its worker's, never this gateway's.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import type { BotView } from "../api/bots.ts";
import type { BotOwnSkill, BotSkillFiles } from "../bots/skills.ts";
import type { JsonResult, RouteRequest, RouteResult } from "../http/route.ts";

// The registries are read once, at import time, so the throwaway home has to exist before the modules load.
const home = await mkdtemp(join(tmpdir(), "hui-staff-routes-"));
process.env["HOME"] = home;
process.env["XDG_CONFIG_HOME"] = home;

const { createStaffRoutes } = await import("./staff.ts");
const { createSessionRoutes } = await import("./sessions.ts");
const { readSessionGroups, writeRegistry } = await import("../sessions/sessions.ts");
const { GROUP_PROJECT_MISSING } = await import("../sessions/group-session-defaults.ts");
const { readStaffPack } = await import("../staff/pack.ts");
const { readHuiSettings } = await import("../hui-settings.ts");

const list = { revision: 7, groups: [] };

/** The group routes, over the real group registry: what the chief route then has to find. */
const groupRoutes = createSessionRoutes({
  sessionList: { refresh: async () => list, snapshot: async () => list },
  lifecycle: {} as never,
  views: {} as never,
  bots: {} as never,
  workers: { list: async () => [{ id: "worker-1", name: "Worker one", command: "ssh box", extraPaths: [], state: "disconnected" }] },
});

function request(path: string, body: unknown): RouteRequest {
  return {
    method: "POST",
    path,
    query: new URLSearchParams(),
    headers: {},
    json: async () => body,
    bytes: async () => Buffer.alloc(0),
    stream: () => (async function* () {})() as AsyncIterable<Buffer>,
    signal: new AbortController().signal,
  };
}

const chief = (body: unknown) => request("/__hui/staff/chiefs", body);

/** The JSON answer a request got: every route that refuses one does so with a body. */
function json(result: RouteResult | undefined): JsonResult {
  assert.ok(result && "body" in result, `expected a JSON answer, got ${JSON.stringify(result)}`);
  return result;
}

const createGroup = (body: unknown) => groupRoutes.handle(request("/__hui/session-groups", body));

/** A skill port that records every write, standing in for a gateway's or a worker's own. */
function port(name: string, writes: { port: string; botId: string; skills: readonly BotOwnSkill[] }[]): BotSkillFiles {
  return {
    files: true,
    write: async (botId, skills) => { writes.push({ port: name, botId, skills }); },
    read: async () => [],
  };
}

test("a chief's pack goes to the host that keeps its home, never this gateway's for a worker's bot", async () => {
  const writes: { port: string; botId: string; skills: readonly BotOwnSkill[] }[] = [];
  const seen: { id: string; worker?: { id: string } }[] = [];
  const recorded: string[] = [];
  const created: Record<string, unknown>[] = [];
  const routes = createStaffRoutes({
    groups: async () => [
      { label: "Remote project", worker: "worker-1", cwd: "/srv/remote" },
      { label: "Local project", cwd: home },
    ],
    bots: async () => [],
    getBot: async () => { throw new Error("no chief exists yet"); },
    createBot: async (body) => {
      created.push(body);
      const id = body["worker"] ? "chief-remote" : "chief-local";
      return { id, ...(body["worker"] ? { worker: { id: String(body["worker"]), name: "Worker one" } } : {}) } as BotView;
    },
    restoreBot: async () => { throw new Error("no chief is archived"); },
    // The created bot alone decides where its files go: its worker's port, or this gateway's.
    skills: (bot) => {
      seen.push(bot);
      return bot.worker ? port("worker", writes) : port("gateway", writes);
    },
    readSettings: readHuiSettings,
    writeSettings: async (settings) => settings,
    recordChief: async (botId) => { recorded.push(botId); },
  });
  const pack = await readStaffPack();

  assert.equal((await routes.handle(chief({ group: "Remote project" })))?.status, 201);
  assert.equal((await routes.handle(chief({ group: "Local project" })))?.status, 201);

  assert.deepEqual(seen, [{ id: "chief-remote", worker: { id: "worker-1", name: "Worker one" } }, { id: "chief-local" }],
    "each port is asked for the bot the route just created");
  assert.deepEqual(writes.map(({ port: name, botId }) => [name, botId]), [["worker", "chief-remote"], ["gateway", "chief-local"]],
    "a worker's chief writes its skills on that worker, and only a local chief writes here");
  assert.deepEqual(writes[0]!.skills.map((skill) => skill.name), pack.skills.map((skill) => skill.name), "the pack's own skills");
  assert.deepEqual(recorded, ["chief-remote", "chief-local"], "a chief is recorded whichever host keeps its skills");
});

test("a host that keeps no bot skills gets no write, and the chief is still recorded", async () => {
  const writes: { port: string; botId: string; skills: readonly BotOwnSkill[] }[] = [];
  const recorded: string[] = [];
  const routes = createStaffRoutes({
    groups: async () => [{ label: "Old worker", worker: "worker-1", cwd: "/srv/old" }],
    bots: async () => [],
    getBot: async () => { throw new Error("no chief exists yet"); },
    createBot: async () => ({ id: "chief-old", worker: { id: "worker-1", name: "Worker one" } }) as BotView,
    restoreBot: async () => { throw new Error("no chief is archived"); },
    // As `services.ts` answers for a worker that predates its bot skill files.
    skills: () => undefined,
    readSettings: readHuiSettings,
    writeSettings: async (settings) => settings,
    recordChief: async (botId) => { recorded.push(botId); },
  });
  const made = json(await routes.handle(chief({ group: "Old worker" })));
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual(writes, [], "there is nowhere to write them");
  assert.deepEqual(recorded, ["chief-old"]);
});

test("a group's label is read as the group routes read it, so a doubled space or a tab still finds its chief", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-staff-cwd-"));
  const created: string[] = [];
  const routes = createStaffRoutes({
    groups: readSessionGroups,
    bots: async () => [],
    getBot: async () => { throw new Error("no chief exists yet"); },
    createBot: async (body) => { created.push(String(body["group"])); return { id: `chief-${created.length}` } as BotView; },
    restoreBot: async () => { throw new Error("no chief is archived"); },
    skills: () => undefined,
    readSettings: readHuiSettings,
    writeSettings: async (settings) => settings,
    recordChief: async () => {},
  });
  try {
    await writeRegistry([]);
    // A doubled space is part of the label the group keeps, and the chief route finds it unchanged.
    assert.equal((await createGroup({ name: "Research  Lab", cwd: directory }))?.status, 200);
    assert.deepEqual((await readSessionGroups()).map((group) => group.label), ["Research  Lab"]);
    assert.equal((await routes.handle(chief({ group: "Research  Lab" })))?.status, 201);

    // Whitespace around a label is trimmed by both routes, so a tab the browser left in still names the group.
    assert.equal((await createGroup({ name: "\tTabbed Lab\t", cwd: directory }))?.status, 200);
    assert.deepEqual((await readSessionGroups()).map((group) => group.label), ["Research  Lab", "Tabbed Lab"]);
    assert.equal((await routes.handle(chief({ group: "\tTabbed Lab" })))?.status, 201);

    assert.deepEqual(created, ["Research  Lab", "Tabbed Lab"]);

    // A control character inside a label is refused by both routes, so neither can hold one the other cannot name.
    const control = json(await createGroup({ name: "Research\u0007Lab", cwd: directory }));
    assert.equal(control.status, 400);
    assert.match(String((control.body as { error: string }).error), /without control characters/u);
    const unnamed = json(await routes.handle(chief({ group: "Research\u0007Lab" })));
    assert.equal(unnamed.status, 400);
    assert.match(String((unnamed.body as { error: string }).error), /without control characters/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a group with no project directory gets no chief, by the sentence its sessions refuse with", async () => {
  const writes: { port: string; botId: string; skills: readonly BotOwnSkill[] }[] = [];
  const recorded: string[] = [];
  const routes = createStaffRoutes({
    groups: async () => [{ label: "No project", worker: "worker-1" }],
    bots: async () => [],
    getBot: async () => { throw new Error("no chief exists yet"); },
    createBot: async () => { throw new Error("a chief was created for a group with no project directory"); },
    restoreBot: async () => { throw new Error("no chief is archived"); },
    skills: () => port("gateway", writes),
    readSettings: readHuiSettings,
    writeSettings: async (settings) => settings,
    recordChief: async (botId) => { recorded.push(botId); },
  });
  const refused = json(await routes.handle(chief({ group: "No project" })));
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.deepEqual(refused.body, { error: GROUP_PROJECT_MISSING });
  assert.equal(GROUP_PROJECT_MISSING, "This group has no project directory. Set it in the group's New session defaults.");
  assert.deepEqual(writes, [], "nothing was written");
  assert.deepEqual(recorded, [], "nothing was recorded");
});

test("a group that already has its chief keeps it, even with no project directory recorded", async () => {
  // Asking again opens that chief rather than creating a second one; the sentence above refuses only a new chief.
  const routes = createStaffRoutes({
    groups: async () => [{ label: "No project", worker: "worker-1" }],
    bots: async () => [{ id: "chief-existing", group: "No project" }],
    getBot: async () => ({ id: "chief-existing" }) as BotView,
    createBot: async () => { throw new Error("a second chief was created"); },
    restoreBot: async () => { throw new Error("no chief is archived"); },
    skills: () => { throw new Error("an existing chief installs nothing"); },
    readSettings: readHuiSettings,
    writeSettings: async (settings) => settings,
    recordChief: async () => {},
  });
  const answered = json(await routes.handle(chief({ group: "No project" })));
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  assert.deepEqual(answered.body, { bot: { id: "chief-existing" } });
});
