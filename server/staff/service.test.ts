/**
 * The staff pack installer: the seeded bot and every group chief, untouched skill files and an untouched SOUL.md updated
 * on a new pack version, edited ones kept, a soul HUI has no record of reported, a chief recorded before HUI kept per-bot
 * state adopted without overwriting anything it cannot account for, routes merged by name, and a deleted bot never
 * resurrected.
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
import { ensureStaff, readStaffState, recordChief, soulHash, staffPlan, type StaffBot } from "./service.ts";

/** The soul every pack has unless a test gives it another, so a version bump alone changes no soul. */
const SOUL = "# Who I am\nChief.\n";

function pack(version: number, text: string, soul: string = SOUL): StaffPack {
  return {
    version,
    bot: { name: "Chief of Staff", title: "Chief of Staff", description: "Coordinates work." },
    soul,
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

/** A home file as `writeHomeFile` leaves it: the text and the newline it appends, which its reader then trims. */
function homeFile(text: string): string {
  return `${text}\n`;
}

async function harness(initial: StaffPack = pack(1, "Route the work, v1.")) {
  const stateFile = join(await mkdtemp(join(tmpdir(), "hui-staff-service-")), "staff.json");
  const created: { id: string; name: string; soul?: string }[] = [];
  const registry: StaffBot[] = [];
  const own = new Map<string, BotOwnSkill[]>();
  /** Each bot's SOUL.md as the file holds it, and every soul write this run made, in order. */
  const souls = new Map<string, string>();
  const soulWrites: string[] = [];
  /** Every bot whose SOUL.md this run read, in order: a bot the pack leaves alone is never read at all. */
  const soulReads: string[] = [];
  const settings: { current: Settings } = { current: { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, routes: [] } } };
  let nextId = 1;
  const soul = {
    // As `localBotFiles` does: the trimmed text, and nothing at all while the file is missing or blank.
    async read(botId: string) { soulReads.push(botId); return souls.get(botId)?.trim() || undefined; },
    async write(botId: string, text: string | undefined) {
      soulWrites.push(botId);
      if (text) souls.set(botId, homeFile(text));
      else souls.delete(botId);
    },
  };
  const deps = {
    pack: initial,
    stateFile,
    createBot: async (body: { name: string; title: string; description: string; soul: string }) => {
      const id = `bot-${nextId++}`;
      created.push({ id, name: body.name, soul: body.soul });
      registry.push({ id, name: body.name });
      // What the bot service does at creation (`normalizeSoul`): the seed becomes the new bot's own SOUL.md, with `\n`
      // line ends and trimmed, whatever the pack file had.
      await soul.write(id, body.soul.replace(/\r\n?/gu, "\n").trim());
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
    soul,
    readSettings: async () => settings.current,
    writeSettings: async (next: Settings) => { settings.current = next; return next; },
    now: () => new Date("2026-11-06T10:00:00Z"),
  };
  /** A group chief HUI installed the pack into before it recorded each bot: it holds whatever the test gives it, and the
   * pack's SOUL.md unless the test says otherwise (a test that wants none deletes it from `souls`). */
  const chief = (id: string, skills: readonly BotOwnSkill[], group = "research", title = `Chief of Staff · ${group}`, soulText: string = initial.soul) => {
    registry.push({ id, name: `Chief of ${group}`, title, group });
    own.set(id, skills.map((skill) => ({ ...skill })));
    souls.set(id, homeFile(soulText));
    return id;
  };
  return { deps, created, own, souls, soulWrites, soulReads, registry, settings, stateFile, chief };
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
  assert.equal(state?.bots["bot-1"]?.soul, soulHash(SOUL), "the seed records the hash of the soul the bot reads");
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
  assert.equal(h.soulReads.includes("chief-3"), false, "and its SOUL.md is not even read here");
  assert.equal((await readStaffState(h.deps))?.bots["chief-3"], undefined);
});

test("a chief the route recorded is never adopted, so its first pack update arrives whole", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  // What POST /__hui/staff/chiefs does: it writes the pack into the new chief, SOUL.md included, and records it at once.
  h.registry.push({ id: "chief-4", name: "Chief of ci", group: "ci" });
  await h.deps.skills.write("chief-4", skillsOf(h.deps.pack));
  h.souls.set("chief-4", homeFile(h.deps.pack.soul));
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

test("a later pack version replaces an untouched SOUL.md and records the new hash", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  h.deps.pack = pack(2, "Route the work, v2.", "# Who I am\nChief, v2.\n");

  const outcome = await ensureStaff(h.deps);
  assert.equal(outcome.bots.find((bot) => bot.botId === "bot-1")?.soul, "written");
  assert.equal(h.souls.get("bot-1"), "# Who I am\nChief, v2.\n", "the shipped text goes in, and `writeHomeFile` adds the one newline its reader trims");
  assert.equal(
    (await readStaffState(h.deps))?.bots["bot-1"]?.soul,
    soulHash("# Who I am\nChief, v2."),
    "the hash is of the text the bot reads, not the bytes on disk",
  );
  assert.deepEqual((await ensureStaff(h.deps)).bots, [], "the next run has nothing left to do");
});

test("a CRLF pack soul seeds as the LF text the bot reads", async () => {
  // A pack checked out on Windows: `normalizeHomeFile` gives the bot `\n` line ends, so the hash must be of that text.
  const h = await harness(pack(1, "Route the work, v1.", "# Who I am\r\nChief.\r\n"));

  await ensureStaff(h.deps);
  assert.equal(h.souls.get("bot-1"), "# Who I am\nChief.\n", "the bot reads the LF text, with the one newline the writer adds");
  assert.equal((await readStaffState(h.deps))?.bots["bot-1"]?.soul, soulHash("# Who I am\nChief.\n"), "and the record hashes exactly that text");
  assert.deepEqual((await ensureStaff(h.deps)).bots, [], "so the next run has nothing left to do");
});

test("a stale soul record whose text is the shipped one is recorded, not kept", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  // A record left behind, by a crash between the soul write and the state write or by a hand edit of staff.json.
  const stored = JSON.parse(await readFile(h.stateFile, "utf8")) as { bots: Record<string, { soul?: string }> };
  stored.bots["bot-1"]!.soul = "0".repeat(64);
  await writeFile(h.stateFile, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  const writes = h.soulWrites.length;

  const outcome = await ensureStaff(h.deps);
  const result = outcome.bots.find((bot) => bot.botId === "bot-1");
  assert.equal(result?.soul, "recorded", "the text is the shipped one, so only the record is out of date");
  assert.equal(h.soulWrites.length, writes, "and nothing is written to the soul");
  assert.equal((await readStaffState(h.deps))?.bots["bot-1"]?.soul, soulHash(SOUL), "the record is healed to the shipped hash");
  assert.deepEqual((await ensureStaff(h.deps)).bots, [], "and the next run is quiet");
});

test("a CRLF copy of the shipped soul heals a missing soul record instead of being reported unrecorded", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  // A SOUL.md hand-edited on Windows, or synced back from one: the port trims but leaves the `\r\n` line ends it read,
  // while the shipped text is the `\n` form HUI writes. Same soul, so only the missing record is left to heal.
  const stored = JSON.parse(await readFile(h.stateFile, "utf8")) as { bots: Record<string, { soul?: string }> };
  delete stored.bots["bot-1"]!.soul;
  await writeFile(h.stateFile, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  h.souls.set("bot-1", "# Who I am\r\nChief.\r\n");
  const writes = h.soulWrites.length;

  const outcome = await ensureStaff(h.deps);
  const result = outcome.bots.find((bot) => bot.botId === "bot-1");
  assert.equal(result?.soul, "recorded", "the shipped text with other line ends is still the shipped text, so the record is healed");
  assert.equal(h.soulWrites.length, writes, "and the soul is not rewritten to change its line ends");
  assert.equal((await readStaffState(h.deps))?.bots["bot-1"]?.soul, soulHash(SOUL), "the record holds the hash of the text the bot reads");
});

test("an edited SOUL.md is kept whole and reported", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  const mine = "# Who I am\nI run this my way.\n";
  h.souls.set("bot-1", homeFile(mine));
  h.deps.pack = pack(2, "Route the work, v2.", "# Who I am\nChief, v2.\n");
  const writes = h.soulWrites.length;

  const outcome = await ensureStaff(h.deps);
  const result = outcome.bots.find((bot) => bot.botId === "bot-1");
  assert.equal(result?.soul, "kept");
  assert.equal(h.souls.get("bot-1"), homeFile(mine), "an edited soul is never overwritten");
  assert.equal(h.soulWrites.length, writes, "and it never reaches the port's write");
  assert.equal((await readStaffState(h.deps))?.bots["bot-1"]?.soul, soulHash(SOUL), "the record keeps the hash it had");
});

