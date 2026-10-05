import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { handleFromName, previewLine, type BotRecord } from "../shared/bots.ts";
import {
  BotConflictError, BotInputError, BotNotFoundError, BotRegistry, BotStoreError,
  findBot, isOneGrapheme, normalizeBotInput, normalizeBotPatch, parseBotRecord, patchedAvatar, uniqueHandle,
} from "./bots.ts";

async function tempFile(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hui-bots-registry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "bots.json");
}

const now = "2026-10-05T10:00:00.000Z";
function bot(id: string, handle: string, extra: Partial<BotRecord> = {}): BotRecord {
  return { id, handle, name: handle.toUpperCase(), cwd: "/tmp", sessionId: `session-${id}`, createdAt: now, updatedAt: now, ...extra };
}

test("handles derive from names as lowercase ASCII slugs and take -2, -3… on collision within 32 characters", () => {
  assert.equal(handleFromName("Ada Lovelace"), "ada-lovelace");
  assert.equal(handleFromName("  Señor   Café!! "), "senor-cafe");
  assert.equal(handleFromName("***"), "bot", "nothing usable falls back to bot");
  assert.equal(handleFromName("日本語"), "bot");
  const long = handleFromName("The quite remarkably long name of a research assistant");
  assert.equal(long, "the-quite-remarkably-long-name-o");
  assert.equal(long.length, 32);
  assert.equal(handleFromName("a".repeat(31) + " b"), "a".repeat(31), "a cut never leaves a trailing dash");
  assert.equal(uniqueHandle("ada", new Set()), "ada");
  assert.equal(uniqueHandle("ada", new Set(["ada"])), "ada-2");
  assert.equal(uniqueHandle("ada", new Set(["ada", "ada-2"])), "ada-3");
  const full = "x".repeat(31) + "y";
  const suffixed = uniqueHandle(full, new Set([full]));
  assert.equal(suffixed, `${"x".repeat(30)}-2`);
  assert.equal(suffixed.length, 32);
  assert.equal(uniqueHandle("ab-cd", new Set(["ab-cd"])), "ab-cd-2");
  assert.equal(uniqueHandle("events", new Set()), "events-2", "the list stream's path is no bot's handle");
  assert.equal(uniqueHandle(`${"a".repeat(29)}-bc`, new Set([`${"a".repeat(29)}-bc`])), `${"a".repeat(29)}-2`, "no dash before the suffix's own");
});

