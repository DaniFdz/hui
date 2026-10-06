import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { handleFromName, previewLine, type BotRecord } from "../shared/bots.ts";
import {
  BotConflictError, BotInputError, BotNotFoundError, BotRegistry, BotStoreError,
  findBot, isOneGrapheme, normalizeBotInput, normalizeBotPatch, parseBotRecord, patchedAvatar, patchedVoice, uniqueHandle,
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
  assert.deepEqual(normalizeBotInput({ name: "Ada", model: "", thinking: "" }), { name: "Ada" }, "an empty model or level is the default a new chat gets anyway");
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
  assert.deepEqual(normalizeBotPatch({ model: "", thinking: "" }), { model: "", thinking: "" }, "the chat goes back to the gateway's defaults");
  assert.throws(() => normalizeBotPatch({ model: "gpt" }), /provider\/id/u);
  assert.throws(() => normalizeBotPatch({ model: 7 }), /Bot model must be text/u);
  assert.throws(() => normalizeBotPatch({ thinking: "loud" }), /Thinking level must be one of/u);
  assert.throws(() => normalizeBotPatch({ name: " " }), /Bot name must be 1-60/u);
  assert.throws(() => normalizeBotPatch({ sessionId: "x" }), /Unknown bot field: sessionId/u);
  assert.deepEqual(patchedAvatar({ emoji: "🦊", color: "#000000" }, { emoji: "" }), { color: "#000000" });
  assert.deepEqual(patchedAvatar({ emoji: "🦊" }, { color: "#112233" }), { emoji: "🦊", color: "#112233" });
  assert.equal(patchedAvatar({ emoji: "🦊" }, null), undefined);
  assert.equal(patchedAvatar({ emoji: "🦊" }, { emoji: "" }), undefined);
});

