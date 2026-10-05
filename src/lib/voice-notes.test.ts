import assert from "node:assert/strict";
import { test } from "node:test";
import { VoiceNoteController, type VoiceNoteDeps } from "./voice-notes.ts";
import type { VoiceNoteRecorder } from "./voice-audio.ts";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

const settle = async () => { for (let round = 0; round < 5; round++) await new Promise<void>((resolve) => setImmediate(resolve)); };

function harness(overrides: Partial<VoiceNoteDeps> = {}) {
  let clock = 1_000;
  const delivered: string[] = [];
  const recorder = { stopped: false, cancelled: false };
  let tick: (() => void) | undefined;
  let updates = 0;
  const transcriptions: Deferred<string>[] = [];
  const fake: VoiceNoteRecorder = {
    mimeType: "audio/webm;codecs=opus",
    stop: async () => { recorder.stopped = true; return new Blob([new Uint8Array(32)], { type: "audio/webm" }); },
    cancel: () => { recorder.cancelled = true; },
  };
  const notes = new VoiceNoteController({ requestUpdate: () => { updates += 1; } }, {
    start: async () => fake,
    transcribe: () => { const pending = deferred<string>(); transcriptions.push(pending); return pending.promise; },
    deliver: (text) => delivered.push(text),
    microphoneError: (error) => `mic: ${error instanceof Error ? error.name : "?"}`,
    now: () => clock,
    setInterval: (callback) => { tick = callback; return () => { tick = undefined; }; },
    ...overrides,
  });
  return { notes, delivered, recorder, transcriptions, advance: (ms: number) => { clock += ms; tick?.(); }, ticking: () => Boolean(tick), updates: () => updates };
}

test("records, shows the time, transcribes and hands the words over", async () => {
  const { notes, delivered, recorder, transcriptions, advance, ticking } = harness();
  await notes.start();
  assert.deepEqual(notes.state, { status: "recording", startedAt: 1_000 });
  assert.equal(ticking(), true);
  advance(7_000);
  assert.equal(notes.now - 1_000, 7_000, "the timer follows the clock");
  const stopping = notes.stop();
  assert.equal(notes.state.status, "transcribing");
  assert.equal(ticking(), false);
  await settle();
  transcriptions[0]!.resolve("  Remind me to call Ana.  ");
  await stopping;
  assert.equal(recorder.stopped, true);
  assert.deepEqual(delivered, ["Remind me to call Ana."]);
  assert.deepEqual(notes.state, { status: "idle" });
});

test("a denied microphone, an empty note or a failed transcription say so", async () => {
  const denied = harness({ start: async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }); } });
  await denied.notes.start();
  assert.deepEqual(denied.notes.state, { status: "error", message: "mic: NotAllowedError" });
  denied.notes.dismiss();
  assert.deepEqual(denied.notes.state, { status: "idle" });

  const empty = harness();
  await empty.notes.start();
  const stopping = empty.notes.stop();
  await settle();
  empty.transcriptions[0]!.resolve("   ");
  await stopping;
  assert.deepEqual(empty.notes.state, { status: "error", message: "VoiceStudio heard no words in that note." });
  assert.deepEqual(empty.delivered, []);

  const failing = harness();
  await failing.notes.start();
  const failed = failing.notes.stop();
  await settle();
  failing.transcriptions[0]!.reject(new Error("VoiceStudio did not answer within 120 s."));
  await failed;
  assert.deepEqual(failing.notes.state, { status: "error", message: "VoiceStudio did not answer within 120 s." });
});

test("cancel frees the microphone and drops the note, even one still being opened", async () => {
  const { notes, recorder, delivered } = harness();
  await notes.start();
  notes.cancel();
  assert.equal(recorder.cancelled, true);
  assert.deepEqual(notes.state, { status: "idle" });
  const slow = deferred<VoiceNoteRecorder>();
  const late = harness({ start: () => slow.promise });
  const starting = late.notes.start();
  assert.equal(late.notes.state.status, "starting");
  late.notes.cancel();
  let lateCancelled = false;
  slow.resolve({ mimeType: "audio/webm", stop: async () => new Blob(), cancel: () => { lateCancelled = true; } });
  await starting;
  assert.equal(lateCancelled, true, "a microphone granted after Cancel is released at once");
  assert.deepEqual(late.notes.state, { status: "idle" });
  assert.deepEqual(delivered, []);
});