test("a recorded chief whose SOUL.md was deleted keeps it deleted and reports it", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  const installed = (await readStaffState(h.deps))?.bots["bot-1"]?.soul;
  h.souls.delete("bot-1");
  h.deps.pack = pack(2, "Route the work, v2.");
  const writes = h.soulWrites.length;

  const outcome = await ensureStaff(h.deps);
  const result = outcome.bots.find((bot) => bot.botId === "bot-1");
  assert.equal(result?.soul, "kept", "a removed soul is the operator's, like an edit");
  assert.equal(h.soulWrites.length, writes, "and it never reaches the port's write");
  assert.equal(h.souls.has("bot-1"), false, "no SOUL.md is created again");
  assert.equal((await readStaffState(h.deps))?.bots["bot-1"]?.soul, installed, "the record still holds the hash of what HUI installed");
  assert.equal((await staffPlan(h.deps)).bots.find((bot) => bot.botId === "bot-1")?.soul, "edited", "and the report says so");
});

test("a chief with no soul record whose SOUL.md is the shipped text is recorded, never rewritten", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  // A chief HUI installed the pack into before it recorded each bot: the shipped skills and SOUL.md, and no record.
  h.chief("chief-7", skillsOf(pack(1, "Route the work, v1.")), "ci");
  const writes = h.soulWrites.length;

  const outcome = await ensureStaff(h.deps);
  const result = outcome.bots.find((bot) => bot.botId === "chief-7");
  assert.equal(result?.adopted, true);
  assert.equal(result?.soul, "recorded");
  assert.equal(h.soulWrites.length, writes, "text that already matches the pack is recorded, not written again");
  assert.equal((await readStaffState(h.deps))?.bots["chief-7"]?.soul, soulHash(SOUL));
});

