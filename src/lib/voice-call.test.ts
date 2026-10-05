import assert from "node:assert/strict";
import { test } from "node:test";
import { initialCallState, reduceCall, VoiceCall, type CallEffect, type CallEvent, type CallPlatform, type CallSessionHandlers, type CallState } from "./voice-call.ts";

/* ── the state machine ── */

function play(events: readonly CallEvent[], from: CallState = initialCallState(0)): { state: CallState; phases: string[]; effects: CallEffect[] } {
  let state = from;
  const phases: string[] = [];
  const effects: CallEffect[] = [];
  for (const event of events) {
    const next = reduceCall(state, event, 1000);
    state = next.state;
    phases.push(state.phase);
    effects.push(...next.effects);
  }
  return { state, phases, effects };
}

test("a turn goes listening → hearing → transcribing → thinking → speaking → listening", () => {
  const { state, phases, effects } = play([
    { type: "mic-ready" },
    { type: "speech-start" },
    { type: "speech-end" },
    { type: "transcribed", text: " What's on today? " },
    { type: "bot-busy", busy: true },
    { type: "bot-text", text: "Two meetings." },
    { type: "speaking", speaking: true },
    { type: "settled" },
    { type: "bot-busy", busy: false },
    { type: "speaking", speaking: false },
  ]);
  assert.deepEqual(phases, ["listening", "hearing", "transcribing", "thinking", "thinking", "thinking", "speaking", "speaking", "speaking", "listening"]);
  assert.deepEqual(effects, [{ type: "send", text: "[voice] What's on today?", mode: "prompt" }, { type: "flush-reply" }]);
  assert.equal(state.you, "What's on today?");
  assert.equal(state.bot, "Two meetings.");
});

test("speaking over the bot stops its voice and steers the turn that still runs", () => {
  const speaking = play([{ type: "mic-ready" }, { type: "transcribed", text: "Tell me a story" }, { type: "bot-busy", busy: true }, { type: "speaking", speaking: true }]).state;
  assert.equal(speaking.phase, "speaking");
  const { phases, effects } = play([{ type: "speech-start" }, { type: "speech-end" }, { type: "transcribed", text: "Actually, make it short" }], speaking);
  assert.deepEqual(phases, ["hearing", "transcribing", "thinking"]);
  assert.deepEqual(effects, [{ type: "stop-speech" }, { type: "interrupt" }, { type: "send", text: "[voice] Actually, make it short", mode: "steer" }]);
});

test("interrupting a reply whose turn has ended sends a new prompt", () => {
  const playing = play([{ type: "mic-ready" }, { type: "transcribed", text: "Hi" }, { type: "bot-busy", busy: true }, { type: "speaking", speaking: true }, { type: "settled" }, { type: "bot-busy", busy: false }]).state;
  const { effects } = play([{ type: "speech-start" }, { type: "speech-end" }, { type: "transcribed", text: "Next question" }], playing);
  assert.deepEqual(effects.at(-1), { type: "send", text: "[voice] Next question", mode: "prompt" });
});

test("hanging up releases everything, yet what was being transcribed still lands in the chat", () => {
  const busy = play([{ type: "mic-ready" }, { type: "speech-start" }, { type: "speech-end" }]).state;
  const { state, effects } = play([{ type: "hang-up" }, { type: "speech-start" }, { type: "bot-text", text: "ignored" }, { type: "transcribed", text: "Bye for now" }], busy);
  assert.equal(state.phase, "ended");
  assert.equal(state.endedAt, 1000);
  assert.deepEqual(effects, [{ type: "stop-speech" }, { type: "release" }, { type: "send", text: "[voice] Bye for now", mode: "prompt" }]);
  assert.equal(state.transcribing, 0);
});

