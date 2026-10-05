/**
 * Voice-activity detection for bot calls (HUI-18): an energy threshold that
 * follows the room's noise floor, onsets confirmed over a few frames, a
 * hangover that bridges the pauses between words and a pre-roll so an
 * utterance keeps its first syllable. Pure and synchronous, with no model and
 * no dependency: a call feeds it the frames its audio worklet captures, tests
 * feed it synthetic ones.
 */

export type VadOptions = {
  /** Of the frames pushed. */
  sampleRate: number;
  /** Speech is at least this loud (dBFS), however quiet the room. */
  floorDb: number;
  /** …and this far above the room's noise. */
  marginDb: number;
  /** Extra margin while the bot speaks, so its echo is not taken for the operator. */
  bargeInMarginDb: number;
  /** Loud time that confirms speech. */
  onsetMs: number;
  /** Loud time that confirms speech over the bot's voice (barge-in). */
  bargeInOnsetMs: number;
  /** Quiet time that ends an utterance. */
  hangoverMs: number;
  /** An utterance with less voiced time is noise (a cough, a click) and is dropped. */
  minSpeechMs: number;
  /** A longer utterance is cut there and sent as it is. */
  maxUtteranceMs: number;
  /** Audio kept from before the onset. */
  prerollMs: number;
  /** Quiet kept after the last loud frame. */
  tailMs: number;
  /** How slowly the noise floor rises toward a louder room; it falls within about 100 ms. */
  noiseRiseMs: number;
  /** How slowly it rises during an utterance: real speech keeps pulling it down between words, a steady hum does not. */
  speechNoiseRiseMs: number;
};

export const VAD_DEFAULTS: Omit<VadOptions, "sampleRate"> = {
  floorDb: -50,
  marginDb: 12,
  bargeInMarginDb: 8,
  onsetMs: 120,
  bargeInOnsetMs: 250,
  hangoverMs: 700,
  minSpeechMs: 250,
  maxUtteranceMs: 30_000,
  prerollMs: 300,
  tailMs: 250,
  noiseRiseMs: 2_000,
  speechNoiseRiseMs: 10_000,
};

export type VadEvent =
  /** Speech is confirmed: a call stops the bot's voice here (barge-in). */
  | { type: "start" }
  /** A whole utterance, pre-roll and tail included. */
  | { type: "end"; audio: Float32Array; durationMs: number; forced: boolean }
  /** What started was too short to be speech. */
  | { type: "cancel" };

/** RMS level of a frame in dBFS; silence is -120. */
export function frameLevelDb(frame: Float32Array): number {
  let sum = 0;
  for (const sample of frame) sum += sample * sample;
  const rms = Math.sqrt(sum / Math.max(1, frame.length));
  return rms > 0 ? Math.max(-120, 20 * Math.log10(rms)) : -120;
}

type Frame = { samples: Float32Array; ms: number };

function concat(frames: readonly Frame[]): Float32Array {
  const audio = new Float32Array(frames.reduce((total, frame) => total + frame.samples.length, 0));
  let offset = 0;
  for (const frame of frames) {
    audio.set(frame.samples, offset);
    offset += frame.samples.length;
  }
  return audio;
}

const totalMs = (frames: readonly Frame[]) => frames.reduce((total, frame) => total + frame.ms, 0);

export class VoiceActivityDetector {
  readonly options: VadOptions;
  /** While the bot speaks, speech must be louder and longer to count. */
  bargeIn = false;
  #noiseDb: number;
  #state: "quiet" | "onset" | "speech" = "quiet";
  /** Recent quiet frames, the pre-roll of the next utterance. */
  #recent: Frame[] = [];
  #onset: Frame[] = [];
  #utterance: Frame[] = [];
  #voicedMs = 0;
  #quietMs = 0;

  constructor(options: Partial<VadOptions> & { sampleRate: number }) {
    this.options = { ...VAD_DEFAULTS, ...options };
    this.#noiseDb = this.options.floorDb - this.options.marginDb;
  }

  /** Someone is speaking (an utterance is open). */
  get speaking(): boolean {
    return this.#state === "speech";
  }

  get noiseDb(): number {
    return this.#noiseDb;
  }

  /** Forgets a half-heard utterance (the microphone was muted); the noise floor stays. */
  reset(): void {
    this.#state = "quiet";
    this.#recent = [];
    this.#onset = [];
    this.#utterance = [];
    this.#voicedMs = 0;
    this.#quietMs = 0;
  }

  push(samples: Float32Array): VadEvent[] {
    const { options } = this;
    const frame: Frame = { samples, ms: (samples.length / options.sampleRate) * 1000 };
    const db = frameLevelDb(samples);
    const threshold = Math.max(options.floorDb, this.#noiseDb + options.marginDb) + (this.bargeIn ? options.bargeInMarginDb : 0);
    const loud = db >= threshold;
    if (this.#state === "quiet") {
      if (loud) {
        this.#state = "onset";
        this.#onset = [frame];
      } else {
        this.#adaptNoise(db, frame.ms, options.noiseRiseMs);
        this.#remember(frame);
      }
      return this.#confirm();
    }
    if (this.#state === "onset") {
      if (loud) {
        this.#onset.push(frame);
        return this.#confirm();
      }
      // A blip: it joins the pre-roll and the room stays quiet.
      for (const blip of this.#onset) this.#remember(blip);
      this.#remember(frame);
      this.#onset = [];
      this.#state = "quiet";
      return [];
    }
    this.#utterance.push(frame);
    this.#adaptNoise(db, frame.ms, options.speechNoiseRiseMs);
    if (loud) {
      this.#voicedMs += frame.ms;
      this.#quietMs = 0;
    } else {
      this.#quietMs += frame.ms;
    }
    if (this.#quietMs >= options.hangoverMs) return [this.#finish(false)];
    if (totalMs(this.#utterance) >= options.maxUtteranceMs) return [this.#finish(true)];
    return [];
  }

  #confirm(): VadEvent[] {
    if (this.#state !== "onset" || totalMs(this.#onset) < (this.bargeIn ? this.options.bargeInOnsetMs : this.options.onsetMs)) return [];
    this.#state = "speech";
    this.#voicedMs = totalMs(this.#onset);
    this.#quietMs = 0;
    this.#utterance = [...this.#recent, ...this.#onset];
    this.#recent = [];
    this.#onset = [];
    return [{ type: "start" }];
  }

  #finish(forced: boolean): VadEvent {
    let drop = Math.max(0, this.#quietMs - this.options.tailMs);
    const frames = [...this.#utterance];
    while (frames.length && drop >= frames.at(-1)!.ms) drop -= frames.pop()!.ms;
    const voiced = this.#voicedMs;
    this.reset();
    if (!forced && voiced < this.options.minSpeechMs) return { type: "cancel" };
    return { type: "end", audio: concat(frames), durationMs: Math.round(totalMs(frames)), forced };
  }

  #remember(frame: Frame): void {
    this.#recent.push(frame);
    while (this.#recent.length > 1 && totalMs(this.#recent) - this.#recent[0]!.ms >= this.options.prerollMs) this.#recent.shift();
  }

  #adaptNoise(db: number, ms: number, riseMs: number): void {
    const rate = Math.min(1, ms / (db < this.#noiseDb ? 100 : riseMs));
    this.#noiseDb = Math.min(-20, Math.max(-100, this.#noiseDb + (db - this.#noiseDb) * rate));
  }
}
