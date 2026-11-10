/**
 * The shipped staff pack: its manifest, routes, skills and the hashes the installer records. A broken package fails
 * here rather than in a bot's home.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "vitest";

import { packFilePaths, readStaffPack, STAFF_PACK_ROOT, hashText } from "./pack.ts";

test("the shipped pack validates and holds the chief, its routes and its skills", async () => {
  const pack = await readStaffPack();
  assert.equal(pack.version, 7);
  assert.equal(pack.bot.name, "Chief of Staff");
  assert.match(pack.soul, /chief of staff/u);
  assert.deepEqual(pack.routes.map((route) => route.name), ["planner", "explorer", "worker", "reviewer", "verifier"]);
  for (const route of pack.routes) {
    assert.equal(route.model, "", "a pack route inherits the chief's model");
    assert.ok(route.description.length > 20, `${route.name} describes when to use it`);
  }
  const names = pack.skills.map((skill) => skill.name);
  for (const expected of ["chief-mode", "lead", "learn", "lessons", "machines", "heartbeat", "delegate", "plan", "review", "verify", "ship"]) {
    assert.ok(names.includes(expected), `the pack ships ${expected}`);
  }
  const skill = pack.skills.find((entry) => entry.name === "chief-mode")!;
  assert.ok(skill.files.some((file) => file.path.startsWith("playbooks/")), "chief-mode carries its playbooks");
  const paths = packFilePaths(pack.skills).map((file) => file.path);
  assert.equal(new Set(paths).size, paths.length, "no two files share a path");
  assert.ok(paths.every((path) => path.startsWith("skills/")));
});

test("hashText is stable and sensitive to one character", () => {
  assert.equal(hashText("a"), hashText("a"));
  assert.notEqual(hashText("a"), hashText("b"));
  assert.match(hashText("a"), /^[a-f0-9]{64}$/u);
});

async function fakePack(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hui-staff-pack-"));
  await writeFile(join(root, "pack.json"), JSON.stringify({
    name: "staff", version: 1, title: "Staff", bot: { name: "Chief", title: "Chief", description: "Coordinates work." },
  }));
  await writeFile(join(root, "SOUL.md"), "# Who I am\nChief.\n");
  await writeFile(join(root, "routes.json"), JSON.stringify([{ name: "worker", description: "Does the work." }]));
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, "skills", path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return root;
}

test("a malformed pack is refused before anything reaches a bot", async () => {
  const noSkill = await fakePack({});
  await assert.rejects(() => readStaffPack(noSkill), /holds no skills/u);

  const badVersion = await fakePack({ "one/SKILL.md": "---\nname: one\n---\n" });
  await writeFile(join(badVersion, "pack.json"), JSON.stringify({ version: 0, bot: { name: "C", title: "C", description: "D" } }));
  await assert.rejects(() => readStaffPack(badVersion), /version must be a positive integer/u);

  const noSoul = await fakePack({ "one/SKILL.md": "---\nname: one\n---\n" });
  await writeFile(join(noSoul, "SOUL.md"), "  ");
  await assert.rejects(() => readStaffPack(noSoul), /SOUL\.md is empty/u);

  const badRoutes = await fakePack({ "one/SKILL.md": "---\nname: one\n---\n" });
  await writeFile(join(badRoutes, "routes.json"), JSON.stringify([{ name: "two words", description: "" }]));
  await assert.rejects(() => readStaffPack(badRoutes), /is not a route name/u);

  const skillWithoutFile = await fakePack({ "one/notes.md": "notes" });
  await assert.rejects(() => readStaffPack(skillWithoutFile), /has no SKILL\.md/u);
});

test("the pack root resolves next to the server sources, as the bundled skills do", () => {
  assert.match(STAFF_PACK_ROOT, /\/staff\/$/u);
});