test("input is validated at the boundary: limits, formats, unknown fields and one-grapheme emoji", () => {
  assert.deepEqual(normalizeBotInput({ name: "  Ada  ", title: "", avatar: { emoji: "🦊", color: "#AABBCC" }, hidden: false }), {
    name: "Ada", avatar: { emoji: "🦊", color: "#aabbcc" },
  });
  const full = normalizeBotInput({
    name: "Ada", handle: "@ada", title: "Researcher", description: "Reads papers", instructions: "  Be brief.\n  ",
    cwd: "~/work", model: "vercel-ai-gateway/anthropic/claude", thinking: "high", memoryModel: "openai/gpt-mini", memoryThinking: "low", hidden: true,
  });
  assert.deepEqual(full, {
    name: "Ada", handle: "ada", title: "Researcher", description: "Reads papers", instructions: "Be brief.",
    cwd: "~/work", model: "vercel-ai-gateway/anthropic/claude", thinking: "high", memoryModel: "openai/gpt-mini", memoryThinking: "low", hidden: true,
  });
  const rejects: [unknown, RegExp][] = [
    [null, /must be an object/u],
    [{}, /name is required/u],
    [{ name: "" }, /Bot name must be 1-60/u],
    [{ name: "x".repeat(61) }, /Bot name must be 1-60/u],
    [{ name: "two\nlines" }, /one line/u],
    [{ name: "Ada", nickname: "x" }, /Unknown bot field: nickname/u],
    [{ name: "Ada", handle: "Ada!" }, /Bot handle must be/u],
    [{ name: "Ada", handle: "-ada" }, /Bot handle must be/u],
    [{ name: "Ada", handle: "a".repeat(33) }, /Bot handle must be 1-32|at most 32/u],
    [{ name: "Ada", handle: "events" }, /@events is reserved/u],
    [{ name: "Ada", title: "t".repeat(81) }, /Bot title must be at most 80/u],
    [{ name: "Ada", description: "d".repeat(501) }, /at most 500/u],
    [{ name: "Ada", instructions: "i".repeat(20_001) }, /at most 20000/u],
    [{ name: "Ada", model: "gpt" }, /provider\/id/u],
    [{ name: "Ada", model: "" }, /provider\/id/u],
    [{ name: "Ada", thinking: "max" }, /Thinking level must be one of/u],
    [{ name: "Ada", memoryModel: "bad model" }, /provider\/id/u],
    [{ name: "Ada", cwd: "" }, /Working directory must be 1-/u],
    [{ name: "Ada", avatar: { emoji: "🦊🐻" } }, /one character/u],
    [{ name: "Ada", avatar: { emoji: "ab" } }, /one character/u],
    [{ name: "Ada", avatar: { color: "red" } }, /#rrggbb/u],
    [{ name: "Ada", avatar: { size: 3 } }, /Unknown avatar field/u],
    [{ name: "Ada", hidden: "yes" }, /Hidden must be a boolean/u],
  ];
  for (const [value, message] of rejects) assert.throws(() => normalizeBotInput(value), (error: unknown) => error instanceof BotInputError && message.test(error.message), JSON.stringify(value));
  assert.equal(isOneGrapheme("👩‍👩‍👧"), true, "a ZWJ sequence is one character");
  assert.equal(isOneGrapheme("👍🏽"), true);
  assert.equal(isOneGrapheme("A"), true);
  assert.equal(isOneGrapheme(" "), false);
  assert.equal(isOneGrapheme("\u0007"), false);
});

test("a patch carries only what changes and may clear optional text and avatar keys", () => {
  assert.throws(() => normalizeBotPatch({}), /Nothing to change/u);
  assert.deepEqual(normalizeBotPatch({ title: "", instructions: "", memoryModel: "", memoryThinking: "" }), { title: "", instructions: "", memoryModel: "", memoryThinking: "" });
  assert.deepEqual(normalizeBotPatch({ avatar: null, hidden: false }), { avatar: null, hidden: false });
  assert.throws(() => normalizeBotPatch({ model: "" }), /provider\/id/u, "a chat always has a model");
  assert.throws(() => normalizeBotPatch({ thinking: "" }), /Thinking level/u);
  assert.throws(() => normalizeBotPatch({ name: " " }), /Bot name must be 1-60/u);
  assert.throws(() => normalizeBotPatch({ sessionId: "x" }), /Unknown bot field: sessionId/u);
  assert.deepEqual(patchedAvatar({ emoji: "🦊", color: "#000000" }, { emoji: "" }), { color: "#000000" });
  assert.deepEqual(patchedAvatar({ emoji: "🦊" }, { color: "#112233" }), { emoji: "🦊", color: "#112233" });
  assert.equal(patchedAvatar({ emoji: "🦊" }, null), undefined);
  assert.equal(patchedAvatar({ emoji: "🦊" }, { emoji: "" }), undefined);
});

test("stored records keep what validates: a bad optional field is dropped, a bad required one skips the record", () => {
  assert.deepEqual(parseBotRecord({ ...bot("a", "ada"), avatar: { emoji: "🦊", color: "teal" }, thinking: "max", title: "", hidden: "yes" }), {
    ...bot("a", "ada"), avatar: { emoji: "🦊" },
  });
  for (const broken of [{ ...bot("a", "ada"), handle: "Ada" }, { ...bot("a", "ada"), cwd: "relative" }, { ...bot("a", "ada"), sessionId: "" }, { ...bot("a", "ada"), name: "" }, "ada", null]) {
    assert.equal(parseBotRecord(broken), undefined, JSON.stringify(broken));
  }
});

test("the registry skips and keeps invalid records, refuses broken or newer files and writes atomically owner-only", async (t) => {
  const file = await tempFile(t);
  const reported: number[] = [];
  const registry = new BotRegistry(file, (count) => reported.push(count));
  assert.deepEqual(await registry.list(), [], "a missing file is an empty registry");

  const garbage = { id: "zzz", note: "hand edit" };
  await writeFile(file, JSON.stringify({ version: 1, bots: [bot("a", "ada"), garbage, bot("b", "ada"), bot("c", "cy", { sessionId: "session-a" }), bot("d", "dee")] }));
  assert.deepEqual((await registry.list()).map((each) => each.id), ["a", "d"], "duplicates of a handle or chat lose to the first");
  assert.deepEqual(reported, [3]);
  await registry.list();
  assert.deepEqual(reported, [3], "a lasting problem is reported once");
  assert.deepEqual(registry.cached.map((each) => each.id), ["a", "d"]);

  await registry.update((bots) => ({ bots: bots.filter((each) => each.id !== "d"), result: undefined }));
  const written = JSON.parse(await readFile(file, "utf8")) as { version: number; bots: unknown[] };
  assert.equal(written.version, 1);
  assert.deepEqual(written.bots, [bot("a", "ada"), garbage, bot("b", "ada"), bot("c", "cy", { sessionId: "session-a" })], "invalid records survive a write untouched");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(join(file, ".."))).filter((name) => name.endsWith(".tmp")), [], "no temporary file is left behind");

  await writeFile(file, "{ not json");
  await assert.rejects(registry.list(), (error: unknown) => error instanceof BotStoreError && /not valid JSON/u.test(error.message));
  await assert.rejects(registry.update((bots) => ({ bots, result: undefined })), BotStoreError);
  assert.equal(await readFile(file, "utf8"), "{ not json", "a broken file is never overwritten");
  await writeFile(file, JSON.stringify({ version: 2, bots: [] }));
  await assert.rejects(registry.list(), /newer HUI/u);
  assert.equal(JSON.parse(await readFile(file, "utf8")).version, 2);
});

