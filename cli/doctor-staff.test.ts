/**
 * `hui doctor`'s staff pack check: every chief is reported on its own, a missing or changed skill is an issue `--fix`
 * installs, a skill somebody edited is reported and left alone, a chief HUI never recorded is adopted rather than
 * overwritten, and a SOUL.md it installed untouched takes newer pack text while an edited, removed or unrecorded one is
 * reported and kept. The check only reads, so a report is safe while the gateway runs.
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
const { soulHash } = await import("../server/staff/service.ts");
const { localBotFiles } = await import("../server/bots/home.ts");
const { localBotSkills } = await import("../server/bots/skills.ts");

const pack = await readStaffPack();
const shipped = (name: string) => pack.skills.find((skill) => skill.name === name)!;
const own = (name: string) => ({ name: shipped(name).name, text: shipped(name).text, files: shipped(name).files.map((file) => ({ ...file })) });

/** One chief holding the shipped skills named, recorded or not, in a home of its own: its skills and its real SOUL.md,
 * and the hashes HUI recorded for them. `soul` is the text it holds now (the shipped one by default, `null` for a chief
 * with no SOUL.md at all) and `installedSoul` the one HUI installed when it recorded the bot, so a test can tell an edit
 * from an older pack's text. */
async function fixture(chiefs: { id: string; name: string; skills: string[]; recorded: boolean; edited?: { skill: string; text: string }; soul?: string | null; installedSoul?: string }[]) {
  const dir = await mkdtemp(join(root, "case-"));
  const botsFile = join(dir, "bots.json");
  const stateFile = join(dir, "staff.json");
  const botsDir = join(dir, "bots");
  const skills = localBotSkills(botsDir);
  const files = localBotFiles(botsDir);
  const bots: Record<string, unknown> = {};
  for (const chief of chiefs) {
    const held = chief.skills.map(own);
    if (chief.edited) held.push({ name: chief.edited.skill, text: chief.edited.text, files: [] });
    await skills.write(chief.id, held);
    // Through the port, as HUI writes it: the file ends with the newline `readHomeFile` trims back off. `soul: null` writes
    // none at all, and the record still holds the hash of the soul HUI installed there.
    const soulFile = chief.soul === null ? undefined : (chief.soul ?? pack.soul).trim();
    await files.write(chief.id, soulFile);
    if (!chief.recorded) continue;
    // What HUI records when it installs a skill: the hash of the shipped text, whatever the bot holds now.
    const hashes: Record<string, string> = {};
    for (const skill of held) for (const file of packFilePaths([shipped(skill.name)])) hashes[file.path] = hashText(file.text);
    bots[chief.id] = { packVersion: pack.version, installedAt: "2026-11-06T10:00:00.000Z", files: hashes, soul: soulHash(chief.installedSoul ?? soulFile ?? pack.soul) };
  }
  await writeFile(botsFile, JSON.stringify({ version: 1, bots: chiefs.map((chief) => ({ id: chief.id, name: chief.name, title: `Chief of Staff · ${chief.name}`, group: chief.name, cwd: join(botsDir, chief.id), createdAt: "", updatedAt: "" })) }));
  await writeFile(stateFile, JSON.stringify({ version: 2, seededAt: "2026-11-06T10:00:00.000Z", botId: "seeded-chief", bots }));
  return { check: createStaffCheck({ stateFile, botsFile, botsDir }), skills, files, botsDir, stateFile };
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
  assert.equal(after.summary, "Every chief's skills and SOUL.md match the shipped pack");
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

test("an untouched SOUL.md takes the shipped text with --fix; an edited, removed or unrecorded one is kept", async () => {
  const ids = pack.skills.map((skill) => skill.name);
  // What an older pack shipped and recorded, and what the operator wrote by hand.
  const older = "# Who I am\nAn older shipped soul.\n";
  const mine = "# Who I am\nI changed this myself.\n";
  const { check, files, stateFile } = await fixture([
    { id: "chief-1", name: "Research Bot", skills: ids, recorded: true, soul: older },
    { id: "chief-2", name: "Release Bot", skills: ids, recorded: true, soul: mine, installedSoul: pack.soul },
    { id: "chief-3", name: "Docs Bot", skills: ids, recorded: false, soul: mine },
    // Recorded with a soul HUI installed, and then deleted: --fix must not create one here either.
    { id: "chief-4", name: "Build Bot", skills: ids, recorded: true, soul: null },
  ]);
  const state = await readFile(stateFile, "utf8");

  const before = await check.inspect();
  assert.equal(before.status, "issue");
  assert.deepEqual(before.items.map((item) => [item.id, item.label, item.status]), [
    ["soul:chief-1", "Research Bot: SOUL.md", "issue"],
    ["soul:chief-2", "Release Bot: SOUL.md", "blocked"],
    ["soul:chief-3", "Docs Bot: SOUL.md", "blocked"],
    ["soul:chief-4", "Build Bot: SOUL.md", "blocked"],
  ]);
  assert.equal(before.items[0]?.detail, "newer pack text is available: --fix installs it");
  assert.equal(before.items[1]?.detail, "edited or removed here, so the pack keeps it; restore the shipped text by hand if you want it");
  assert.equal(before.items[2]?.detail, "differs from the shipped text, and HUI has no record of installing it here: keep your version, or replace it by hand with the shipped text");
  assert.equal(before.items[3]?.detail, "edited or removed here, so the pack keeps it; restore the shipped text by hand if you want it");
  assert.match(before.summary, /1 SOUL\.md file can take the shipped text/u);
  assert.match(before.summary, /3 SOUL\.md files kept \(1 with no install record\)/u);
  assert.equal(await readFile(stateFile, "utf8"), state, "a report never writes the record");
  assert.equal(await files.read("chief-1"), older.trim(), "nor a soul");
  assert.equal(await files.read("chief-4"), undefined, "nor a SOUL.md nobody holds");

  const fixed = await check.fix!();
  assert.deepEqual(fixed.items.map((item) => [item.id, item.status]), [
    ["soul:chief-1", "fixed"],
    ["soul:chief-2", "blocked"],
    ["soul:chief-3", "blocked"],
    ["soul:chief-4", "blocked"],
  ]);
  assert.equal(fixed.status, "fixed");
  assert.equal(await files.read("chief-1"), pack.soul.trim(), "the untouched soul takes the shipped text");
  assert.equal(await files.read("chief-2"), mine.trim(), "an edited soul is never rewritten");
  assert.equal(await files.read("chief-3"), mine.trim(), "nor one HUI has no record of installing");
  assert.equal(await files.read("chief-4"), undefined, "nor one that was removed: --fix never creates a SOUL.md");
  const recorded = JSON.parse(await readFile(stateFile, "utf8")) as { bots: Record<string, { soul?: string }> };
  assert.equal(recorded.bots["chief-1"]?.soul, soulHash(pack.soul), "and the new soul is what the record holds");
  assert.equal(recorded.bots["chief-2"]?.soul, soulHash(pack.soul), "an edit leaves the record as it was");
  assert.equal(recorded.bots["chief-3"]?.soul, undefined, "an unrecorded soul gains no hash");
  assert.equal(recorded.bots["chief-4"]?.soul, soulHash(pack.soul), "and a removed soul keeps the hash of what HUI installed");

  const after = await check.inspect();
  assert.deepEqual(after.items.map((item) => item.id), ["soul:chief-2", "soul:chief-3", "soul:chief-4"], "the installed soul is finished");
});
