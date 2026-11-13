/**
 * The staff pack installer: the seeded bot and every group chief, untouched skill files updated on a new pack version,
 * edited skills kept, a chief recorded before HUI kept per-bot state adopted without overwriting anything it cannot
 * account for, routes merged by name, and a deleted bot never resurrected.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { DEFAULT_SETTINGS, type Settings } from "../hui-settings.ts";
import type { BotOwnSkill } from "../bots/skills.ts";
import type { StaffPack } from "./pack.ts";
import { ensureStaff, readStaffState, recordChief, staffPlan, type StaffBot } from "./service.ts";

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
  const registry: StaffBot[] = [];
  const own = new Map<string, BotOwnSkill[]>();
  const settings: { current: Settings } = { current: { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, routes: [] } } };
  let nextId = 1;
  const deps = {
    pack: initial,
    stateFile,
    createBot: async (body: { name: string; title: string; description: string; soul: string }) => {
      const id = `bot-${nextId++}`;
      created.push({ id, name: body.name, soul: body.soul });
      registry.push({ id, name: body.name });
      return { id };
    },
    bots: async () => registry,
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
  /** A group chief HUI installed the pack into before it recorded each bot: it holds whatever the test gives it. */
  const chief = (id: string, skills: readonly BotOwnSkill[], group = "research", title = `Chief of Staff · ${group}`) => {
    registry.push({ id, name: `Chief of ${group}`, title, group });
    own.set(id, skills.map((skill) => ({ ...skill })));
    return id;
  };
  return { deps, created, own, registry, settings, stateFile, chief };
}

/** The skills of `pack`: what a chief holds when HUI installed it with the pack and nobody touched it. */
function skillsOf(pack: StaffPack): BotOwnSkill[] {
  return pack.skills.map((skill) => ({ name: skill.name, text: skill.text, files: skill.files.map((file) => ({ ...file })) }));
}

test("seeds one Chief of Staff, writes its skills, merges its routes and records what it installed", async () => {
  const h = await harness();
  const first = await ensureStaff(h.deps);
  assert.equal(first.seeded, true);
  assert.equal(first.botId, "bot-1");
  assert.deepEqual(first.bots.map((bot) => [bot.botId, bot.written, bot.kept]), [["bot-1", ["chief-mode", "plan"], []]]);
  assert.deepEqual(first.routesAdded, ["planner", "worker"]);
  assert.equal(h.created.length, 1);
  assert.match(h.created[0]!.soul!, /Chief/u);
  assert.deepEqual(h.own.get("bot-1")!.map((skill) => skill.name), ["chief-mode", "plan"]);
  assert.deepEqual(h.own.get("bot-1")![0]!.files, [{ path: "playbooks/feature.md", text: "# Feature\n" }]);
  assert.deepEqual(h.settings.current.models.routes.map((route) => [route.name, route.model]), [["planner", ""], ["worker", ""]]);
  const state = await readStaffState(h.deps);
  assert.equal(state?.botId, "bot-1");
  assert.equal(state?.version, 2);
  assert.equal(state?.bots["bot-1"]?.packVersion, 1);
  assert.match(state!.bots["bot-1"]!.files["skills/chief-mode/SKILL.md"]!, /^[a-f0-9]{64}$/u);
  assert.match(state!.bots["bot-1"]!.files["skills/chief-mode/playbooks/feature.md"]!, /^[a-f0-9]{64}$/u);
  // A release from before per-bot records reads `botId` and `files`: the mirror keeps a rollback lossless.
  const onDisk = JSON.parse(await readFile(h.stateFile, "utf8")) as { botId: string; files: Record<string, string> };
  assert.deepEqual(onDisk.files, state!.bots["bot-1"]!.files);

  const second = await ensureStaff(h.deps);
  assert.equal(second.seeded, false);
  assert.deepEqual(second.bots, []);
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
  assert.deepEqual(outcome.bots.map((bot) => [bot.written, bot.kept]), [[["chief-mode"], ["plan"]]]);
  assert.match(h.own.get("bot-1")![0]!.text, /v2/u, "the untouched skill follows the pack");
  assert.match(h.own.get("bot-1")![1]!.text, /My own plan wording/u, "the edited skill is never overwritten");
  assert.equal((await readStaffState(h.deps))?.bots["bot-1"]?.packVersion, 2);
});

