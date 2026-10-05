/**
 * Audio in the browser for bots' voice (HUI-18): the call's microphone (an
 * AudioWorklet handing out 20 ms frames), voice notes (MediaRecorder), the one
 * player every bot voice uses, and the pure WAV helpers between them. The
 * microphone opens only from a click (a call, a voice note) and closes when it
 * ends; nothing here stores audio.
 */
import type { CallMicrophone } from "./voice-call.ts";

/* ── pure helpers ── */

/** Averages `from`-rate samples down to `to` (speech needs no better anti-aliasing for a recognizer). */
export function downsample(samples: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < out.length; index++) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let at = start; at < end; at++) sum += samples[at]!;
    out[index] = sum / Math.max(1, end - start);
  }
  return out;
}

/** Mono float samples as 16-bit PCM WAV, which every recognizer reads. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index); };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

/** An utterance as a 16 kHz WAV recording, small enough to send at once. */
export function utteranceWav(samples: Float32Array, sampleRate: number): Blob {
  const rate = Math.min(sampleRate, 16_000);
  return new Blob([encodeWav(downsample(samples, sampleRate, rate), rate)], { type: "audio/wav" });
}

/** The recording format a voice note uses: Opus in WebM or Ogg where supported (small), else MP4 (Safari). */
export function preferredRecordingType(supported: (type: string) => boolean): string | undefined {
  return ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"].find((type) => supported(type));
}

/** Pages the browser gives no microphone (plain HTTP away from localhost) and HUI's desktop app. */
export function microphoneContext(): { secure: boolean; desktop: boolean } {
  return {
    secure: typeof window === "undefined" || (window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia)),
    desktop: typeof navigator !== "undefined" && /\bElectron\//u.test(navigator.userAgent),
  };
}

/* ── the call's microphone ── */

const CAPTURE_WORKLET = `class HuiVoiceCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.size;
    this.frame = new Float32Array(this.size);
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let index = 0; index < channel.length; index++) {
        this.frame[this.filled++] = channel[index];
        if (this.filled === this.size) {
          this.port.postMessage(this.frame, [this.frame.buffer]);
          this.frame = new Float32Array(this.size);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("hui-voice-capture", HuiVoiceCapture);
`;

const AUDIO_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

/** Opens the microphone for a call and hands out frames of `frameMs`; `close` releases it. */
export async function openCallMicrophone(onFrame: (frame: Float32Array) => void, frameMs = 20): Promise<CallMicrophone> {
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("This page has no microphone access.", "SecurityError");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
  const context = new AudioContext();
  try {
    if (context.state === "suspended") await context.resume();
    const module = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(module);
    } finally {
      URL.revokeObjectURL(module);
    }
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, "hui-voice-capture", { processorOptions: { size: Math.round((context.sampleRate * frameMs) / 1000) } });
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => onFrame(event.data);
    // The worklet runs only when its output is pulled; a muted gain keeps it pulled without a sound.
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(capture);
    capture.connect(sink);
    sink.connect(context.destination);
    return {
      sampleRate: context.sampleRate,
      setEnabled: (enabled) => { for (const track of stream.getAudioTracks()) track.enabled = enabled; },
      close: () => {
        capture.port.onmessage = null;
        source.disconnect();
        capture.disconnect();
        for (const track of stream.getTracks()) track.stop();
        void context.close().catch(() => undefined);
      },
    };
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    void context.close().catch(() => undefined);
    throw error;
  }
}

/* ── voice notes ── */

export type VoiceNoteRecorder = {
  readonly mimeType: string;
  /** Ends the note and gives its audio. */
  stop(): Promise<Blob>;
  /** Ends it and throws the audio away. */
  cancel(): void;
};

/** Starts recording a voice note. A note longer than `maxMs` stops by itself (`onLimit`). */
export async function startVoiceNote(options: { maxMs?: number; onLimit?: () => void } = {}): Promise<VoiceNoteRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("This page has no microphone access.", "SecurityError");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
  const release = () => { for (const track of stream.getTracks()) track.stop(); };
  let recorder: MediaRecorder;
  try {
    const type = preferredRecordingType((candidate) => MediaRecorder.isTypeSupported(candidate));
    recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32_000 } : undefined);
  } catch (error) {
    release();
    throw error;
  }
  let chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      release();
      resolve(new Blob(chunks, { type: (recorder.mimeType || "audio/webm").split(";")[0] }));
    };
  });
  const limit = setTimeout(() => { if (recorder.state === "recording") { recorder.stop(); options.onLimit?.(); } }, options.maxMs ?? 10 * 60_000);
  recorder.start(1_000);
  return {
    mimeType: recorder.mimeType,
    stop: () => {
      clearTimeout(limit);
      if (recorder.state !== "inactive") recorder.stop();
      return stopped;
    },
    cancel: () => {
      clearTimeout(limit);
      chunks = [];
      if (recorder.state !== "inactive") recorder.stop();
      else release();
    },
  };
}

/* ── playback ── */

/**
 * The one `<audio>` element every bot voice plays through (read-aloud, voice
 * previews, calls), so only one plays at a time. It carries its state for
 * tests and assistive tooling: `data-state` (`idle`/`playing`) and
 * `data-clips` (clips played to their end).
 */
export class VoicePlayer {
  readonly element: HTMLAudioElement;
  #clips = 0;

  constructor(root: Document = document) {
    const existing = root.getElementById("hui-voice-player");
    this.element = existing instanceof HTMLAudioElement ? existing : Object.assign(root.createElement("audio"), { id: "hui-voice-player", hidden: true, preload: "auto" });
    this.element.dataset["state"] ??= "idle";
    if (!existing) root.body.append(this.element);
  }

  /** Plays one clip; resolves at its end, or quietly when `signal` aborts (it stops at once). */
  play(audio: Blob, signal: AbortSignal): Promise<void> {
    const element = this.element;
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(audio);
      const finish = (error?: Error) => {
        element.removeEventListener("ended", onEnded);
        element.removeEventListener("error", onError);
        signal.removeEventListener("abort", onAbort);
        element.dataset["state"] = "idle";
        URL.revokeObjectURL(url);
        if (error) reject(error);
        else resolve();
      };
      const onEnded = () => {
        this.#clips += 1;
        element.dataset["clips"] = String(this.#clips);
        finish();
      };
      const onError = () => finish(new Error("The browser could not play VoiceStudio's audio."));
      const onAbort = () => {
        element.pause();
        element.removeAttribute("src");
        element.load();
        finish();
      };
      element.addEventListener("ended", onEnded);
      element.addEventListener("error", onError);
      signal.addEventListener("abort", onAbort, { once: true });
      element.src = url;
      element.dataset["state"] = "playing";
      element.play().catch((error: unknown) => {
        if (!signal.aborted) finish(error instanceof Error ? error : new Error("The browser refused to play audio."));
      });
    });
  }
}

let shared: VoicePlayer | undefined;

export function voicePlayer(): VoicePlayer {
  shared ??= new VoicePlayer();
  return shared;
}
