import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { BOT_FACE_COLORS, BOT_FACE_SHAPES, botFaceColor, botFaceShape, botLook, botSeed, defaultBotLook } from "../../shared/bots.ts";
import {
  BOT_FACE_STATES,
  FACE_EYES,
  FACE_GAZE,
  SyllableLevel,
  callFaceState,
  callLevelSource,
  chatFaceState,
  eyesBlink,
  faceBodyColor,
  faceInk,
  facePath,
  faceTone,
  hasRunningTool,
  levelSquash,
  pointerGaze,
  rosterFaceState,
  settlesWithDone,
  type ChatFaceInput,
} from "./bot-face.ts";
import { initialLiveCallState } from "./live-call.ts";
import type { TranscriptItem } from "./sessions-store.ts";

const PALETTE: ReadonlySet<string> = new Set(BOT_FACE_COLORS.map((color) => color.hex));
const SHAPES: ReadonlySet<string> = new Set(BOT_FACE_SHAPES);

test("a bot without a stored look gets a face its id picks: the same on every call, rename and machine", () => {
  const id = "0b6c8a52-4f1e-4d0e-9a51-3f1f2f6a7c11";
  const first = botLook({ id });
  assert.deepEqual(botLook({ id }), first);
  assert.deepEqual(botLook({ id, avatar: {} }), first, "an empty avatar changes nothing");
  assert.equal(first.kind, "face");
  assert.deepEqual(first.derived, { shape: true, color: true });
  assert.deepEqual({ shape: first.shape, color: first.color }, defaultBotLook(id));
  // Pinned: changing the hash would silently give every existing bot another face.
  assert.equal(botSeed(id), 269040390);
  assert.deepEqual(defaultBotLook(id), { shape: "blob", color: "#3a7bfa" });
  assert.equal(botSeed("scout"), 1487071437);
  assert.deepEqual(defaultBotLook("scout"), { shape: "triangle", color: "#9b7cf6" });
});

test("the default look is always a palette shape and color, spread across bots", () => {
  const shapes = new Set<string>();
  const colors = new Set<string>();
  for (let index = 0; index < 600; index++) {
    const look = botLook({ id: randomUUID() });
    assert.ok(SHAPES.has(look.shape), look.shape);
    assert.ok(PALETTE.has(look.color), look.color);
    assert.ok(Number.isInteger(look.seed) && look.seed >= 0 && look.seed < 2 ** 32);
    shapes.add(look.shape);
    colors.add(look.color);
  }
  assert.equal(shapes.size, BOT_FACE_SHAPES.length, "every shape is picked");
  assert.equal(colors.size, BOT_FACE_COLORS.length, "every color is picked");
  const pairs = new Set(Array.from({ length: 400 }, (_, index) => { const look = defaultBotLook(`bot-${index}`); return `${look.shape}${look.color}`; }));
  assert.ok(pairs.size >= 25, `shape and color vary independently (${pairs.size} of 30 pairs)`);
});

test("a stored shape and color win over the id's, and an emoji wins over the face until it is cleared", () => {
  const id = "ledger";
  const stored = botLook({ id, avatar: { shape: "heart", color: "#2FC49A" } });
  assert.equal(stored.kind, "face");
  assert.equal(stored.shape, "heart");
  assert.equal(stored.color, "#2fc49a", "a color reads lowercase");
  assert.deepEqual(stored.derived, { shape: false, color: false });
  const emoji = botLook({ id, avatar: { emoji: "🦊", shape: "heart" } });
  assert.equal(emoji.kind, "emoji");
  assert.equal(emoji.emoji, "🦊");
  assert.equal(emoji.shape, "heart", "the face waits behind the emoji");
  assert.equal(emoji.color, defaultBotLook(id).color, "its tile takes the id's color");
  // A record edited by hand: an unknown shape or a bad color falls back to the id's.
  const odd = botLook({ id, avatar: { shape: "star" as never, color: "teal" } });
  assert.deepEqual({ shape: odd.shape, color: odd.color }, defaultBotLook(id));
});

test("CLI names: shapes by id or label, palette colors by name or hex", () => {
  assert.equal(botFaceShape("Pebble"), "round");
  assert.equal(botFaceShape(" HEART "), "heart");
  assert.equal(botFaceShape("star"), undefined);
  assert.equal(botFaceColor("Mint")?.hex, "#2fc49a");
  assert.equal(botFaceColor("#FF6B4A")?.label, "Coral");
  assert.equal(botFaceColor("#123456"), undefined);
});

