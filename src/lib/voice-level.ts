/**
 * Audio levels for a bot's face during a call (HUI-18): the microphone's,
 * from the frames voice-activity detection already reads, and the bot's
 * voice's, from an envelope of each clip read at its playback position.
 * 0 is silence, 1 is loud speech. Pure, so tests feed it synthetic audio.
 */
import { frameLevelDb } from "./voice-activity.ts";

/** At and below this (dBFS) a level is 0: a quiet room. */
export const LEVEL_FLOOR_DB = -60;
/** At and above this (dBFS) a level is 1: loud speech close to the microphone, or a voice at full scale. */
export const LEVEL_CEILING_DB = -14;
/** One envelope value per this many milliseconds of a clip, the call's frame size. */
export const ENVELOPE_WINDOW_MS = 20;

export function levelFromDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - LEVEL_FLOOR_DB) / (LEVEL_CEILING_DB - LEVEL_FLOOR_DB)));
}

/** The level of one frame of samples. */
export function frameLevel(frame: Float32Array): number {
  return levelFromDb(frameLevelDb(frame));
}

/** Decoded channels as one (their average). */
export function mixDown(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const length = Math.max(0, ...channels.map((channel) => channel.length));
  const mono = new Float32Array(length);
  for (const channel of channels) for (let index = 0; index < channel.length; index++) mono[index]! += channel[index]! / channels.length;
  return mono;
}

/** A clip's level every `windowMs`, from its (mono) samples. */
export function audioEnvelope(samples: Float32Array, sampleRate: number, windowMs = ENVELOPE_WINDOW_MS): Float32Array {
  const size = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const envelope = new Float32Array(Math.ceil(samples.length / size));
  for (let index = 0; index < envelope.length; index++) envelope[index] = frameLevel(samples.subarray(index * size, (index + 1) * size));
  return envelope;
}

/** The envelope's level at a playback position in seconds; 0 before the start and past the end. */
export function envelopeAt(envelope: Float32Array, seconds: number, windowMs = ENVELOPE_WINDOW_MS): number {
  if (!envelope.length || !Number.isFinite(seconds) || seconds < 0) return 0;
  const index = Math.floor((seconds * 1000) / windowMs);
  return index < envelope.length ? envelope[index]! : 0;
}