test("a chief with no soul record whose SOUL.md differs, or is missing, is kept and reported unrecorded", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  const mine = "# Who I am\nI wrote this myself.\n";
  h.chief("chief-8", skillsOf(pack(1, "Route the work, v1.")), "ci", "Chief of Staff · ci", mine);
  const writes = h.soulWrites.length;

  const outcome = await ensureStaff(h.deps);
  assert.equal(outcome.bots.find((bot) => bot.botId === "chief-8")?.soul, "unrecorded");
  assert.equal(h.souls.get("chief-8"), homeFile(mine), "a soul HUI cannot account for is never replaced");
  assert.equal(h.soulWrites.length, writes);
  assert.equal((await readStaffState(h.deps))?.bots["chief-8"]?.soul, undefined, "and no hash is recorded for it");

  // No SOUL.md at all takes the same keep path: HUI never writes one it cannot prove it wrote.
  h.chief("chief-9", skillsOf(pack(1, "Route the work, v1.")), "docs");
  h.souls.delete("chief-9");
  const missing = await ensureStaff(h.deps);
  assert.equal(missing.bots.find((bot) => bot.botId === "chief-9")?.soul, "unrecorded");
  assert.equal(h.souls.has("chief-9"), false, "no SOUL.md is created");
});

test("a record written before HUI tracked the soul still reads and upgrades its skills", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  const stored = JSON.parse(await readFile(h.stateFile, "utf8")) as { bots: Record<string, Record<string, unknown>> };
  delete stored.bots["bot-1"]!["soul"];
  await writeFile(h.stateFile, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  h.souls.set("bot-1", homeFile("# Who I am\nMy own words now.\n"));
  h.deps.pack = pack(2, "Route the work, v2.");

  const state = await readStaffState(h.deps);
  assert.deepEqual(state?.bots["bot-1"]?.files, stored.bots["bot-1"]!["files"], "the rest of the entry still counts");
  assert.equal(state?.bots["bot-1"]?.soul, undefined);

  const outcome = await ensureStaff(h.deps);
  const result = outcome.bots.find((bot) => bot.botId === "bot-1");
  assert.deepEqual(result?.written, ["chief-mode"], "its skills still follow the pack");
  assert.equal(result?.soul, "unrecorded");
  assert.equal(h.souls.get("bot-1"), homeFile("# Who I am\nMy own words now.\n"), "and its soul is left exactly as it is");
  assert.equal((await readStaffState(h.deps))?.bots["bot-1"]?.packVersion, 2);
});