test("muting the microphone drops a half-said utterance; muting the speaker silences the bot", () => {
  const hearing = play([{ type: "mic-ready" }, { type: "speech-start" }]).state;
  const muted = play([{ type: "mute-mic", muted: true }, { type: "speech-start" }], hearing);
  assert.deepEqual(muted.effects, [{ type: "set-mic", enabled: false }, { type: "discard-utterance" }]);
  assert.equal(muted.state.phase, "listening");
  const speaking = play([{ type: "mute-mic", muted: false }, { type: "transcribed", text: "Go" }, { type: "bot-busy", busy: true }, { type: "speaking", speaking: true }], muted.state).state;
  const silent = play([{ type: "mute-speaker", muted: true }, { type: "speaking", speaking: true }], speaking);
  assert.deepEqual(silent.effects, [{ type: "stop-speech" }]);
  assert.deepEqual(silent.phases, ["thinking", "thinking"], "the reply is still being written, only not spoken");
});

test("nothing heard, a failed transcription or a refused send all go back to listening with a notice", () => {
  const start = play([{ type: "mic-ready" }, { type: "speech-start" }, { type: "speech-end" }]).state;
  assert.deepEqual(play([{ type: "transcribed", text: "  " }], start).state.notice, "Didn't catch that.");
  const failed = play([{ type: "transcription-failed", message: "VoiceStudio did not answer within 120 s." }], start).state;
  assert.deepEqual([failed.phase, failed.notice], ["listening", "VoiceStudio did not answer within 120 s."]);
  const refused = play([{ type: "transcribed", text: "Hello" }, { type: "send-failed", message: "The bot is archived." }], start).state;
  assert.deepEqual([refused.phase, refused.awaitingReply, refused.notice], ["listening", false, "The bot is archived."]);
  assert.equal(play([{ type: "mic-failed", message: "Microphone access was denied." }]).state.phase, "failed");
});

test("a message queued behind another turn waits for the turn that answers it", () => {
  const { phases, effects } = play([
    { type: "mic-ready" },
    { type: "transcribed", text: "Remind me at five" },
    { type: "bot-busy", busy: true },
    { type: "delivered", delivery: "queued" },
    { type: "settled" },
    { type: "bot-busy", busy: false },
    { type: "bot-busy", busy: true },
    { type: "settled" },
  ]);
  assert.deepEqual(phases, ["listening", "thinking", "thinking", "thinking", "thinking", "thinking", "thinking", "listening"]);
  assert.deepEqual(effects.filter((effect) => effect.type === "flush-reply").length, 1, "only the second turn was the reply");
});

/* ── the call, with fake capabilities ── */

const RATE = 16_000;
function frames(ms: number, amplitude: number): Float32Array[] {
  let seed = 3;
  const hiss = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  return Array.from({ length: Math.round(ms / 20) }, (_, frame) => Float32Array.from({ length: 320 }, (_, index) => amplitude * Math.sin((2 * Math.PI * 220 * (frame * 320 + index)) / RATE) + 0.0005 * hiss()));
}
const say = (ms: number) => [...frames(300, 0), ...frames(ms, 0.3), ...frames(900, 0)];

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let round = 0; round < 5; round++) await new Promise<void>((resolve) => setImmediate(resolve)); };