test("a group chief with no record is adopted, then follows the pack like any other", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  // The chief got the pack at creation: chief-mode exactly as shipped, a plan the operator rewrote, nothing else.
  const before = pack(1, "Route the work, v1.");
  h.chief("chief-1", [skillsOf(before)[0]!, { name: "plan", text: "---\nname: plan\n---\nOur own wording.\n", files: [] }]);

  const adopted = await ensureStaff(h.deps);
  const result = adopted.bots.find((bot) => bot.botId === "chief-1");
  assert.equal(result?.adopted, true);
  assert.match(h.own.get("chief-1")![0]!.text, /v1/u, "text the pack installed is not rewritten by an adoption");
  assert.match(h.own.get("chief-1")![1]!.text, /Our own wording/u, "an adoption never overwrites text it cannot account for");
  assert.deepEqual(result?.kept, ["plan"], "and it reports the file instead");

  h.deps.pack = pack(2, "Route the work, v2.");
  const refreshed = await ensureStaff(h.deps);
  assert.deepEqual(refreshed.bots.find((bot) => bot.botId === "chief-1")?.written, ["chief-mode"]);
  assert.match(h.own.get("chief-1")![0]!.text, /v2/u, "the recorded chief follows the pack");
  assert.match(h.own.get("chief-1")![1]!.text, /Our own wording/u);

  const repeat = await ensureStaff(h.deps);
  assert.deepEqual(repeat.bots.find((bot) => bot.botId === "chief-1")?.written, [], "a repeat run changes nothing");
  const state = await readStaffState(h.deps);
  assert.deepEqual(Object.keys(state!.bots).sort(), ["bot-1", "chief-1"], "one record per bot, never a duplicate");
});

test("a group's bot that is not a chief is never adopted", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  // A bot the operator filed under a group, holding one skill it copied from the pack.
  h.chief("bot-9", [skillsOf(pack(1, "Route the work, v1."))[0]!], "ci", "Review my pull requests");
  const outcome = await ensureStaff(h.deps);
  assert.equal(outcome.bots.some((bot) => bot.botId === "bot-9"), false);
  assert.deepEqual(h.own.get("bot-9")!.map((skill) => skill.name), ["chief-mode"], "nothing else is written there");
});

test("a skill the chief lacks is installed by the adoption, and one it never had stays absent", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  h.chief("chief-2", [skillsOf(pack(1, "Route the work, v1."))[0]!]);
  const outcome = await ensureStaff(h.deps);
  assert.deepEqual(outcome.bots.find((bot) => bot.botId === "chief-2")?.written, ["plan"], "a missing skill is not an edit");
  assert.deepEqual(outcome.bots.find((bot) => bot.botId === "chief-2")?.kept, []);
});

test("two chiefs recorded at once both keep their record", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  await Promise.all([recordChief(h.deps, "chief-5"), recordChief(h.deps, "chief-6")]);
  assert.deepEqual(Object.keys((await readStaffState(h.deps))!.bots).sort(), ["bot-1", "chief-5", "chief-6"]);
});

test("a version 1 record keeps the seeded bot current and gains a record per bot", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  const v2 = JSON.parse(await readFile(h.stateFile, "utf8")) as { bots: Record<string, { files: Record<string, string> }> };
  // What an earlier HUI wrote: the seeded bot's hashes at the top level, and no per-bot state.
  await writeFile(h.stateFile, `${JSON.stringify({
    version: 1,
    packVersion: 1,
    seededAt: "2026-11-06T10:00:00.000Z",
    botId: "bot-1",
    files: v2.bots["bot-1"]!.files,
  }, null, 2)}\n`, "utf8");

  const state = await readStaffState(h.deps);
  assert.deepEqual(state?.bots["bot-1"]?.files, v2.bots["bot-1"]!.files, "the version 1 hashes carry over");

  h.deps.pack = pack(2, "Route the work, v2.");
  const outcome = await ensureStaff(h.deps);
  assert.deepEqual(outcome.bots.map((bot) => bot.written), [["chief-mode"]], "an untouched skill still follows the pack");
  const written = JSON.parse(await readFile(h.stateFile, "utf8")) as { version: number; bots: Record<string, unknown> };
  assert.equal(written.version, 2);
  assert.deepEqual(Object.keys(written.bots), ["bot-1"]);
});

