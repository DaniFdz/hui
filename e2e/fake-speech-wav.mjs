#!/usr/bin/env node
/** A WAV file for Chromium's fake microphone in bot-call journeys (e2e/bots-voice.browser.md).
 * Usage: node e2e/fake-speech-wav.mjs <out.wav>
 * then start the browser with --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
 * --use-file-for-fake-audio-capture=<out.wav>. Chromium loops the file: 2 s of room noise (about
 * -66 dBFS), 1.45 s of voiced, speech-like syllables (harmonics with an envelope and vibrato, short
 * gaps under the call's 700 ms hangover), then 26 s of room noise, so a call hears one utterance
 * about every 29.5 s. It is not words: the VoiceStudio fixture answers transcriptions with scripted
 * text. Deterministic: the same bytes on every run. */
import { writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) {
  process.stderr.write("Usage: node e2e/fake-speech-wav.mjs <out.wav>\n");
  process.exit(2);
}
const rate = 48_000;
const lead = 2;
const tail = 26;
const gap = 0.07;
const syllables = [[0.22, 150], [0.18, 170], [0.26, 135], [0.2, 160], [0.24, 145]];
const speech = syllables.reduce((total, [seconds]) => total + seconds + gap, 0);
const samples = new Int16Array(Math.round((lead + speech + tail) * rate));
let seed = 7;
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x7fffffff) * 2 - 1;
};
for (let index = 0; index < samples.length; index++) samples[index] = Math.round(noise() * 0.0005 * 32767);
let at = Math.round(lead * rate);
for (const [seconds, pitch] of syllables) {
  const count = Math.round(seconds * rate);
  for (let index = 0; index < count; index++) {
    const time = index / rate;
    const envelope = Math.sin((Math.PI * index) / count) ** 0.6;
    const vibrato = 1 + 0.03 * Math.sin(2 * Math.PI * 5 * time);
    let value = 0;
    for (const [harmonic, amplitude] of [[1, 1], [2, 0.6], [3, 0.45], [5, 0.3], [7, 0.18], [9, 0.1]]) {
      value += amplitude * Math.sin(2 * Math.PI * pitch * harmonic * vibrato * time);
    }
    samples[at + index] += Math.round((value / 2.6) * 0.35 * envelope * 32767);
  }
  at += count + Math.round(gap * rate);
}
const pcm = Buffer.from(samples.buffer);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
writeFileSync(out, Buffer.concat([header, pcm]));
process.stdout.write(`${out}: ${(samples.length / rate).toFixed(2)} s, one ${speech.toFixed(2)} s utterance per loop\n`);
