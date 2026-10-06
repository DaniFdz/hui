import assert from "node:assert/strict";
import { test } from "node:test";
import type { CallPlatform } from "./voice-call.ts";
import { VoiceController, type VoiceControllerDeps } from "./voice-controller.ts";

const settle = async () => { for (let round = 0; round < 5; round++) await new Promise<void>((resolve) => setImmediate(resolve)); };

function harness(options: { microphone?: () => Promise<never> } = {}) {
  let ticks: (() => void) | undefined;
  let connectionReads = 0;
  const released = { microphone: 0, watch: 0 };
  const synthesized: { text: string; botId?: string; voice?: string; speed?: number; language?: string }[] = [];
  const platform = (): CallPlatform => ({
    openMicrophone: options.microphone ?? (async () => ({ sampleRate: 16_000, setEnabled: () => undefined, close: () => { released.microphone += 1; } })),
    transcribe: async () => "",
    send: async () => "sent",
    watch: () => () => { released.watch += 1; },
    synthesize: async (text) => new Blob([text]),
    play: async () => undefined,
    setTimer: () => () => undefined,
    now: () => 0,
  });
  const deps: VoiceControllerDeps = {
    loadConnection: async () => { connectionReads += 1; return { configured: true, url: "http://127.0.0.1:3900", keySet: false, reachable: true }; },
    synthesize: async (request) => { synthesized.push(request); return new Blob([request.text]); },
    play: (_, signal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
    voiceLevel: () => 0.4,
    platform,
    now: () => 5_000,
    setInterval: (callback) => { ticks = callback; return () => { ticks = undefined; }; },
  };
  let updates = 0;
  const voice = new VoiceController({ requestUpdate: () => { updates += 1; } }, deps);
  return { voice, synthesized, released, ticking: () => Boolean(ticks), reads: () => connectionReads, updates: () => updates };
}

const scout = { id: "bot-scout", sessionId: "session-scout", name: "Scout" };
const ledger = { id: "bot-ledger", sessionId: "session-ledger", name: "Ledger" };

test("reads the connection once and follows what Settings saves", async () => {
  const { voice, reads } = harness();
  assert.equal(voice.available, false);
  await Promise.all([voice.loadConnection(), voice.loadConnection()]);
  await voice.loadConnection();
  assert.equal(reads(), 1);
  assert.equal(voice.available, true);
  voice.setConnection({ configured: false, url: "", keySet: false });
  assert.equal(voice.available, false);
});

test("reading aloud uses the bot's voice, a preview its own, and stops for a call", async () => {
  const { voice, synthesized } = harness();
  voice.read("m1", "Hello there.", { botId: "scout" });
  await settle();
  assert.deepEqual(voice.readAloud, { id: "m1", status: "playing" });
  voice.read("preview", "This is how I sound.", { voice: "vp-aria", speed: 1.25, language: "es" });
  await settle();
  voice.read("preview", "And in Auto.", { voice: "", speed: 1, language: "" });
  await settle();
  assert.deepEqual(synthesized, [
    { botId: "scout", text: "Hello there." },
    { voice: "vp-aria", speed: 1.25, language: "es", text: "This is how I sound." },
    { voice: "", speed: 1, language: "", text: "And in Auto." },
  ], "a preview names its draft's voice, speed and language, Auto included");
  assert.equal(voice.startCall(scout), true);
  assert.equal(voice.readAloud.status, "idle", "a call stops the reading");
  voice.read("m2", "Not now.", { botId: "scout" });
  assert.equal(voice.readAloud.error, "Hang up the call to hear messages read aloud.");
  voice.dispose();
});

test("one call at a time: the same bot brings it back, another bot waits", async () => {
  const { voice, released, ticking } = harness();
  assert.equal(voice.startCall(scout), true);
  await settle();
  assert.equal(voice.call?.state.phase, "listening");
  assert.equal(ticking(), true, "the call's timer runs");
  voice.minimize();
  assert.equal(voice.call?.minimized, true);
  assert.equal(voice.startCall(ledger), false);
  assert.equal(voice.call?.bot.id, "bot-scout");
  assert.equal(voice.startCall(scout), true);
  assert.equal(voice.call?.minimized, false, "calling the same bot returns to its call");
  voice.toggleMic();
  assert.equal(voice.call?.state.micMuted, true);
  voice.toggleSpeaker();
  assert.equal(voice.call?.state.speakerMuted, true);
  voice.hangUp();
  assert.equal(voice.call, undefined, "hanging up returns to the chat");
  assert.equal(ticking(), false);
  assert.deepEqual(released, { microphone: 1, watch: 1 });
  assert.equal(voice.startCall(ledger), true, "now another bot can be called");
  voice.dispose();
});

test("the call's levels feed the bot's face: the microphone's and the bot's voice's, and nothing without a call", async () => {
  const { voice } = harness();
  assert.equal(voice.micLevel(), 0);
  assert.equal(voice.voiceLevel(), 0, "no call, no voice to follow");
  assert.equal(voice.startCall(scout), true);
  await settle();
  assert.equal(voice.micLevel(), 0, "no frame heard yet");
  assert.equal(voice.voiceLevel(), 0.4, "the player's level during the call");
  voice.dispose();
});

test("a failed call stays on screen with its reason until it is closed", async () => {
  const { voice } = harness({ microphone: async () => { throw new Error("Microphone access was denied."); } });
  voice.startCall(scout);
  await settle();
  assert.deepEqual([voice.call?.state.phase, voice.call?.state.error], ["failed", "Microphone access was denied."]);
  voice.closeCall();
  assert.equal(voice.call, undefined);
});
