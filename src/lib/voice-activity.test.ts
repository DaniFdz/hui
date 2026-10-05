import assert from "node:assert/strict";
import { test } from "node:test";
import { frameLevelDb, VoiceActivityDetector, type VadEvent } from "./voice-activity.ts";

const RATE = 16_000;
const FRAME = 320; // 20 ms

/** 20 ms frames of a 220 Hz tone at `amplitude` over a faint deterministic hiss (about -71 dBFS). */
function frames(ms: number, amplitude: number): Float32Array[] {
  let seed = 7;
  const hiss = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const out: Float32Array[] = [];
  for (let start = 0; start < ms; start += 20) {
    const frame = new Float32Array(FRAME);
    for (let index = 0; index < FRAME; index++) {
      const t = (start / 1000) * RATE + index;
      frame[index] = amplitude * Math.sin((2 * Math.PI * 220 * t) / RATE) + 0.0005 * hiss();
    }
    out.push(frame);
  }
  return out;
}
const speech = (ms: number) => frames(ms, 0.3); // about -13 dBFS
const silence = (ms: number) => frames(ms, 0);

function run(vad: VoiceActivityDetector, ...parts: Float32Array[][]): VadEvent[] {
  return parts.flat().flatMap((frame) => vad.push(frame));
}

const types = (events: readonly VadEvent[]) => events.map((event) => event.type);
const ended = (events: readonly VadEvent[]) => events.filter((event): event is Extract<VadEvent, { type: "end" }> => event.type === "end");

test("measures frames in dBFS", () => {
  assert.equal(frameLevelDb(new Float32Array(320)), -120);
  assert.ok(Math.abs(frameLevelDb(speech(20)[0]!) - -13.5) < 0.5);
  assert.ok(frameLevelDb(silence(20)[0]!) < -65);
});

test("an utterance between silences is one segment with its pre-roll and a short tail", () => {
  const vad = new VoiceActivityDetector({ sampleRate: RATE });
  const events = run(vad, silence(1000), speech(600), silence(1000));
  assert.deepEqual(types(events), ["start", "end"]);
  const [utterance] = ended(events);
  // 300 ms of pre-roll, the 600 ms said, and 260 ms of the 700 ms hangover.
  assert.equal(utterance!.durationMs, 1160);
  assert.equal(utterance!.audio.length, 1160 * 16);
  assert.equal(utterance!.forced, false);
  assert.ok(frameLevelDb(utterance!.audio.subarray(0, 300 * 16)) < -60, "the pre-roll is the quiet before");
  assert.ok(frameLevelDb(utterance!.audio.subarray(300 * 16, 900 * 16)) > -15, "then the words, whole");
  assert.equal(vad.speaking, false);
});

test("pauses shorter than the hangover stay inside one utterance", () => {
  const vad = new VoiceActivityDetector({ sampleRate: RATE });
  const events = run(vad, silence(500), speech(400), silence(400), speech(400), silence(1000));
  assert.deepEqual(types(events), ["start", "end"]);
  assert.equal(ended(events)[0]!.durationMs, 300 + 1200 + 260);
});

test("a click is not speech, and a cough too short to be words is cancelled", () => {
  const vad = new VoiceActivityDetector({ sampleRate: RATE });
  assert.deepEqual(types(run(vad, silence(500), speech(60), silence(1000))), [], "shorter than the onset never starts");
  assert.deepEqual(types(run(vad, speech(160), silence(1000))), ["start", "cancel"], "started, but under the minimum voiced time");
  assert.equal(vad.speaking, false);
});

test("the threshold follows the room's noise", () => {
  const quietRoom = new VoiceActivityDetector({ sampleRate: RATE });
  assert.deepEqual(types(run(quietRoom, silence(1000), frames(400, 0.014))), ["start"], "a -40 dBFS murmur is speech in a quiet room");
  const noisyRoom = new VoiceActivityDetector({ sampleRate: RATE });
  run(noisyRoom, frames(4000, 0.0025), frames(4000, 0.0056));
  assert.ok(noisyRoom.noiseDb > -52 && noisyRoom.noiseDb < -46, String(noisyRoom.noiseDb));
  assert.deepEqual(types(run(noisyRoom, frames(400, 0.014))), [], "the same murmur is room noise here");
  assert.deepEqual(types(run(noisyRoom, speech(400), silence(1000))), ["start", "end"], "a voice is still a voice");
});

test("a steady hum stops counting as speech once the floor catches up", () => {
  const vad = new VoiceActivityDetector({ sampleRate: RATE });
  const events = run(vad, silence(500), frames(20_000, 0.02));
  assert.deepEqual(types(events), ["start", "end"]);
  assert.ok(ended(events)[0]!.durationMs < 15_000, "ended by the hangover, long before the 30 s cut");
  assert.ok(vad.noiseDb > -46);
});

test("while the bot speaks, speech must be louder and longer to barge in", () => {
  const vad = new VoiceActivityDetector({ sampleRate: RATE });
  run(vad, silence(1000));
  vad.bargeIn = true;
  assert.deepEqual(types(run(vad, frames(600, 0.0071), silence(800))), [], "a -46 dBFS echo does not interrupt");
  assert.deepEqual(types(run(vad, speech(200))), [], "not yet: barge-in waits for 250 ms of voice");
  assert.deepEqual(types(run(vad, speech(100))), ["start"]);
  vad.bargeIn = false;
  const calm = new VoiceActivityDetector({ sampleRate: RATE });
  assert.deepEqual(types(run(calm, silence(1000), frames(600, 0.0071))), ["start"], "the same level counts when nobody else is talking");
});

test("a monologue is cut at the maximum and goes on as the next utterance", () => {
  const vad = new VoiceActivityDetector({ sampleRate: RATE, maxUtteranceMs: 2_000 });
  const events = run(vad, silence(300), speech(2_500));
  assert.deepEqual(types(events), ["start", "end", "start"]);
  const [first] = ended(events);
  assert.equal(first!.forced, true);
  assert.equal(first!.durationMs, 2_000);
});

test("reset forgets a half-heard utterance", () => {
  const vad = new VoiceActivityDetector({ sampleRate: RATE });
  assert.deepEqual(types(run(vad, silence(300), speech(300))), ["start"]);
  assert.equal(vad.speaking, true);
  vad.reset();
  assert.deepEqual(types(run(vad, silence(1500))), []);
  assert.equal(vad.speaking, false);
});