function fakePlatform(options: { microphone?: () => Promise<never> } = {}) {
  let onFrame: (frame: Float32Array) => void = () => {};
  let handlers: CallSessionHandlers | undefined;
  const microphone = { sampleRate: RATE, enabled: true, closed: false, setEnabled(enabled: boolean) { this.enabled = enabled; }, close() { this.closed = true; } };
  const fake = {
    microphone,
    watching: false,
    transcriptions: [] as Deferred<string>[],
    sent: [] as { text: string; mode: string }[],
    synthesized: [] as string[],
    plays: [] as { text: string; done: Deferred<void>; signal: AbortSignal }[],
    timers: [] as { callback: () => void; ms: number; cancelled: boolean }[],
    frames(list: Float32Array[]) { for (const frame of list) onFrame(frame); },
    busy(value: boolean) { handlers?.onBusy(value); },
    event(event: Parameters<CallSessionHandlers["onEvent"]>[0]) { handlers?.onEvent(event); },
    async finishPlaying() {
      for (let guard = 0; guard < 20; guard++) {
        const playing = fake.plays.find((item) => !item.signal.aborted && !(item as { finished?: boolean }).finished);
        if (!playing) return;
        (playing as { finished?: boolean }).finished = true;
        playing.done.resolve();
        await settle();
      }
    },
  };
  const platform: CallPlatform = {
    openMicrophone: options.microphone ?? (async (listener) => { onFrame = listener; return microphone; }),
    transcribe: () => { const pending = deferred<string>(); fake.transcriptions.push(pending); return pending.promise; },
    send: async (text, mode) => { fake.sent.push({ text, mode }); return mode === "steer" ? "steered" : "sent"; },
    watch: (next) => { handlers = next; fake.watching = true; return () => { fake.watching = false; handlers = undefined; }; },
    synthesize: async (text) => { fake.synthesized.push(text); return new Blob([text], { type: "audio/mpeg" }); },
    play: async (audio, signal) => {
      const done = deferred<void>();
      fake.plays.push({ text: await audio.text(), done, signal });
      signal.addEventListener("abort", () => done.resolve());
      return done.promise;
    },
    setTimer: (callback, ms) => { const timer = { callback, ms, cancelled: false }; fake.timers.push(timer); return () => { timer.cancelled = true; }; },
    now: () => 0,
  };
  return { platform, fake };
}

test("a call hears an utterance, sends it marked as spoken and speaks the reply sentence by sentence", async () => {
  const { platform, fake } = fakePlatform();
  const call = new VoiceCall(platform);
  const phases: string[] = [];
  call.onChange((state) => { if (phases.at(-1) !== state.phase) phases.push(state.phase); });
  await call.start();
  assert.equal(call.state.phase, "listening");
  fake.frames(say(600));
  assert.equal(fake.transcriptions.length, 1);
  fake.transcriptions[0]!.resolve("What's on my calendar?");
  await settle();
  assert.deepEqual(fake.sent, [{ text: "[voice] What's on my calendar?", mode: "prompt" }]);
  fake.busy(true);
  fake.event({ type: "turn_start" });
  fake.event({ type: "text", delta: "You have **two** meetings. The first" });
  await settle();
  assert.deepEqual(fake.synthesized, ["You have two meetings."], "the first sentence is spoken while the rest is still written");
  assert.equal(call.state.phase, "speaking");
  fake.event({ type: "text", delta: " is at ten." });
  fake.event({ type: "settled" });
  fake.busy(false);
  await fake.finishPlaying();
  assert.deepEqual(fake.synthesized, ["You have two meetings.", "The first is at ten."]);
  assert.deepEqual(fake.plays.map((item) => item.text), fake.synthesized);
  assert.equal(call.state.phase, "listening");
  assert.equal(call.state.bot, "You have two meetings. The first is at ten.");
  assert.equal(call.state.you, "What's on my calendar?");
  assert.deepEqual(phases, ["listening", "hearing", "transcribing", "thinking", "speaking", "listening"]);
});

test("barging in stops the bot's voice, silences the rest of that turn and steers it", async () => {
  const { platform, fake } = fakePlatform();
  const call = new VoiceCall(platform);
  await call.start();
  fake.frames(say(500));
  fake.transcriptions[0]!.resolve("Tell me about the project");
  await settle();
  fake.busy(true);
  fake.event({ type: "text", delta: "The project started in May. It has three parts. " });
  await settle();
  assert.equal(call.state.phase, "speaking");
  const first = fake.plays[0]!;
  // The operator talks over the bot.
  fake.frames([...frames(100, 0), ...frames(400, 0.3)]);
  assert.equal(first.signal.aborted, true, "the bot's voice stops at once");
  assert.equal(call.state.phase, "hearing");
  fake.event({ type: "text", delta: "The first part is design. " });
  fake.frames(frames(900, 0));
  fake.transcriptions[1]!.resolve("Just the deadline, please");
  await settle();
  assert.deepEqual(fake.sent.at(-1), { text: "[voice] Just the deadline, please", mode: "steer" });
  fake.event({ type: "text", delta: "The second part is code. " });
  fake.event({ type: "turn_start" });
  fake.event({ type: "text", delta: "The deadline is Friday. " });
  fake.event({ type: "settled" });
  await settle();
  // "It has three parts." was still waiting for company when the operator spoke: it is never said, nor anything after it.
  assert.deepEqual(fake.synthesized, ["The project started in May.", "The deadline is Friday."]);
});

