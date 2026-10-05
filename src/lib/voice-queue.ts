/**
 * The speech queue of read-aloud and calls (HUI-18): chunks are synthesized a
 * little ahead of the one playing and always played in the order they were
 * queued, whatever order their audio arrives in. `stop` aborts what is being
 * synthesized and played and empties it. Pure: synthesis and playback are
 * injected (`POST /__hui/voice/speech` and an audio element in the browser).
 */

export type SpeechQueueState = {
  /** A chunk is playing or waiting to. */
  speaking: boolean;
  /** The chunk playing now. */
  text?: string;
  /** Chunks queued after it. */
  pending: number;
};

export type SpeechQueueOptions = {
  synthesize(text: string, signal: AbortSignal): Promise<Blob>;
  /** Resolves when the clip has played; on abort it stops and settles. */
  play(audio: Blob, signal: AbortSignal): Promise<void>;
  /** Chunks synthesized ahead of the one playing. */
  prefetch?: number;
  onState?(state: SpeechQueueState): void;
  /** A chunk that could not be synthesized or played; the queue goes on with the next. */
  onError?(error: unknown, text: string): void;
};

type Item = { text: string; controller: AbortController; audio?: Promise<Blob> };

export class SpeechQueue {
  readonly #options: SpeechQueueOptions;
  #items: Item[] = [];
  #current: Item | undefined;
  #idle: (() => void)[] = [];

  constructor(options: SpeechQueueOptions) {
    this.#options = options;
  }

  get state(): SpeechQueueState {
    return { speaking: this.busy, ...(this.#current ? { text: this.#current.text } : {}), pending: this.#items.length };
  }

  get busy(): boolean {
    return Boolean(this.#current) || this.#items.length > 0;
  }

  enqueue(text: string): void {
    if (!text.trim()) return;
    this.#items.push({ text, controller: new AbortController() });
    this.#prefetch();
    if (!this.#current) void this.#next();
    else this.#emit();
  }

  /** Aborts synthesis and playback, empties the queue. */
  stop(): void {
    const items = [...(this.#current ? [this.#current] : []), ...this.#items];
    this.#items = [];
    this.#current = undefined;
    for (const item of items) item.controller.abort();
    this.#emit();
    this.#settle();
  }

  /** Resolves once everything queued so far has played or the queue was stopped. */
  idle(): Promise<void> {
    return this.busy ? new Promise((resolve) => this.#idle.push(resolve)) : Promise.resolve();
  }

  #synthesis(item: Item): Promise<Blob> {
    if (!item.audio) {
      item.audio = this.#options.synthesize(item.text, item.controller.signal);
      // Awaited when its turn comes; until then a failure must not be unhandled.
      item.audio.catch(() => undefined);
    }
    return item.audio;
  }

  #prefetch(): void {
    for (const item of this.#items.slice(0, Math.max(0, this.#options.prefetch ?? 2))) this.#synthesis(item);
  }

  async #next(): Promise<void> {
    const item = this.#items.shift();
    this.#current = item;
    if (!item) {
      this.#emit();
      this.#settle();
      return;
    }
    this.#prefetch();
    this.#emit();
    try {
      const audio = await this.#synthesis(item);
      if (!item.controller.signal.aborted) await this.#options.play(audio, item.controller.signal);
    } catch (error) {
      if (!item.controller.signal.aborted) this.#options.onError?.(error, item.text);
    }
    // A stop (or a newer queue after it) owns what happens next.
    if (this.#current === item) void this.#next();
  }

  #emit(): void {
    this.#options.onState?.(this.state);
  }

  #settle(): void {
    if (this.busy) return;
    const waiting = this.#idle;
    this.#idle = [];
    for (const resolve of waiting) resolve();
  }
}
