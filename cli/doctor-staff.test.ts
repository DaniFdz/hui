/**
 * `hui doctor`'s staff pack check: every chief is reported on its own, a missing or changed skill is an issue `--fix`
 * installs, a skill somebody edited is reported and left alone, and a chief HUI never recorded is adopted rather than
 * overwritten. The check only reads, so a report is safe while the gateway runs.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, test } from "vitest";

// The check reads and writes HUI's own state, so it runs against a temporary config directory, never the operator's.
const root = await mkdtemp(join(tmpdir(), "hui-doctor-staff-"));
process.env["HUI_CONFIG_DIR"] = join(root, "hui");
await mkdir(join(root, "hui"), { recursive: true, mode: 0o700 });
afterAll(() => rm(root, { recursive: true, force: true }));

const { createStaffCheck } = await import("./doctor-staff.ts");
const { hashText, packFilePaths, readStaffPack } = await import("../server/staff/pack.ts");
const { localBotSkills } = await import("../server/bots/skills.ts");

const pack = await readStaffPack();
const shipped = (name: string) => pack.skills.find((skill) => skill.name === name)!;
const own = (name: string) => ({ name: shipped(name).name, text: shipped(name).text, files: shipped(name).files.map((file) => ({ ...file })) });

/** One chief holding the shipped skills named, recorded or not, in a home of its own. */
async function fixture(chiefs: { id: string; name: string; skills: string[]; recorded: boolean; edited?: { skill: string; text: string } }[]) {
  const dir = await mkdtemp(join(root, "case-"));
  const botsFile = join(dir, "bots.json");
  const stateFile = join(dir, "staff.json");
  const botsDir = join(dir, "bots");
  const skills = localBotSkills(botsDir);
  const bots: Record<string, unknown> = {};
  for (const chief of chiefs) {
    const held = chief.skills.map(own);
    if (chief.edited) held.push({ name: chief.edited.skill, text: chief.edited.text, files: [] });
    await skills.write(chief.id, held);
    if (!chief.recorded) continue;
    // What HUI records when it installs a skill: the hash of the shipped text, whatever the bot holds now.
    const files: Record<string, string> = {};
    for (const skill of held) for (const file of packFilePaths([shipped(skill.name)])) files[file.path] = hashText(file.text);
    bots[chief.id] = { packVersion: pack.version, installedAt: "2026-11-06T10:00:00.000Z", files };
  }
  await writeFile(botsFile, JSON.stringify({ version: 1, bots: chiefs.map((chief) => ({ id: chief.id, name: chief.name, title: `Chief of Staff · ${chief.name}`, group: chief.name, cwd: join(botsDir, chief.id), createdAt: "", updatedAt: "" })) }));
  await writeFile(stateFile, JSON.stringify({ version: 2, seededAt: "2026-11-06T10:00:00.000Z", botId: "seeded-chief", bots }));
  return { check: createStaffCheck({ stateFile, botsFile, botsDir }), skills, botsDir };
}

test("a chief missing a shipped skill is an issue that --fix installs, and a second run has nothing left to do", async () => {
  const ids = pack.skills.map((skill) => skill.name).filter((name) => name !== "status");
  const { check, skills } = await fixture([{ id: "chief-1", name: "Research Bot", skills: ids, recorded: true }]);

  const before = await check.inspect();
  assert.equal(before.status, "issue");
  assert.deepEqual(before.items.map((item) => [item.id, item.label, item.status]), [["update:chief-1:status", "Research Bot: skills/status", "issue"]]);
  assert.match(before.summary, /1 skill can take the shipped text/u);
  assert.equal((await skills.read("chief-1")).some((skill) => skill.name === "status"), false, "a report never writes");

  const fixed = await check.fix!();
  assert.deepEqual(fixed.items.map((item) => [item.id, item.status]), [["update:chief-1:status", "fixed"]]);
  assert.equal((await skills.read("chief-1")).find((skill) => skill.name === "status")?.text, shipped("status").text);

  const after = await check.inspect();
  assert.equal(after.status, "ok");
  assert.deepEqual(after.items, []);
  assert.equal(after.summary, "Every chief's skills match the shipped pack");
});

