import assert from "node:assert/strict";
import { test } from "node:test";
import { downsample, encodeWav, preferredRecordingType, utteranceWav } from "./voice-audio.ts";

test("a WAV file VoiceStudio can read: RIFF header, 16-bit mono PCM, clipped samples", () => {
  const wav = encodeWav(Float32Array.from([0, 0.5, -0.5, 1, -1, 2]), 16_000);
  const view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.subarray(8, 16)), "WAVEfmt ");
  assert.equal(view.getUint32(4, true), 36 + 12);
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 12);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((index) => view.getInt16(44 + index * 2, true)), [0, 16383, -16384, 32767, -32768, 32767]);
});

test("utterances are sent at 16 kHz", async () => {
  const samples = Float32Array.from({ length: 48_000 }, (_, index) => Math.sin(index / 10));
  const down = downsample(samples, 48_000, 16_000);
  assert.equal(down.length, 16_000);
  assert.ok(Math.abs(down[100]! - (samples[300]! + samples[301]! + samples[302]!) / 3) < 1e-6, "each output sample averages its inputs");
  assert.equal(downsample(samples, 16_000, 16_000), samples, "never upsampled");
  const wav = utteranceWav(samples, 48_000);
  assert.equal(wav.type, "audio/wav");
  assert.equal(wav.size, 44 + 16_000 * 2);
  assert.equal(new DataView(await wav.arrayBuffer()).getUint32(24, true), 16_000);
});

test("voice notes record Opus where the browser can, MP4 otherwise", () => {
  assert.equal(preferredRecordingType((type) => type.startsWith("audio/webm")), "audio/webm;codecs=opus");
  assert.equal(preferredRecordingType((type) => type.startsWith("audio/ogg")), "audio/ogg;codecs=opus");
  assert.equal(preferredRecordingType((type) => type === "audio/mp4"), "audio/mp4", "Safari");
  assert.equal(preferredRecordingType(() => false), undefined, "the recorder's own default");
});