const IDLE_CHAT: ChatFaceInput = { status: "idle", streaming: false, question: false, memoryWaiting: false, toolRunning: false, failed: false };

test("an open chat's face: thinking, working on a tool, waiting, summarizing, failed, unreachable", () => {
  assert.equal(chatFaceState(IDLE_CHAT), "idle");
  assert.equal(chatFaceState({ ...IDLE_CHAT, status: "running", streaming: true }), "thinking");
  assert.equal(chatFaceState({ ...IDLE_CHAT, status: "starting" }), "thinking");
  assert.equal(chatFaceState({ ...IDLE_CHAT, status: "running", streaming: true, toolRunning: true }), "working");
  assert.equal(chatFaceState({ ...IDLE_CHAT, status: "waiting", streaming: true }), "waiting");
  assert.equal(chatFaceState({ ...IDLE_CHAT, status: "running", streaming: true, question: true, toolRunning: true }), "waiting", "a question outranks the tool that asked it");
  assert.equal(chatFaceState({ ...IDLE_CHAT, status: "running", streaming: true, memoryWaiting: true }), "memory");
  assert.equal(chatFaceState({ ...IDLE_CHAT, failed: true }), "error", "a failed turn shows until dismissed");
  assert.equal(chatFaceState({ ...IDLE_CHAT, status: "running", streaming: true, failed: true }), "thinking", "a new turn moves on from it");
  assert.equal(chatFaceState({ ...IDLE_CHAT, status: "error" }), "error");
  assert.equal(chatFaceState({ ...IDLE_CHAT, status: "reconnecting" }), "offline");
  assert.equal(chatFaceState({ ...IDLE_CHAT, status: "disconnected" }), "offline");
});

test("only a running tool of the latest turn counts as working", () => {
  const user = (id: string): TranscriptItem => ({ kind: "message", id, role: "user", text: "hi" });
  const tool = (id: string, status: "running" | "succeeded"): TranscriptItem => ({ kind: "tool", id, name: "read", status });
  assert.equal(hasRunningTool([]), false);
  assert.equal(hasRunningTool([user("1"), tool("t1", "running")]), true);
  assert.equal(hasRunningTool([user("1"), tool("t1", "succeeded"), { kind: "message", id: "2", role: "assistant", text: "done" }]), false);
  assert.equal(hasRunningTool([tool("old", "running"), user("1")]), false, "a stale tool before the latest prompt is not this turn's");
});

test("a roster entry maps the bot's activity, archived bots sleep", () => {
  const usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  const memory = { messages: 1, built: 0, pending: 0, viewBytes: 0, viewLines: 0, usage };
  assert.equal(rosterFaceState({ status: "idle" }), "idle");
  assert.equal(rosterFaceState({ status: "running" }), "thinking");
  assert.equal(rosterFaceState({ status: "starting" }), "thinking");
  assert.equal(rosterFaceState({ status: "waiting" }), "waiting");
  assert.equal(rosterFaceState({ status: "running", memory: { ...memory, waiting: true } }), "memory");
  assert.equal(rosterFaceState({ status: "error" }), "error");
  assert.equal(rosterFaceState({ status: "disconnected" }), "offline");
  assert.equal(rosterFaceState({ status: "running", archived: true }), "offline");
});

test("a call's face listens while the microphone is open and speaks while the bot's voice plays", () => {
  const call = initialLiveCallState(0);
  assert.equal(callFaceState(call), "idle", "connecting");
  assert.equal(callFaceState({ ...call, phase: "listening" }), "listening");
  assert.equal(callFaceState({ ...call, phase: "listening", micMuted: true }), "idle", "a muted microphone hears nothing");
  assert.equal(callFaceState({ ...call, phase: "hearing" }), "listening");
  assert.equal(callFaceState({ ...call, phase: "thinking" }), "thinking");
  assert.equal(callFaceState({ ...call, phase: "thinking", tool: "read" }), "working");
  assert.equal(callFaceState({ ...call, phase: "thinking" }, true), "memory");
  assert.equal(callFaceState({ ...call, phase: "speaking" }), "speaking");
  assert.equal(callFaceState({ ...call, phase: "failed" }), "error");
  assert.equal(callFaceState({ ...call, phase: "ended" }), "offline");
  assert.equal(callLevelSource("listening"), "microphone");
  assert.equal(callLevelSource("speaking"), "voice");
  assert.equal(callLevelSource("thinking"), undefined);
});

