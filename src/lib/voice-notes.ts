/**
 * A voice note in a bot chat's composer (HUI-18): record on a click, show the
 * time, stop or cancel, transcribe through the gateway, then hand the words to
 * the composer (or send them at once, as Settings says). The microphone is
 * held only while a note records. Browser capabilities are injected.
 */
import type { VoiceNoteState } from "./voice.ts";
import type { VoiceNoteRecorder } from "./voice-audio.ts";

export type VoiceNoteDeps = {
  start(options: { onLimit: () => void }): Promise<VoiceNoteRecorder>;
  transcribe(audio: Blob): Promise<string>;
  /** The note's words: into the composer, or sent. */
  deliver(text: string): void;
  /** A microphone failure, in words. */
  microphoneError(error: unknown): string;
  now(): number;
  setInterval(callback: () => void, ms: number): () => void;
};

export class VoiceNoteController {
  state: VoiceNoteState = { status: "idle" };
  now = 0;
  readonly #host: { requestUpdate(): void };
  readonly #deps: VoiceNoteDeps;
  #recorder: VoiceNoteRecorder | undefined;
  #stopTicking: (() => void) | undefined;
  /** Bumped by every start and cancel: a late answer for an abandoned note is dropped. */
  #attempt = 0;

  constructor(host: { requestUpdate(): void }, deps: VoiceNoteDeps) {
    this.#host = host;
    this.#deps = deps;
    this.now = deps.now();
  }

  get busy(): boolean {
    return this.state.status === "starting" || this.state.status === "recording" || this.state.status === "transcribing";
  }

  #set(state: VoiceNoteState): void {
    this.state = state;
    if (state.status === "recording") {
      this.now = this.#deps.now();
      this.#stopTicking ??= this.#deps.setInterval(() => { this.now = this.#deps.now(); this.#host.requestUpdate(); }, 500);
    } else {
      this.#stopTicking?.();
      this.#stopTicking = undefined;
    }
    this.#host.requestUpdate();
  }

  async start(): Promise<void> {
    if (this.busy) return;
    const attempt = ++this.#attempt;
    this.#set({ status: "starting" });
    try {
      const recorder = await this.#deps.start({ onLimit: () => void this.stop() });
      if (attempt !== this.#attempt) {
        recorder.cancel();
        return;
      }
      this.#recorder = recorder;
      this.#set({ status: "recording", startedAt: this.#deps.now() });
    } catch (error) {
      if (attempt === this.#attempt) this.#set({ status: "error", message: this.#deps.microphoneError(error) });
    }
  }

  async stop(): Promise<void> {
    const recorder = this.#recorder;
    if (!recorder || this.state.status !== "recording") return;
    this.#recorder = undefined;
    const attempt = this.#attempt;
    this.#set({ status: "transcribing" });
    try {
      const text = (await this.#deps.transcribe(await recorder.stop())).trim();
      if (attempt !== this.#attempt) return;
      if (!text) {
        this.#set({ status: "error", message: "VoiceStudio heard no words in that note." });
        return;
      }
      this.#set({ status: "idle" });
      this.#deps.deliver(text);
    } catch (error) {
      if (attempt === this.#attempt) this.#set({ status: "error", message: error instanceof Error && error.message ? error.message : "The note could not be transcribed." });
    }
  }

  /** Throws the note away and frees the microphone. */
  cancel(): void {
    this.#attempt += 1;
    this.#recorder?.cancel();
    this.#recorder = undefined;
    this.#set({ status: "idle" });
  }

  dismiss(): void {
    if (this.state.status === "error") this.#set({ status: "idle" });
  }

  dispose(): void {
    this.#attempt += 1;
    this.#recorder?.cancel();
    this.#recorder = undefined;
    this.#stopTicking?.();
    this.#stopTicking = undefined;
  }
}
