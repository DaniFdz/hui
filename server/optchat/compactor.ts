/**
 * OptChat's compactor (spec section 4): a pump builds tree nodes in a strict
 * order, at most `jobs` at once. A node starts when it is not built or running,
 * its sources exist (the message, or both children built), and every view line
 * before its end is a built summary (rule 3). That rule gives OptMem's order for
 * free: messages are compressed one at a time, in order, while merges of finished
 * parts run alongside, and the compactor never sees a line that is not a summary.
 * A source that already fits is its own node, with no model call. A failed node
 * is retried every `retryMs` forever (the next turn waits on it, so no backoff),
 * and only its first failure is reported. A call's context is the compaction
 * view's lines before the node, a short view every call shares the start of, so
 * the calls read one another's prefix from the prompt cache.
 */
import { compressStep, mergeStep, sizeFeedback } from "./prompts.ts";
import type { MessageLine } from "./store.ts";
import { bytes, cutUtf8 } from "./text.ts";
import { freeLeaf, freeMerge, label, span, type Tree } from "./tree.ts";
import type { View } from "./view.ts";

/** A compactor conversation: user turns carry text blocks (context first, for the cache), assistant turns the reply. */
export type SummaryMessage =
  | { readonly role: "user"; readonly content: readonly string[] }
  | { readonly role: "assistant"; readonly content: string };
export type SummaryRequest = { readonly system: string; readonly messages: readonly SummaryMessage[] };
export type SummaryUsage = { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly cost?: number };
export type SummaryReply = string | { readonly text: string; readonly usage?: SummaryUsage };
/** The model call, injected: the engine knows no model or provider. */
export type Summarize = (request: SummaryRequest, signal: AbortSignal) => Promise<SummaryReply>;

/** Bounds model calls across every memory of a process; each memory still runs at most `jobs` nodes. */
export interface Limiter {
  run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T>;
}

export type Timers = { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };
export const SYSTEM_TIMERS: Timers = { set: (callback, ms) => setTimeout(callback, ms), clear: (handle) => clearTimeout(handle as NodeJS.Timeout) };

/** A FIFO semaphore: a call waits for a free slot, and an abort while waiting withdraws it. */
export function createLimiter(slots: number): Limiter {
  let free = slots;
  const waiting: (() => void)[] = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else free++;
  };
  return {
    async run(work, signal) {
      if (free > 0) free--;
      else {
        await new Promise<void>((resolve, reject) => {
          if (signal.aborted) { reject(signal.reason); return; }
          const onAbort = () => {
            waiting.splice(waiting.indexOf(start), 1);
            reject(signal.reason);
          };
          const start = () => { signal.removeEventListener("abort", onAbort); resolve(); };
          signal.addEventListener("abort", onAbort, { once: true });
          waiting.push(start);
        });
      }
      try { return await work(); } finally { release(); }
    },
  };
}

/** What a memory lends its compactor. */
export type CompactorHost = {
  readonly length: number;
  message(i: number): MessageLine;
  readonly tree: Tree;
  /** The chat view: a node starts once every line of it before the node's end is built. */
  readonly view: View;
  /** The compaction view's bare lines before message `end`, up to the first one not built. */
  context(end: number): readonly string[];
  /** Saves a built node (fsync), adds it to the tree, then refits the views. */
  persist(l: number, i: number, text: string): Promise<void>;
  /** The compactor's system prompt, for the agent's current name. */
  system(): string;
  usage(usage: SummaryUsage): void;
  /** The first failure of a node; later failures of the same node are not reported. */
  failed(node: string, error: unknown): void;
  changed(): void;
};

export type CompactorOptions = {
  readonly node: number;
  readonly jobs: number;
  readonly tries: number;
  readonly retryMs: number;
  readonly limiter?: Limiter;
  readonly timers: Timers;
  readonly now: () => Date;
};

export type Failing = { readonly node: string; readonly error: string; readonly since: string };

