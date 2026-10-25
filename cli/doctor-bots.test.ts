/** `hui doctor`'s bot files check: old single-file souls are reported, a memory section moves, and the rest is left to the bot. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { createBotsCheck } from "./doctor-bots.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(bots: { id: string; handle: string; worker?: string }[], souls: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "hui-doctor-bots-"));
  dirs.push(root);
  const file = join(root, "bots.json");
  const homes = join(root, "bots");
  await writeFile(file, JSON.stringify({ version: 1, bots: bots.map((bot) => ({ name: bot.handle, ...bot, sessionId: `s-${bot.id}`, cwd: join(homes, bot.id), createdAt: "", updatedAt: "" })) }));
  for (const bot of bots) {
    if (souls[bot.id] === undefined) continue;
    await mkdir(join(homes, bot.id), { recursive: true, mode: 0o700 });
    await writeFile(join(homes, bot.id, "SOUL.md"), souls[bot.id]!);
  }
  return { check: createBotsCheck({ file, dir: homes }), homes };
}

test("a soul with an old memory section is an issue; a single-file soul and a worker bot are named with the command that splits them", async () => {
  const { check } = await fixture(
    [{ id: "ada", handle: "ada" }, { id: "bob", handle: "bob" }, { id: "cee", handle: "cee", worker: "w-1" }, { id: "new", handle: "new" }],
    {
      ada: "I am Ada.\n\n## What you already know\n\n- Madrid",
      bob: "I am Bob, brief.",
      cee: "I am Cee.",
    },
  );
  const result = await check.inspect();
  assert.equal(result.status, "issue");
  assert.deepEqual(result.items.map((item) => [item.id, item.status]), [["ada", "issue"], ["bob", "blocked"], ["cee", "blocked"]], "a bot in its first conversation has nothing to split");
  assert.match(result.items[0]!.detail ?? "", /--fix moves it to MEMORY\.md/u);
  assert.match(result.items[1]!.detail ?? "", /hui bot split bob/u);
  assert.match(result.items[2]!.detail ?? "", /on w-1: run hui bot split cee/u, "doctor never reads a worker's home offline");
});

test("--fix moves the section to MEMORY.md, keeps the persona, appends to what it already keeps, and is idempotent", async () => {
  const { check, homes } = await fixture([{ id: "ada", handle: "ada" }], { ada: "I am Ada.\n\n## What you already know\n\n- Madrid\n\n## How I work\n\nBriefly." });
  await writeFile(join(homes, "ada", "MEMORY.md"), "# MEMORY.md\n\n- HUI");
  assert.ok(check.fix);
  const fixed = await check.fix();
  assert.equal(fixed.status, "fixed");
  assert.deepEqual(fixed.items.map((item) => [item.id, item.status]), [["ada", "fixed"]]);
  assert.equal(await readFile(join(homes, "ada", "SOUL.md"), "utf8"), "I am Ada.\n\n## How I work\n\nBriefly.\n", "the persona stays, the memory section does not");
  assert.equal(await readFile(join(homes, "ada", "MEMORY.md"), "utf8"), "# MEMORY.md\n\n- HUI\n\n- Madrid\n", "what it knew joins MEMORY.md");
  assert.ok(check.fix);
  const again = await check.fix();
  assert.equal(again.status, "ok", "nothing left to move");
  assert.deepEqual(again.items, []);
});

test("a soul that was only memories leaves the bot in its first conversation again", async () => {
  const { check, homes } = await fixture([{ id: "ada", handle: "ada" }], { ada: "## What you already know\n\n- Madrid" });
  assert.equal((await check.inspect()).status, "issue");
  assert.ok(check.fix);
  await check.fix();
  assert.deepEqual((await readFile(join(homes, "ada", "MEMORY.md"), "utf8")).trim(), "- Madrid");
  const gone = await access(join(homes, "ada", "SOUL.md")).then(() => false, (error: { code?: string }) => error.code === "ENOENT");
  assert.equal(gone, true, "no persona: SOUL.md is gone, so the first conversation comes back");
});

test("a memory section too long for MEMORY.md is reported failed and nothing is written", async () => {
  const { check, homes } = await fixture([{ id: "ada", handle: "ada" }], { ada: `I am Ada.\n\n## What you already know\n\n${"x".repeat(10_001)}` });
  assert.ok(check.fix);
  const fixed = await check.fix();
  assert.equal(fixed.status, "issue");
  assert.deepEqual(fixed.items.map((item) => [item.id, item.status]), [["ada", "failed"]]);
  assert.match(fixed.items[0]!.detail ?? "", /shorten it first, then run --fix again/u);
  assert.equal(await readFile(join(homes, "ada", "SOUL.md"), "utf8"), `I am Ada.\n\n## What you already know\n\n${"x".repeat(10_001)}`, "the soul is left as it was");
  const missing = await readFile(join(homes, "ada", "MEMORY.md"), "utf8").catch(() => "");
  assert.equal(missing, "", "and no MEMORY.md is written");
});