test("a chief whose home is on a worker is left alone", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  h.registry.push({ id: "chief-3", name: "Chief of ci", group: "ci", worker: "devbox" });
  await ensureStaff(h.deps);
  assert.equal(h.own.has("chief-3"), false, "its skills live on the worker");
  assert.equal((await readStaffState(h.deps))?.bots["chief-3"], undefined);
});

test("a chief the route recorded is never adopted, so its first pack update arrives whole", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  // What POST /__hui/staff/chiefs does: it writes the pack into the new chief and records it at once.
  h.registry.push({ id: "chief-4", name: "Chief of ci", group: "ci" });
  await h.deps.skills.write("chief-4", skillsOf(h.deps.pack));
  await recordChief(h.deps, "chief-4");

  h.deps.pack = pack(2, "Route the work, v2.");
  const outcome = await ensureStaff(h.deps);
  const result = outcome.bots.find((bot) => bot.botId === "chief-4");
  assert.equal(result?.adopted, false);
  assert.deepEqual(result?.written, ["chief-mode"]);
  assert.match(h.own.get("chief-4")![0]!.text, /v2/u);
});

test("a file the pack dropped from a skill it still ships is not a removed skill", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  // chief-mode loses its playbook but stays: deleting the skill would take text the pack still owns.
  const shrunk = pack(2, "Route the work, v2.");
  shrunk.skills[0]!.files = [];
  h.deps.pack = shrunk;
  await ensureStaff(h.deps);
  const plan = await staffPlan(h.deps);
  assert.deepEqual(plan.bots.find((bot) => bot.botId === "bot-1")?.stale, []);
});

test("a skill the pack no longer ships is reported, never deleted", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  h.own.get("bot-1")!.push({ name: "heartbeat", text: "---\nname: heartbeat\n---\nOld.\n", files: [] });
  const state = JSON.parse(await readFile(h.stateFile, "utf8")) as { bots: Record<string, { files: Record<string, string> }> };
  state.bots["bot-1"]!.files["skills/heartbeat/SKILL.md"] = createHash("sha256").update("---\nname: heartbeat\n---\nOld.\n", "utf8").digest("hex");
  await writeFile(h.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const plan = await staffPlan(h.deps);
  assert.deepEqual(plan.bots.find((bot) => bot.botId === "bot-1")?.stale, ["heartbeat"]);
  await ensureStaff(h.deps);
  assert.equal(h.own.get("bot-1")!.some((skill) => skill.name === "heartbeat"), true, "the pack never deletes a skill");

  // A file somebody added to that folder makes the whole skill theirs: the report must stop calling it untouched.
  const heartbeat = h.own.get("bot-1")!.find((skill) => skill.name === "heartbeat")!;
  heartbeat.files = [{ path: "notes.md", text: "Mine.\n" }];
  assert.deepEqual((await staffPlan(h.deps)).bots.find((bot) => bot.botId === "bot-1")?.stale, []);

  // And once the folder is gone there is nothing left to report.
  h.own.set("bot-1", h.own.get("bot-1")!.filter((skill) => skill.name !== "heartbeat"));
  assert.deepEqual((await staffPlan(h.deps)).bots.find((bot) => bot.botId === "bot-1")?.stale, []);
});

test("a pack that adds a file to a skill still updates it", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  const grown = pack(2, "Route the work, v2.");
  grown.skills[0]!.files.push({ path: "playbooks/forensics.md", text: "# Forensics\n" });
  h.deps.pack = grown;
  const outcome = await ensureStaff(h.deps);
  assert.deepEqual(outcome.bots.map((bot) => bot.written), [["chief-mode"]], "a new file is not mistaken for an edit");
  assert.deepEqual(h.own.get("bot-1")![0]!.files, grown.skills[0]!.files);
  h.deps.pack = grown;
  assert.deepEqual((await ensureStaff(h.deps)).bots, [], "and the next run has nothing left to do");
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
  h.registry.length = 0;
  const outcome = await ensureStaff(h.deps);
  assert.equal(outcome.seeded, false);
  assert.equal(h.created.length, 0);
  assert.deepEqual(outcome.bots, [], "no bot means nowhere to write its skills");
  assert.equal((await readStaffState(h.deps))?.botId, "bot-1");
});

test("without a recorded seed, the installer can be told not to create a bot", async () => {
  const h = await harness();
  await assert.rejects(() => ensureStaff(h.deps, { seed: false }), /never installed/u);
  assert.equal(h.created.length, 0);
});
