import assert from "node:assert/strict";
import { test } from "node:test";
import { ENVELOPE_WINDOW_MS, LEVEL_CEILING_DB, LEVEL_FLOOR_DB, audioEnvelope, envelopeAt, frameLevel, levelFromDb, mixDown } from "./voice-level.ts";

const tone = (amplitude: number, samples: number) => Float32Array.from({ length: samples }, (_, index) => amplitude * Math.sin((2 * Math.PI * 220 * index) / 16_000));

test("a level is 0 for a quiet room and 1 for loud speech, linear in decibels between", () => {
  assert.equal(levelFromDb(-120), 0);
  assert.equal(levelFromDb(LEVEL_FLOOR_DB), 0);
  assert.equal(levelFromDb(LEVEL_CEILING_DB), 1);
  assert.equal(levelFromDb(0), 1);
  assert.equal(levelFromDb((LEVEL_FLOOR_DB + LEVEL_CEILING_DB) / 2), 0.5);
  assert.equal(levelFromDb(Number.NaN), 0);
  assert.equal(frameLevel(new Float32Array(320)), 0, "digital silence");
  assert.ok(frameLevel(tone(0.3, 320)) > 0.9, "speech-loud");
  assert.ok(frameLevel(tone(0.0005, 320)) === 0, "room hiss");
});

test("a clip's envelope follows its loudness window by window and is read at the playback position", () => {
  const rate = 16_000;
  const window = (rate * ENVELOPE_WINDOW_MS) / 1000;
  // 100 ms loud, 100 ms silent, 100 ms soft.
  const clip = new Float32Array(window * 15);
  clip.set(tone(0.3, window * 5), 0);
  clip.set(tone(0.01, window * 5), window * 10);
  const envelope = audioEnvelope(clip, rate);
  assert.equal(envelope.length, 15);
  assert.ok(envelopeAt(envelope, 0.05) > 0.9, "loud at 50 ms");
  assert.equal(envelopeAt(envelope, 0.15), 0, "silent at 150 ms");
  const soft = envelopeAt(envelope, 0.25);
  assert.ok(soft > 0 && soft < 0.6, `soft at 250 ms: ${soft}`);
  assert.equal(envelopeAt(envelope, 0.5), 0, "past the end");
  assert.equal(envelopeAt(envelope, -1), 0);
  assert.equal(envelopeAt(new Float32Array(), 0), 0);
});

test("stereo is mixed to mono before measuring", () => {
  const left = Float32Array.from([1, 1, 0]);
  const right = Float32Array.from([0, 1, 0, 1]);
  assert.deepEqual([...mixDown([left, right])], [0.5, 1, 0, 0.5]);
  assert.equal(mixDown([left]), left);
});
