/**
 * "Read aloud" for a bot's messages (HUI-18): one message at a time, spoken
 * chunk by chunk through the speech queue (the first sentence starts while the
 * rest is synthesized), with the bot's voice. Reading another message, a voice
 * preview or a call stops it. Pure apart from the injected synthesis and
 * playback.
 */
import { SpeechQueue } from "./voice-queue.ts";
import { speechChunks } from "./voice-speech.ts";

export type ReadAloudState = {
  /** The message being read; empty when nothing is. */
  id: string;
  /** Waiting for the first clip, or speaking. */
  status: "idle" | "loading" | "playing";
  /** Why the last reading stopped short. */
  error?: string;
};

export type ReadAloudOptions = {
  synthesize(text: string, signal: AbortSignal): Promise<Blob>;
  play(audio: Blob, signal: AbortSignal): Promise<void>;
  onChange(state: ReadAloudState): void;
};

export class ReadAloud {
  readonly #options: ReadAloudOptions;
  readonly #queue: SpeechQueue;
  #state: ReadAloudState = { id: "", status: "idle" };
  #played = false;
  #failures = 0;
  #chunks = 0;
  #lastError = "";

  constructor(options: ReadAloudOptions) {
    this.#options = options;
    this.#queue = new SpeechQueue({
      synthesize: options.synthesize,
      play: (audio, signal) => {
        this.#played = true;
        this.#set({ id: this.#state.id, status: "playing" });
        return options.play(audio, signal);
      },
      onState: (queue) => {
        if (!queue.speaking && this.#state.status !== "idle") {
          const error = this.#failures ? (this.#failures === this.#chunks ? this.#lastError : "Part of the message could not be read aloud.") : undefined;
          this.#set({ id: "", status: "idle", ...(error ? { error } : {}) });
        }
      },
      onError: (error) => {
        this.#failures += 1;
        this.#lastError = error instanceof Error && error.message ? error.message : "The message could not be read aloud.";
      },
    });
  }

  get state(): ReadAloudState {
    return this.#state;
  }

  /** Reads `markdown` as the message `id`, stopping whatever was being read. */
  read(id: string, markdown: string): void {
    this.stop();
    const chunks = speechChunks(markdown);
    if (!chunks.length) {
      this.#set({ id: "", status: "idle", error: "There is nothing to read aloud in that message." });
      return;
    }
    this.#played = false;
    this.#failures = 0;
    this.#chunks = chunks.length;
    this.#set({ id, status: "loading" });
    for (const chunk of chunks) this.#queue.enqueue(chunk);
  }

  stop(): void {
    if (this.#state.status === "idle" && !this.#queue.busy) return;
    // The queue reports itself idle; the reading ends without an error.
    this.#failures = 0;
    this.#set({ id: "", status: "idle" });
    this.#queue.stop();
  }

  /** Whether any of the reading reached the speaker (for tests and status text). */
  get played(): boolean {
    return this.#played;
  }

  #set(state: ReadAloudState): void {
    if (state.id === this.#state.id && state.status === this.#state.status && state.error === this.#state.error) return;
    this.#state = state;
    this.#options.onChange(state);
  }
}