test("registry updates are serialized: concurrent writers never lose each other's bots", async (t) => {
  const file = await tempFile(t);
  const registry = new BotRegistry(file);
  await Promise.all(["a", "b", "c", "d", "e"].map((id) => registry.update((bots) => ({ bots: [...bots, bot(id, `h-${id}`)], result: id }))));
  assert.deepEqual((await registry.list()).map((each) => each.id).toSorted(), ["a", "b", "c", "d", "e"]);
  await assert.rejects(registry.update(() => { throw new BotConflictError("refused"); }), BotConflictError);
  assert.equal((await registry.update((bots) => ({ bots, result: bots.length }))), 5, "a refused mutation leaves the queue working");
});

test("bots resolve by id, handle in any case with or without @, then an exact name; a shared name must be disambiguated", () => {
  const bots = [bot("id-1", "ada", { name: "Ada" }), bot("id-2", "bob", { name: "Twin" }), bot("id-3", "cy", { name: "Twin" })];
  assert.equal(findBot(bots, "id-2").handle, "bob");
  assert.equal(findBot(bots, "@ADA").id, "id-1");
  assert.equal(findBot(bots, "Ada").id, "id-1");
  assert.throws(() => findBot(bots, "Twin"), (error: unknown) => error instanceof BotConflictError && /2 bots are named Twin/u.test(error.message));
  assert.throws(() => findBot(bots, "nobody"), BotNotFoundError);
});

test("previews are one line of at most 200 characters", () => {
  assert.equal(previewLine("  hello\n\n  world\t! "), "hello world !");
  const long = previewLine("word ".repeat(100));
  assert.equal(long.length, 200);
  assert.ok(long.endsWith("…"));
});