test("hanging up releases the microphone and the chat, and still sends what was being transcribed", async () => {
  const { platform, fake } = fakePlatform();
  const call = new VoiceCall(platform);
  await call.start();
  fake.frames(say(500));
  assert.equal(call.state.phase, "transcribing");
  call.hangUp();
  assert.equal(call.state.phase, "ended");
  assert.equal(fake.microphone.closed, true);
  assert.equal(fake.watching, false);
  fake.transcriptions[0]!.resolve("Bye for now");
  await settle();
  assert.deepEqual(fake.sent, [{ text: "[voice] Bye for now", mode: "prompt" }]);
  fake.frames(say(500));
  assert.equal(fake.transcriptions.length, 1, "nothing is heard after hanging up");
});

test("a denied microphone ends the call with the reason and watches nothing", async () => {
  const denied = Object.assign(new Error("Microphone access was denied."), { name: "NotAllowedError" });
  const { platform, fake } = fakePlatform({ microphone: async () => { throw denied; } });
  const call = new VoiceCall(platform);
  await call.start();
  assert.deepEqual([call.state.phase, call.state.error], ["failed", "Microphone access was denied."]);
  assert.equal(fake.watching, false);
});

test("with the speaker muted the reply is captioned, not synthesized, and the call listens again", async () => {
  const { platform, fake } = fakePlatform();
  const call = new VoiceCall(platform);
  await call.start();
  call.setSpeakerMuted(true);
  fake.frames(say(500));
  fake.transcriptions[0]!.resolve("Status?");
  await settle();
  fake.busy(true);
  fake.event({ type: "text", delta: "All green. Nothing to do." });
  fake.event({ type: "settled" });
  fake.busy(false);
  await settle();
  assert.deepEqual(fake.synthesized, []);
  assert.equal(call.state.bot, "All green. Nothing to do.");
  assert.equal(call.state.phase, "listening");
  call.setMicMuted(true);
  assert.equal(fake.microphone.enabled, false);
  fake.frames(say(500));
  assert.equal(fake.transcriptions.length, 1, "a muted microphone hears nothing");
});

test("utterances reach the chat in the order they were said", async () => {
  const { platform, fake } = fakePlatform();
  const call = new VoiceCall(platform);
  await call.start();
  fake.frames(say(400));
  fake.frames(say(400));
  assert.equal(fake.transcriptions.length, 2);
  fake.transcriptions[1]!.resolve("second");
  await settle();
  assert.equal(fake.sent.length, 0, "the later utterance waits for the earlier one");
  fake.transcriptions[0]!.resolve("first");
  await settle();
  assert.deepEqual(fake.sent.map((item) => item.text), ["[voice] first", "[voice] second"]);
});

test("a sent utterance that starts no turn stops waiting after the reply timeout", async () => {
  const { platform, fake } = fakePlatform();
  const call = new VoiceCall(platform, { replyTimeoutMs: 5_000 });
  await call.start();
  fake.frames(say(400));
  fake.transcriptions[0]!.resolve("Anyone there?");
  await settle();
  assert.equal(call.state.phase, "thinking");
  const timer = fake.timers.at(-1)!;
  assert.equal(timer.ms, 5_000);
  timer.callback();
  assert.equal(call.state.phase, "listening");
  assert.equal(call.state.awaitingReply, false);
});