const key = (l: number, i: number) => `${l}:${i}`;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export class Compactor {
  readonly #host: CompactorHost;
  readonly #summarize: Summarize;
  readonly #options: CompactorOptions;
  readonly #abort = new AbortController();
  /** Nodes running or waiting to retry. */
  #busy = new Set<string>();
  #failures = new Map<string, Failing>();
  #retries = new Set<unknown>();
  /** Per level, the first index that may not be built: everything before it is. */
  #frontier: number[] = [];
  #closed = false;

  constructor(host: CompactorHost, summarize: Summarize, options: CompactorOptions) {
    this.#host = host;
    this.#summarize = summarize;
    this.#options = options;
  }

  get busy(): number { return this.#busy.size; }
  /** The oldest failure still waiting for its retry to succeed. */
  get failing(): Failing | undefined { return this.#failures.values().next().value; }

  /** Starts every node that is ready (spec 4.1), up to `jobs` at once. */
  pump(): void {
    if (this.#closed) return;
    const { tree, view } = this.#host;
    const count = this.#host.length;
    const first = view.first();
    for (let l = 0; span(l) <= count; l++) {
      let start = this.#frontier[l] ?? 0;
      while (tree.has(l, start)) start++;
      this.#frontier[l] = start;
      for (let i = start; (i + 1) * span(l) <= count; i++) {
        if (this.#busy.size >= this.#options.jobs) return;
        // Rule 3; `end` only grows with i, so no later node of this level is ready either.
        if ((l === 0 ? i : (i + 1) * span(l)) > first) break;
        if (tree.has(l, i) || this.#busy.has(key(l, i))) continue;
        if (l > 0 && !(tree.has(l - 1, 2 * i) && tree.has(l - 1, 2 * i + 1))) continue;
        this.#start(l, i);
      }
    }
  }

  #start(l: number, i: number): void {
    const id = key(l, i);
    this.#busy.add(id);
    this.#build(l, i, id).then(() => {
      if (this.#closed) return;
      this.#busy.delete(id);
      this.pump();
    }, (error: unknown) => {
      if (this.#closed) return;
      if (!this.#failures.has(id)) {
        this.#failures.set(id, { node: label([l, i]), error: message(error), since: this.#options.now().toISOString() });
        this.#host.failed(label([l, i]), error);
      }
      const retry = this.#options.timers.set(() => {
        this.#retries.delete(retry);
        this.#busy.delete(id);
        this.pump();
      }, this.#options.retryMs);
      this.#retries.add(retry);
      this.#host.changed();
    });
  }

  async #build(l: number, i: number, id: string): Promise<void> {
    const text = this.#free(l, i) ?? await this.#compress(l, i);
    if (this.#closed) return;
    // No longer failing by the time anyone sees it built.
    this.#failures.delete(id);
    await this.#host.persist(l, i, text);
  }

  #free(l: number, i: number): string | undefined {
    const { node } = this.#options;
    if (l === 0) {
      const { kind, text } = this.#host.message(i);
      return freeLeaf(kind, text, node);
    }
    return freeMerge(this.#host.tree.text(l - 1, 2 * i)!, this.#host.tree.text(l - 1, 2 * i + 1)!, node);
  }

  /**
   * One model conversation per node (spec 4.2-4.3): the compaction view's bare lines before the node's end as context,
   * first, so it caches across calls; then the step, under a ruler as long as the limit. A reply over the limit gets the
   * cut-at-limit feedback in the same conversation, up to `tries` replies, and the shortest one wins.
   */
  async #compress(l: number, i: number): Promise<string> {
    const { node, tries: limit } = this.#options;
    const { tree } = this.#host;
    // Read now, in the pump's turn: rule 3 held for this context when the node started.
    const context = `<chat>\n${this.#host.context(l === 0 ? i : (i + 1) * span(l)).join("\n")}\n</chat>`;
    const step = l === 0
      ? compressStep(node, this.#host.message(i).kind, this.#host.message(i).text)
      : mergeStep(node, tree.text(l - 1, 2 * i)!, tree.text(l - 1, 2 * i + 1)!);
    const messages: SummaryMessage[] = [{ role: "user", content: [context, step] }];
    const tries: string[] = [];
    for (;;) {
      const signal = this.#abort.signal;
      const request = { system: this.#host.system(), messages: [...messages] };
      const reply = await (this.#options.limiter ? this.#options.limiter.run(() => this.#summarize(request, signal), signal) : this.#summarize(request, signal));
      const text = typeof reply === "string" ? reply : reply.text;
      if (typeof reply !== "string" && reply.usage) this.#host.usage(reply.usage);
      const line = text.trim();
      if (!line) throw new Error(`The compactor returned an empty line for ${label([l, i])}.`);
      tries.push(line);
      const size = bytes(line);
      if (size <= node || tries.length >= limit) break;
      messages.push({ role: "assistant", content: text }, { role: "user", content: [sizeFeedback(size, node, cutUtf8(line, node))] });
    }
    return tries.reduce((best, line) => bytes(line) < bytes(best) ? line : best);
  }

  /** Aborts running model calls and cancels retries; nothing is built afterwards. */
  close(): void {
    this.#closed = true;
    this.#abort.abort();
    for (const retry of this.#retries) this.#options.timers.clear(retry);
    this.#retries.clear();
  }
}