test("a turn that ends hops once; other changes do not", () => {
  assert.equal(settlesWithDone("thinking", "idle"), true);
  assert.equal(settlesWithDone("working", "idle"), true);
  assert.equal(settlesWithDone("memory", "idle"), true);
  assert.equal(settlesWithDone("waiting", "idle"), false, "an answered question is not a finished turn");
  assert.equal(settlesWithDone("idle", "idle"), false);
  assert.equal(settlesWithDone("thinking", "error"), false);
});

test("every state has the prototype's expression: eyes, resting gaze, blinking only with dot eyes", () => {
  for (const state of BOT_FACE_STATES) {
    assert.ok(FACE_EYES[state], state);
    assert.equal(FACE_GAZE[state].length, 2, state);
  }
  assert.equal(FACE_EYES.thinking, "squint");
  assert.equal(FACE_EYES.listening, "wide");
  assert.equal(FACE_EYES.memory, "sleepy");
  assert.equal(FACE_EYES.error, "sad");
  assert.equal(FACE_EYES.done, "happy");
  assert.equal(FACE_EYES.offline, "closed");
  assert.equal(eyesBlink("open"), true);
  assert.equal(eyesBlink("closed"), false);
  assert.equal(eyesBlink("happy"), false);
});

test("shapes are closed outlines inside the view box", () => {
  for (const shape of BOT_FACE_SHAPES) {
    const path = facePath(shape);
    assert.match(path, /^M[\d.]+,[\d.]+(C[\d.,\s-]+)+Z$/u, shape);
    const numbers = path.match(/-?\d+(?:\.\d+)?/gu)!.map(Number);
    assert.ok(numbers.every((value) => value > 10 && value < 112), `${shape} stays inside 120×120`);
  }
  assert.notEqual(facePath("blob", 0), facePath("blob", 1), "the blob morphs with its phase");
  assert.equal(facePath("round", 0), facePath("round", 1), "other shapes hold still");
});

test("colors: a muted body after an error, almost grey offline, and eyes that stay visible", () => {
  assert.equal(faceBodyColor("#3A7BFA", "idle"), "#3a7bfa");
  assert.notEqual(faceBodyColor("#3a7bfa", "error"), "#3a7bfa");
  const offline = faceBodyColor("#3a7bfa", "offline");
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(offline.slice(at, at + 2), 16));
  assert.ok(Math.max(r!, g!, b!) - Math.min(r!, g!, b!) < 40, `offline is nearly grey: ${offline}`);
  assert.equal(faceTone("#808080", 1, 1), "#808080", "a tone without change is the color itself");
  for (const color of BOT_FACE_COLORS) assert.equal(faceInk(color.hex), "#141414", `${color.label} keeps the prototype's dark eyes`);
  assert.equal(faceInk("#101820"), "#f4f4f4", "a custom dark body gets light eyes");
});

test("pointer gaze is capped and leans toward the pointer; an audio level squashes the body", () => {
  assert.deepEqual(pointerGaze(1000, 0, 100), { x: 6.5, y: 0, lean: 3 });
  const near = pointerGaze(9, 0, 100);
  assert.ok(near.x > 0 && near.x < 1, "close to the face the eyes move a little");
  assert.deepEqual(pointerGaze(0, 0, 100), { x: 0, y: 0, lean: 0 });
  assert.equal(levelSquash("speaking", 0), "scale(1,1)");
  assert.equal(levelSquash("speaking", 1), "scale(0.95,1.09)");
  assert.equal(levelSquash("listening", 0), "scale(1.03,1.03)", "listening puffs the body out a little");
  assert.equal(levelSquash("listening", 2), levelSquash("listening", 1), "levels clamp to 0–1");
});

test("the stand-in voice makes syllables: bounded, with gaps, softer when listening", () => {
  let seed = 1;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const voice = new SyllableLevel(random);
  const loud = Array.from({ length: 400 }, (_, index) => voice.at(index * 16));
  assert.ok(loud.every((value) => value >= 0 && value <= 1));
  assert.ok(loud.some((value) => value > 0.4), "it speaks up");
  assert.ok(loud.some((value) => value === 0), "and pauses");
  const quiet = new SyllableLevel(random);
  assert.ok(Math.max(...Array.from({ length: 400 }, (_, index) => quiet.at(index * 16, true))) <= 0.53);
});