test("a bot's look: a face shape from the five and any #rrggbb color, an emoji beside them; \"\" or null clears", () => {
  assert.deepEqual(normalizeBotInput({ name: "Ada", avatar: { shape: "heart", color: "#2FC49A" } }), { name: "Ada", avatar: { shape: "heart", color: "#2fc49a" } });
  assert.deepEqual(normalizeBotInput({ name: "Ada", avatar: { emoji: "🦊", shape: "cookie" } }), { name: "Ada", avatar: { emoji: "🦊", shape: "cookie" } }, "the face waits behind an emoji");
  assert.deepEqual(normalizeBotInput({ name: "Ada", avatar: { shape: "", color: "" } }), { name: "Ada" }, "a new bot has no look to clear: its id picks one");
  for (const shape of ["blob", "round", "triangle", "heart", "cookie"]) assert.deepEqual(normalizeBotPatch({ avatar: { shape } }), { avatar: { shape } });
  for (const [avatar, message] of [
    [{ shape: "star" }, /Avatar shape must be one of: blob, round, triangle, heart, cookie/u],
    [{ shape: "Heart" }, /Avatar shape must be one of/u],
    [{ shape: 3 }, /Avatar shape must be one of/u],
    [{ shape: null }, /Avatar shape must be one of/u],
    [{ color: "mint" }, /#rrggbb/u],
    [{ face: "heart" }, /Unknown avatar field: face/u],
    ["heart", /emoji, color and\/or shape/u],
  ] as const) {
    assert.throws(() => normalizeBotPatch({ avatar }), (error: unknown) => error instanceof BotInputError && message.test(error.message), JSON.stringify(avatar));
  }
  assert.deepEqual(normalizeBotPatch({ avatar: { emoji: "", shape: "", color: "" } }), { avatar: { emoji: "", shape: "", color: "" } }, "\"\" is kept so the patch can tell it clears");
  // PATCH: given keys replace, "" clears one, null clears all three.
  const look = { emoji: "🦊", shape: "heart" as const, color: "#2fc49a" };
  assert.deepEqual(patchedAvatar(look, { emoji: "" }), { shape: "heart", color: "#2fc49a" }, "clearing the emoji switches the bot to its face");
  assert.deepEqual(patchedAvatar(look, { shape: "" }), { emoji: "🦊", color: "#2fc49a" }, "a cleared shape goes back to the id's");
  assert.deepEqual(patchedAvatar(look, { shape: "round", color: "#3a7bfa" }), { emoji: "🦊", shape: "round", color: "#3a7bfa" });
  assert.deepEqual(patchedAvatar(undefined, { shape: "triangle" }), { shape: "triangle" });
  assert.equal(patchedAvatar(look, null), undefined);
  assert.equal(patchedAvatar({ shape: "heart" }, { shape: "" }), undefined, "nothing left: the avatar goes");
});

test("stored records keep what validates: a bad optional field is dropped, a bad required one skips the record", () => {
  assert.deepEqual(parseBotRecord({ ...bot("a", "ada"), avatar: { shape: "heart", color: "#2fc49a" } }), { ...bot("a", "ada"), avatar: { color: "#2fc49a", shape: "heart" } });
  assert.deepEqual(parseBotRecord({ ...bot("a", "ada"), avatar: { emoji: "🦊", shape: "star" } }), { ...bot("a", "ada"), avatar: { emoji: "🦊" } }, "an unknown shape is dropped, not the bot");
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

test("a bot's voice is a VoiceStudio voice id and a speed from 0.5 to 2, cleared key by key", () => {
  assert.deepEqual(normalizeBotInput({ name: "Ada", voice: { profile: " vp-aria ", speed: 1.256 } }).voice, { profile: "vp-aria", speed: 1.26 });
  assert.equal(normalizeBotInput({ name: "Ada", voice: { profile: "", speed: null } }).voice, undefined, "a new bot has nothing to clear");
  for (const [voice, message] of [
    ["loud", /Voice must be an object/u],
    [{ volume: 3 }, /Unknown voice field: volume/u],
    [{ profile: "x".repeat(201) }, /voice id of at most 200/u],
    [{ profile: "a\nb" }, /voice id/u],
    [{ speed: 3 }, /from 0.5 to 2/u],
    [{ speed: "1" }, /from 0.5 to 2/u],
  ] as const) {
    assert.throws(() => normalizeBotInput({ name: "Ada", voice }), (error: unknown) => error instanceof BotInputError && message.test(error.message), JSON.stringify(voice));
  }
  assert.deepEqual(normalizeBotPatch({ voice: { profile: "" } }), { voice: { profile: "" } });
  assert.deepEqual(normalizeBotPatch({ voice: { speed: null } }), { voice: { speed: null } });
  assert.deepEqual(normalizeBotPatch({ voice: null }), { voice: null });
  const current = { profile: "vp-aria", speed: 1.25 };
  assert.deepEqual(patchedVoice(current, { speed: 0.8 }), { profile: "vp-aria", speed: 0.8 });
  assert.deepEqual(patchedVoice(current, { profile: "" }), { speed: 1.25 });
  assert.deepEqual(patchedVoice(current, { speed: null }), { profile: "vp-aria" });
  assert.equal(patchedVoice(current, { profile: "", speed: null }), undefined);
  assert.equal(patchedVoice(current, null), undefined);
  // A stored voice keeps what validates.
  assert.deepEqual(parseBotRecord({ ...bot("a", "ada"), voice: { profile: "vp-dani", speed: 9 } })?.voice, { profile: "vp-dani" });
  assert.equal(parseBotRecord({ ...bot("a", "ada"), voice: "x" })?.voice, undefined);
});

test("a bot's voice language is one of Whisper's codes, kept with the voice and cleared back to Auto with \"\"", () => {
  assert.deepEqual(normalizeBotInput({ name: "Ada", voice: { language: " ES " } }).voice, { language: "es" });
  for (const language of ["haw", "yue", "jw", "en", "zh"]) assert.deepEqual(normalizeBotInput({ name: "Ada", voice: { language } }).voice, { language }, language);
  assert.equal(normalizeBotInput({ name: "Ada", voice: { language: "" } }).voice, undefined, "a new bot has no language to clear");
  for (const language of ["spanish", "es-ES", "jv", "xx", "auto", 7, null, "zz"]) {
    assert.throws(() => normalizeBotInput({ name: "Ada", voice: { language } }), (error: unknown) => error instanceof BotInputError
      && error.message === "Voice language must be one of Whisper's language codes, such as en, es, fr, de or ja, or \"\" for Auto.", String(language));
    assert.throws(() => normalizeBotPatch({ voice: { language } }), BotInputError, String(language));
  }
  assert.throws(() => normalizeBotPatch({ voice: { dialect: "es" } }), /Unknown voice field: dialect/u);
  assert.deepEqual(normalizeBotPatch({ voice: { language: "" } }), { voice: { language: "" } });
  assert.deepEqual(normalizeBotPatch({ voice: { language: "DE", speed: null } }), { voice: { language: "de", speed: null } });
  const current = { profile: "vp-aria", speed: 1.25, language: "es" as const };
  assert.deepEqual(patchedVoice(current, { language: "haw" }), { profile: "vp-aria", speed: 1.25, language: "haw" });
  assert.deepEqual(patchedVoice(current, { language: "" }), { profile: "vp-aria", speed: 1.25 }, "back to Auto");
  assert.deepEqual(patchedVoice(current, { profile: "", speed: null }), { language: "es" }, "the language outlives the voice's other keys");
  assert.deepEqual(patchedVoice(undefined, { language: "yue" }), { language: "yue" });
  assert.equal(patchedVoice({ language: "es" }, { language: "" }), undefined);
  assert.equal(patchedVoice(current, null), undefined, "voice: null clears everything");
  // bots.json keeps a valid code and drops anything else, without losing the rest of the voice.
  assert.deepEqual(parseBotRecord({ ...bot("a", "ada"), voice: { profile: "vp-dani", language: "es" } })?.voice, { profile: "vp-dani", language: "es" });
  assert.deepEqual(parseBotRecord({ ...bot("a", "ada"), voice: { language: "yue" } })?.voice, { language: "yue" });
  assert.deepEqual(parseBotRecord({ ...bot("a", "ada"), voice: { speed: 1.5, language: "klingon" } })?.voice, { speed: 1.5 });
  assert.equal(parseBotRecord({ ...bot("a", "ada"), voice: { language: "jv" } })?.voice, undefined, "Javanese is stored as Whisper's jw");
});