test("staffPlan reports every soul state exactly as an install classifies it, and writes neither file", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  const v2 = pack(2, "Route the work, v2.", "# Who I am\nChief, v2.\n");
  h.deps.pack = v2;
  // A recorded chief whose SOUL.md the operator then edited.
  h.chief("chief-edited", skillsOf(v2), "ci", "Chief of Staff · ci", v2.soul);
  await recordChief(h.deps, "chief-edited");
  h.souls.set("chief-edited", homeFile("# Who I am\nMine.\n"));
  // One HUI never recorded, holding the shipped soul, and one holding its own.
  h.chief("chief-record", skillsOf(v2), "ops", "Chief of Staff · ops", v2.soul);
  h.chief("chief-unrecorded", skillsOf(v2), "docs", "Chief of Staff · docs", "# Who I am\nTheirs.\n");

  const stateBefore = await readFile(h.stateFile, "utf8");
  const soulsBefore = JSON.stringify([...h.souls]);
  const writes = h.soulWrites.length;
  const plan = await staffPlan(h.deps);
  assert.deepEqual(Object.fromEntries(plan.bots.map((bot) => [bot.botId, bot.soul])), {
    "bot-1": "update",
    "chief-edited": "edited",
    "chief-record": "record",
    "chief-unrecorded": "unrecorded",
  });
  assert.equal(await readFile(h.stateFile, "utf8"), stateBefore, "a plan never writes staff.json");
  assert.equal(JSON.stringify([...h.souls]), soulsBefore, "and never writes a SOUL.md");
  assert.equal(h.soulWrites.length, writes);

  const outcome = await ensureStaff(h.deps);
  assert.deepEqual(Object.fromEntries(outcome.bots.map((bot) => [bot.botId, bot.soul])), {
    "bot-1": "written",
    "chief-edited": "kept",
    "chief-record": "recorded",
    "chief-unrecorded": "unrecorded",
  }, "an install reports the same states the plan did");
});

test("recordChief records the shipped soul hash with the skill hashes", async () => {
  const h = await harness();
  await ensureStaff(h.deps);
  await recordChief(h.deps, "chief-5");
  const state = await readStaffState(h.deps);
  assert.equal(state?.bots["chief-5"]?.soul, soulHash(h.deps.pack.soul));
  assert.equal(Object.keys(state!.bots["chief-5"]!.files).length > 0, true, "and the skills it wrote");
});