test("a chief that holds a changed skill is reported and never overwritten", async () => {
  const ids = pack.skills.map((skill) => skill.name);
  const mine = "---\nname: lessons\n---\nNever trust a summary instead of the diff.\n";
  const { check, skills } = await fixture([
    { id: "chief-1", name: "Research Bot", skills: ids, recorded: true, edited: { skill: "lessons", text: mine } },
    { id: "chief-2", name: "Release Bot", skills: ids.filter((name) => name !== "status"), recorded: true },
  ]);

  const report = await check.inspect();
  assert.deepEqual(report.items.map((item) => [item.id, item.status]), [["kept:chief-1:lessons", "blocked"], ["update:chief-2:status", "issue"]]);
  assert.match(report.summary, /1 skill kept/u);
  assert.equal(report.items[0]?.detail, "edited here, so the pack keeps it; remove the edit or copy the new version by hand");

  const fixed = await check.fix!();
  assert.deepEqual(fixed.items.map((item) => [item.id, item.status]), [["update:chief-2:status", "fixed"], ["kept:chief-1:lessons", "blocked"]]);
  assert.equal((await skills.read("chief-1")).find((skill) => skill.name === "lessons")?.text, mine, "the chief keeps its own wording");
});

test("a chief HUI never recorded is adopted: what matches the pack is recorded, what differs is reported", async () => {
  const ids = pack.skills.map((skill) => skill.name).filter((name) => name !== "status" && name !== "machines");
  const mine = "---\nname: chief-mode\n---\nRoute it my way.\n";
  const { check, skills } = await fixture([
    { id: "chief-1", name: "Research Bot", skills: ids.filter((name) => name !== "chief-mode"), recorded: false, edited: { skill: "chief-mode", text: mine } },
  ]);

  const report = await check.inspect();
  assert.equal(report.items.some((item) => item.status === "issue"), true, "the skills it lacks are installable");
  assert.deepEqual(report.items.filter((item) => item.status === "blocked").map((item) => item.id), ["kept:chief-1:chief-mode"]);
  assert.match(report.notes.join(" "), /Research Bot got the pack before HUI recorded each chief/u);

  const fixed = await check.fix!();
  assert.equal(fixed.items.some((item) => item.status === "failed"), false);
  assert.equal((await skills.read("chief-1")).find((skill) => skill.name === "chief-mode")?.text, mine, "an adoption never overwrites");
  assert.equal((await skills.read("chief-1")).some((skill) => skill.name === "machines"), true, "a missing skill is installed");

  const after = await check.fix!();
  assert.deepEqual(after.items, [{ id: "kept:chief-1:chief-mode", label: "Research Bot: skills/chief-mode", status: "blocked", detail: "differs from the shipped text, and HUI has no record of installing it here: delete its folder to take the shipped text, or keep your version" }], "a repeat run adds nothing");
});

test("a skill the pack no longer ships is reported, and a deleted seeded chief is an opt-out", async () => {
  const ids = pack.skills.map((skill) => skill.name);
  const { check, botsDir } = await fixture([{ id: "chief-1", name: "Docs Bot", skills: ids, recorded: true }]);
  // What an older pack installed and this one dropped: recorded, untouched, and still in the bot's folder.
  const stateFile = join(dirname(botsDir), "staff.json");
  const state = JSON.parse(await readFile(stateFile, "utf8")) as { bots: Record<string, { files: Record<string, string> }> };
  const old = "---\nname: heartbeat\n---\nWake the routine.\n";
  await localBotSkills(botsDir).write("chief-1", [{ name: "heartbeat", text: old, files: [] }]);
  state.bots["chief-1"]!.files["skills/heartbeat/SKILL.md"] = hashText(old);
  await writeFile(stateFile, JSON.stringify(state));

  const report = await check.inspect();
  assert.deepEqual(report.items.map((item) => [item.id, item.status]), [["stale:chief-1:heartbeat", "blocked"]]);
  assert.match(report.notes.join(" "), /The Chief of Staff HUI seeded was deleted/u);
  assert.equal((await localBotSkills(botsDir).read("chief-1")).some((skill) => skill.name === "heartbeat"), true, "the check never deletes a skill");
});
