/**
 * The staff pack installer: one seeded bot, untouched skill files updated on a new pack version, edited skills kept,
 * routes merged by name, and a deleted bot never resurrected.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { DEFAULT_SETTINGS, type Settings } from "../hui-settings.ts";
import type { BotOwnSkill } from "../bots/skills.ts";
import type { StaffPack } from "./pack.ts";
import { ensureStaff, readStaffState, staffStatus } from "./service.ts";

function pack(version: number, text: string): StaffPack {
  return {
    version,
    bot: { name: "Chief of Staff", title: "Chief of Staff", description: "Coordinates work." },
    soul: "# Who I am\nChief.\n",
    routes: [
      { name: "planner", description: "Plans the work.", model: "" },
      { name: "worker", description: "Does the work.", model: "" },
    ],
    skills: [
      { name: "chief-mode", text: `---\nname: chief-mode\n---\n${text}`, files: [{ path: "playbooks/feature.md", text: "# Feature\n" }] },
      { name: "plan", text: "---\nname: plan\n---\nPlan the shape.\n", files: [] },
    ],
  };
}

async function harness(initial: StaffPack = pack(1, "Route the work, v1.")) {
  const stateFile = join(await mkdtemp(join(tmpdir(), "hui-staff-service-")), "staff.json");
  const created: { id: string; name: string; soul?: string }[] = [];
  const own = new Map<string, BotOwnSkill[]>();
  const settings: { current: Settings } = { current: { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, routes: [] } } };
  let nextId = 1;
  const deps = {
    pack: initial,
    stateFile,
    createBot: async (body: { name: string; title: string; description: string; soul: string }) => {
      const id = `bot-${nextId++}`;
      created.push({ id, name: body.name, soul: body.soul });
      return { id };
    },
    botIds: async () => created.map((bot) => bot.id),
    skills: {
      async read(botId: string) { return (own.get(botId) ?? []).map((skill) => ({ ...skill, files: skill.files?.map((file) => ({ ...file })) })); },
      async write(botId: string, skills: readonly BotOwnSkill[]) {
        const current = own.get(botId) ?? [];
        for (const skill of skills) {
          const at = current.findIndex((entry) => entry.name === skill.name);
          if (at >= 0) current[at] = skill;
          else current.push(skill);
        }
        own.set(botId, current);
      },
    },
    readSettings: async () => settings.current,
    writeSettings: async (next: Settings) => { settings.current = next; return next; },
    now: () => new Date("2026-11-06T10:00:00Z"),
  };
  return { deps, created, own, settings, stateFile };
}

test("seeds one Chief of Staff, writes its skills, merges its routes and records what it installed", async () => {
  const h = await harness();
  const first = await ensureStaff(h.deps);
  assert.equal(first.seeded, true);
  assert.equal(first.botId, "bot-1");
  assert.deepEqual(first.written, ["chief-mode", "plan"]);
  assert.deepEqual(first.routesAdded, ["planner", "worker"]);
  assert.equal(h.created.length, 1);
  assert.match(h.created[0]!.soul!, /Chief/u);
  assert.deepEqual(h.own.get("bot-1")!.map((skill) => skill.name), ["chief-mode", "plan"]);
  assert.deepEqual(h.own.get("bot-1")![0]!.files, [{ path: "playbooks/feature.md", text: "# Feature\n" }]);
  assert.deepEqual(h.settings.current.models.routes.map((route) => [route.name, route.model]), [["planner", ""], ["worker", ""]]);
  const state = await readStaffState(h.deps);
  assert.equal(state?.botId, "bot-1");
  assert.equal(state?.packVersion, 1);
  assert.match(state!.files["skills/chief-mode/SKILL.md"]!, /^[a-f0-9]{64}$/u);
  assert.match(state!.files["skills/chief-mode/playbooks/feature.md"]!, /^[a-f0-9]{64}$/u);

  const second = await ensureStaff(h.deps);
  assert.equal(second.seeded, false);
  assert.deepEqual(second.written, []);
  assert.deepEqual(second.kept, []);
  assert.deepEqual(second.routesAdded, []);
  assert.equal(h.created.length, 1, "a restart never seeds a second bot");
  assert.equal((await readFile(h.stateFile, "utf8")).includes("\"packVersion\": 1"), true);
});

test("a new pack version replaces an untouched skill and keeps an edited one", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  // The operator changed plan; chief-mode stays as HUI installed it.
  const installed = h.own.get("bot-1")!;
  installed[1] = { name: "plan", text: "---\nname: plan\n---\nMy own plan wording.\n", files: [] };

  h.deps.pack = pack(2, "Route the work, v2.");
  const outcome = await ensureStaff(h.deps);
  assert.deepEqual(outcome.written, ["chief-mode"]);
  assert.deepEqual(outcome.kept, ["plan"]);
  assert.match(h.own.get("bot-1")![0]!.text, /v2/u, "the untouched skill follows the pack");
  assert.match(h.own.get("bot-1")![1]!.text, /My own plan wording/u, "the edited skill is never overwritten");
  assert.equal((await readStaffState(h.deps))?.packVersion, 2);
});

test("a route the operator edited is never replaced or renamed away", async () => {
  const h = await harness();
  h.settings.current = {
    ...h.settings.current,
    models: { ...h.settings.current.models, routes: [{ name: "worker", description: "Mine.", model: "openai/gpt-5", thinking: "high" }] },
  };
  const outcome = await ensureStaff(h.deps);
  assert.deepEqual(outcome.routesAdded, ["planner"]);
  assert.deepEqual(h.settings.current.models.routes, [
    { name: "worker", description: "Mine.", model: "openai/gpt-5", thinking: "high" },
    { name: "planner", description: "Plans the work.", model: "" },
  ]);
});

test("a deleted bot is an opt-out: HUI records the seed and never creates another", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  h.created.length = 0;
  const outcome = await ensureStaff(h.deps);
  assert.equal(outcome.seeded, false);
  assert.equal(h.created.length, 0);
  assert.deepEqual(outcome.written, [], "no bot means nowhere to write its skills");
  const status = await staffStatus(h.deps);
  assert.equal(status.installed, false);
  assert.equal(status.botId, "bot-1");
});

test("without a recorded seed, the installer can be told not to create a bot", async () => {
  const h = await harness();
  await assert.rejects(() => ensureStaff(h.deps, { seed: false }), /never installed/u);
  assert.equal(h.created.length, 0);
});
