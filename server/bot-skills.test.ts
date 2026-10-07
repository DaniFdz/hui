import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localBotSkills } from "./bot-skills.ts";

const BOT = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("a bot's own skills are written into its home, owner-only, and read back by name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hui-bot-skills-"));
  try {
    const files = localBotSkills(dir);
    assert.deepEqual(await files.read(BOT), [], "no folder, no skills");
    await files.write(BOT, [{ name: "weather", text: "---\nname: weather\ndescription: W\n---\nGo.\n" }, { name: "packing-list", text: "P" }]);
    const file = join(dir, BOT, "skills", "weather", "SKILL.md");
    assert.equal(await readFile(file, "utf8"), "---\nname: weather\ndescription: W\n---\nGo.\n");
    assert.equal((await lstat(file)).mode & 0o777, 0o600);
    assert.equal((await lstat(join(dir, BOT, "skills"))).mode & 0o777, 0o700);
    assert.deepEqual((await files.read(BOT)).map((skill) => skill.name), ["packing-list", "weather"]);
    await files.write(BOT, [{ name: "weather", text: "replaced" }]);
    assert.equal(await readFile(file, "utf8"), "replaced", "written again, atomically");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("names that aren't skill names, ids that aren't a bot's and links in the way are refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hui-bot-skills-"));
  try {
    const files = localBotSkills(dir);
    for (const name of ["../evil", "Weather", "a/b", "-x", ""]) await assert.rejects(files.write(BOT, [{ name, text: "x" }]), /Not a skill name/u, name);
    await assert.rejects(files.write("../other", [{ name: "x", text: "x" }]), /Not a bot id/u);
    const outside = join(dir, "outside");
    await mkdir(outside);
    await mkdir(join(dir, BOT), { recursive: true });
    await symlink(outside, join(dir, BOT, "skills"));
    await assert.rejects(files.write(BOT, [{ name: "x", text: "x" }]), /is not a folder/u);
    assert.deepEqual(await files.read(BOT), [], "a link is never read through either");
    await writeFile(join(outside, "keep"), "still here");
    assert.equal(await readFile(join(outside, "keep"), "utf8"), "still here");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
