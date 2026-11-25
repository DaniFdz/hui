/**
 * OptChat's compactor (spec section 4): a pump builds tree nodes at most `jobs`
 * at once. A node starts when it is not built or running, its sources exist (the
 * message, or both children built), and every view line before its end is a built
 * summary (rule 3), except that a message starts while fewer than `jobs` earlier
 * ones still wait for theirs (revision 3c190e0). Ready messages and merges take
 * turns, even with one job, so neither backlog prevents the other from advancing.
 * With multiple jobs, a ready kind keeps a slot while the other kind is running.
 * Messages start in order; merges favor higher levels and are FIFO within each
 * level. A call's context stops at the first line not built: it never sees one.
 * A source that already fits is its own node, with no model call. A failed node
 * retries with exponential backoff up to five minutes, and only its first failure
 * is reported. A call's context is the compaction
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
/** What a memory's compactor spent in total: the calls it made, their tokens, and their cost in dollars. */
export type OptChatUsage = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
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
  /** The chat view: a merge starts once every line of it before the merge's end is built, a message once fewer than
   * `jobs` lines before it are not. */
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
const MAX_RETRY_MS = 5 * 60 * 1_000;

export class Compactor {
  readonly #host: CompactorHost;
  readonly #summarize: Summarize;
  readonly #options: CompactorOptions;
  readonly #abort = new AbortController();
  /** Nodes actively building; cooling nodes have timers but do not occupy a job. */
  #busy = new Set<string>();
  #failures = new Map<string, Failing>();
  #attempts = new Map<string, number>();
  #retries = new Map<string, unknown>();
  /** Retries whose timer fired; these take precedence over fresh paid nodes of their kind. */
  #due = new Set<string>();
  /** The first unbuilt leaf, or a merge scan cursor, rewound on a retry or when a child is built. */
  #frontier: number[] = [];
  /** Earliest paid merge skipped while its kind's cooling limit was full. */
  #blockedFrontier: number[] = [];
  /** Highest built or started index per merge level, a conservative bound on possible parents. */
  #lastSeen: number[] = [];
  /** The preferred kind of the next node, retained between pumps. */
  #next: "leaf" | "merge" = "leaf";
  /** A due leaf retry keeps priority even if every job is still running. */
  #retryLeaf = false;
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
  pump(): void { this.#pump(false); }

  #pump(retryLeaf: boolean): void {
    this.#retryLeaf ||= retryLeaf;
    if (this.#closed || this.#busy.size >= this.#options.jobs) return;
    const count = this.#host.length;
    const first = this.#host.view.first();
    const ready = { leaf: this.#ready(true, count, first), merge: this.#ready(false, count, first) };
    while (this.#busy.size < this.#options.jobs) {
      let kind = this.#retryLeaf ? "leaf" : this.#next;
      // With more than one job, do not let one kind occupy every slot while the other can run. If it cannot, the
      // fallback below still fills the slot. A due leaf retry keeps its original priority over merges.
      if (!this.#retryLeaf && this.#options.jobs > 1 && this.#busy.size === this.#options.jobs - 1) {
        let leaf = false;
        let merge = false;
        for (const id of this.#busy) {
          if (id.startsWith("0:")) leaf = true;
          else merge = true;
        }
        if (!leaf) kind = "leaf";
        else if (!merge) kind = "merge";
      }
      let node = ready[kind].next();
      if (node.done) {
        kind = kind === "leaf" ? "merge" : "leaf";
        node = ready[kind].next();
      }
      if (node.done) return;
      if (kind === "leaf") this.#retryLeaf = false;
      this.#next = kind === "leaf" ? "merge" : "leaf";
      this.#start(...node.value);
    }
  }

  /** The last built or started node at a merge level; starts overestimate what can be ready but never miss it. */
  #last(l: number): number {
    return this.#lastSeen[l] ??= this.#host.tree.level(l).at(-1)?.[0] ?? -1;
  }

  /** Leaves are FIFO; among merges, scan higher levels first, FIFO within each level. */
  *#ready(leaves: boolean, count: number, first: number): Generator<readonly [number, number], void> {
    const { tree } = this.#host;
    // A failed provider must not sweep a whole backlog with paid attempts while its previous failures cool down.
    // Keep separate limits so a failing merge cannot stop a leaf needed by a turn, or vice versa.
    const cooling = [...this.#retries.keys()].filter((id) => id.startsWith("0:") === leaves).length;
    const paidBlocked = cooling >= this.#options.jobs;
    let start = this.#frontier[0] ?? 0;
    while (tree.has(0, start)) start++;
    this.#frontier[0] = start;
    for (const id of this.#due) {
      const [l, i] = id.split(":").map(Number) as [number, number];
      if ((l === 0) !== leaves || this.#busy.has(id)) continue;
      if (tree.has(l, i)) { this.#due.delete(id); continue; }
      if (l === 0) {
        let waiting = 0;
        for (let j = start; j < i && waiting < this.#options.jobs; j++) if (!tree.has(0, j)) waiting++;
        if (i >= count || waiting >= this.#options.jobs) continue;
      } else if ((i + 1) * span(l) > first || !tree.has(l - 1, 2 * i) || !tree.has(l - 1, 2 * i + 1)) continue;
      yield [l, i];
    }
    if (leaves) {
      for (let i = start, waiting = 0; i < count && waiting < this.#options.jobs; i++) {
        if (tree.has(0, i)) continue;
        waiting++;
        const id = key(0, i);
        if (this.#busy.has(id) || this.#retries.has(id)) continue;
        if (!paidBlocked || this.#free(0, i) !== undefined) yield [0, i];
      }
      return;
    }
    for (let l = Math.floor(Math.log2(Math.min(count, first))); l >= 1; l--) {
      const lastChild = l === 1 ? count - 1 : this.#last(l - 1);
      for (let i = this.#frontier[l] ?? 0; (i + 1) * span(l) <= first && 2 * i + 1 <= lastChild; i++) {
        // A skipped parent is reconsidered when a child is built or its own retry becomes due.
        this.#frontier[l] = i + 1;
        const id = key(l, i);
        if (tree.has(l, i) || this.#busy.has(id) || this.#retries.has(id)) continue;
        if (!(tree.has(l - 1, 2 * i) && tree.has(l - 1, 2 * i + 1))) continue;
        if (paidBlocked && this.#free(l, i) === undefined) {
          this.#blockedFrontier[l] = Math.min(this.#blockedFrontier[l] ?? i, i);
          continue;
        }
        yield [l, i];
      }
    }
  }

  #start(l: number, i: number): void {
    const id = key(l, i);
    this.#due.delete(id);
    if (l > 0) this.#lastSeen[l] = Math.max(this.#last(l), i);
    this.#busy.add(id);
    this.#build(l, i, id).then(() => {
      if (this.#closed) return;
      this.#busy.delete(id);
      this.pump();
    }, (error: unknown) => {
      if (this.#closed) return;
      this.#busy.delete(id);
      if (!this.#failures.has(id)) {
        this.#failures.set(id, { node: label([l, i]), error: message(error), since: this.#options.now().toISOString() });
        this.#host.failed(label([l, i]), error);
      }
      const attempts = (this.#attempts.get(id) ?? 0) + 1;
      this.#attempts.set(id, attempts);
      const delay = Math.min(Math.max(MAX_RETRY_MS, this.#options.retryMs), this.#options.retryMs * 2 ** Math.min(attempts - 1, 30));
      const retry = this.#options.timers.set(() => {
        this.#retries.delete(id);
        this.#due.add(id);
        this.#frontier[l] = Math.min(this.#frontier[l] ?? i, i);
        this.#rewindBlocked();
        this.#pump(l === 0);
      }, delay);
      this.#retries.set(id, retry);
      this.#host.changed();
      this.pump();
    });
  }

  async #build(l: number, i: number, id: string): Promise<void> {
    const text = this.#free(l, i) ?? await this.#compress(l, i);
    if (this.#closed) return;
    // No longer failing by the time anyone sees it built.
    this.#failures.delete(id);
    await this.#host.persist(l, i, text);
    this.#attempts.delete(id);
    const parent = Math.floor(i / 2);
    const frontier = this.#frontier[l + 1];
    if (frontier !== undefined) this.#frontier[l + 1] = Math.min(frontier, parent);
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
    // Read now, in the pump's turn: the built lines before the node, up to the first that still waits for its summary.
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
      if (!this.#closed && typeof reply !== "string" && reply.usage) this.#host.usage(reply.usage);
      const line = text.trim();
      if (!line) throw new Error(`The compactor returned an empty line for ${label([l, i])}.`);
      tries.push(line);
      const size = bytes(line);
      if (size <= node || tries.length >= limit) break;
      messages.push({ role: "assistant", content: text }, { role: "user", content: [sizeFeedback(size, node, cutUtf8(line, node))] });
    }
    return tries.reduce((best, line) => bytes(line) < bytes(best) ? line : best);
  }

  /** Revisit paid merges skipped while a kind's failure limit was full. */
  #rewindBlocked(): void {
    for (let l = 1; l < this.#blockedFrontier.length; l++) {
      const i = this.#blockedFrontier[l];
      if (i !== undefined) this.#frontier[l] = Math.min(this.#frontier[l] ?? i, i);
    }
    this.#blockedFrontier = [];
  }

  /** Aborts running model calls and cancels retries; nothing is built afterwards. */
  close(): void {
    this.#closed = true;
    this.#abort.abort();
    for (const retry of this.#retries.values()) this.#options.timers.clear(retry);
    this.#retries.clear();
    this.#due.clear();
  }
}
