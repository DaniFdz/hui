/**
 * One OptChat memory: the log, the tree, the views and the compactor of one
 * endless chat in one directory. It is the engine's only stateful object and
 * imports nothing from HUI or Pi Durable: the model call is injected, so the
 * same code runs in a gateway, a worker or a test. It keeps two views: the chat
 * view turns read, and the compaction view, the chat view merged further, that
 * compactions read as context. Both are saved in `view.json` whenever they
 * change and loaded at open, then caught up with the messages logged after
 * them; only a missing or invalid file folds them again from message 0.
 */
import { browsePage } from "./html.ts";
import { Compactor, SYSTEM_TIMERS, type Failing, type Limiter, type Summarize, type SummaryUsage, type Timers } from "./compactor.ts";
import { compactPrompt, SCALE_LINE } from "./prompts.ts";
import { Store, type JsonValue, type Kind, type MessageLine } from "./store.ts";
import { bytes, capText, flatten, localDateTime } from "./text.ts";
import { label, nodeCount, partAt, PLACEHOLDER, Tree, type Part } from "./tree.ts";
import { View } from "./view.ts";
import { checkViews, readViews, ViewFile } from "./view-file.ts";

/** The reference implementation's constants (spec section 1). */
export const OPTCHAT_DEFAULTS = {
  /** Target bytes of one summary line. */
  node: 512,
  /** The chat view's high mark, about 62-64k tokens: past it, one batch merges the view down to half. */
  view: 128_000,
  /** The compaction view's high mark: past it, or when the chat view batches, it merges down to half. */
  context: 32_000,
  /** Compactor calls running at once per memory. */
  jobs: 8,
  /** Replies per node to get under `node` bytes. */
  tries: 5,
  /** Wait before retrying a failed node. */
  retryMs: 10_000,
  /** Characters kept of one tool result, head and tail. */
  cap: 30_000,
};

export type OptChatOptions = {
  readonly summarize: Summarize;
  /** The agent's display name, for the compactor prompt. */
  readonly name: string;
  readonly node?: number;
  /** The chat view's high mark in bytes; a batch merges it down to half. */
  readonly view?: number;
  /** The compaction view's high mark in bytes; a batch merges it down to half. */
  readonly context?: number;
  readonly jobs?: number;
  readonly tries?: number;
  readonly retryMs?: number;
  readonly cap?: number;
  /** Shown to the compactor as the size reference; defaults to the 512-byte `SCALE_LINE`. */
  readonly scale?: string;
  /** Shared by every memory of a process to bound model calls overall. */
  readonly limiter?: Limiter;
  readonly now?: () => Date;
  readonly timers?: Timers;
  /** Torn lines skipped at load, views folded again, a failing save of them, and each node's first failure. */
  readonly report?: (problem: string, error?: unknown) => void;
};

export type OptChatUsage = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };

export type OptChatStatus = {
  readonly messages: number;
  /** Tree nodes built, every level. */
  readonly built: number;
  /** Complete nodes not built yet. */
  readonly pending: number;
  readonly viewBytes: number;
  readonly viewLines: number;
  /** A turn waits for the view's summaries ("Summarizing memory…"). */
  readonly waiting?: true;
  readonly failing?: Failing;
  /** Compactor spend since this memory opened. */
  readonly usage: OptChatUsage;
};

const isIndex = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** What `open` read: the log, the tree's nodes, and `view.json` or why it cannot be used. */
type OpenedContents = {
  readonly messages: readonly MessageLine[];
  readonly nodes: readonly { l: number; i: number; text: string }[];
  readonly saved: { readonly value: unknown } | { readonly problem: string };
};

export class OptChatMemory {
  readonly dir: string;
  readonly tree = new Tree();
  readonly #store: Store;
  readonly #log: MessageLine[] = [];
  /** What turns read. */
  readonly #view: View;
  /** What compactions read: the chat view merged further, with the same new lines. */
  readonly #context: View;
  #file: ViewFile | undefined;
  readonly #compactor: Compactor;
  readonly #cap: number;
  readonly #now: () => Date;
  #name: string;
  #listeners = new Set<() => void>();
  /** Appends run one at a time, so ids follow call order. */
  #appending: Promise<unknown> = Promise.resolve();
  #usage: OptChatUsage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  #closed = false;

  private constructor(dir: string, store: Store, contents: OpenedContents, options: OptChatOptions) {
    this.dir = dir;
    this.#store = store;
    this.#cap = options.cap ?? OPTCHAT_DEFAULTS.cap;
    this.#now = options.now ?? (() => new Date());
    this.#name = options.name;
    for (const node of contents.nodes) this.tree.set(node.l, node.i, node.text);
    for (const message of contents.messages) this.#log.push(message);
    const report = options.report ?? (() => {});
    const view = options.view ?? OPTCHAT_DEFAULTS.view;
    const context = options.context ?? OPTCHAT_DEFAULTS.context;
    let edits = 0;
    const edited = () => { edits++; this.#file?.changed(); };
    this.#view = new View(this, { high: view, low: view / 2 }, { changed: () => this.#changed(), edited });
    this.#context = new View(this, { high: context, low: context / 2 }, { edited });
    const saved = "problem" in contents.saved ? contents.saved.problem : checkViews(contents.saved.value, this.#log.length, this.tree);
    if (typeof saved === "string") {
      // Folded from the log, the views differ from the live ones they replace, so the next turn misses the cache once.
      if (this.#log.length) report(`OptChat folded the views of ${dir} again from message 0: ${saved}`);
      for (const message of this.#log) this.#view.append(message.i);
      this.#context.restore({ parts: this.#view.parts(), batch: true });
    } else {
      const batches = this.#view.batches;
      this.#view.restore(saved.chat);
      this.#context.restore(saved.compaction);
      // A lower high mark than the views were saved under batches the chat view at once: the compaction view follows.
      if (this.#view.batches !== batches) this.#context.fit(true);
      // Messages logged after the last save, appended as they were live.
      for (let i = this.#view.end; i < this.#log.length; i++) this.#appendViews(i);
    }
    this.#file = new ViewFile(dir, () => ({ chat: this.#view.state(), compaction: this.#context.state() }), report);
    if (typeof saved === "string" ? this.#log.length > 0 : edits > 0) this.#file.changed();
    const log = this.#log;
    this.#compactor = new Compactor({
      get length() { return log.length; },
      message: (i) => log[i]!,
      tree: this.tree,
      view: this.#view,
      context: (end) => this.#context.context(end),
      persist: (l, i, text) => this.#persist(l, i, text),
      system: () => compactPrompt(this.#name),
      usage: (usage) => this.#spent(usage),
      failed: (node, error) => report(`OptChat could not summarize ${node} in ${dir}`, error),
      changed: () => this.#changed(),
    }, options.summarize, {
      node: options.node ?? OPTCHAT_DEFAULTS.node,
      jobs: options.jobs ?? OPTCHAT_DEFAULTS.jobs,
      tries: options.tries ?? OPTCHAT_DEFAULTS.tries,
      retryMs: options.retryMs ?? OPTCHAT_DEFAULTS.retryMs,
      scale: options.scale ?? SCALE_LINE,
      ...(options.limiter ? { limiter: options.limiter } : {}),
      timers: options.timers ?? SYSTEM_TIMERS,
      now: this.#now,
    });
    this.#compactor.pump();
  }

  /** Opens (creating) the memory in `dir` and starts summarizing what is not summarized yet. */
  static async open(dir: string, options: OptChatOptions): Promise<OptChatMemory> {
    const { store, messages, nodes } = await Store.open(dir, { now: options.now ?? (() => new Date()), report: (problem) => options.report?.(problem) });
    return new OptChatMemory(dir, store, { messages, nodes, saved: await readViews(dir) }, options);
  }

  get length(): number { return this.#log.length; }
  get name(): string { return this.#name; }

  message(i: number): Readonly<MessageLine> | undefined { return this.#log[i]; }

  /** The compactor's prompt names the agent; a new name applies to the next summaries. */
  rename(name: string): void { this.#name = name; }

  /** Logs one message (one write and an fsync) and returns its id. A tool result keeps `cap` characters, head and tail. */
  append(kind: Kind, text: string, src?: JsonValue): Promise<number> {
    const run = this.#appending.then(async () => {
      if (this.#closed) throw new Error("This OptChat memory is closed.");
      const body = kind === "echo" ? capText(text, this.#cap) : text;
      const line: MessageLine = {
        i: this.#log.length, kind, text: body, size: bytes(`${kind}: ${body}`), date: this.#now().toISOString(),
        ...(src === undefined ? {} : { src }),
      };
      await this.#store.appendMessage(line);
      this.#log.push(line);
      this.#appendViews(line.i);
      this.#compactor.pump();
      this.#changed();
      return line.i;
    });
    this.#appending = run.catch(() => undefined);
    return run;
  }

  /** A message's part goes into both views; the compaction view batches whenever the chat view starts a batch. */
  #appendViews(i: number): void {
    const batches = this.#view.batches;
    this.#view.append(i);
    this.#context.append(i, this.#view.batches !== batches);
  }

  async #persist(l: number, i: number, text: string): Promise<void> {
    await this.#store.appendNode({ l, i, text, size: bytes(text) });
    if (!this.tree.set(l, i, text)) return;
    const batches = this.#view.batches;
    this.#view.built(l, i);
    this.#context.built(l, i, this.#view.batches !== batches);
    this.#changed();
  }

  #spent(usage: SummaryUsage): void {
    const total = this.#usage;
    this.#usage = {
      calls: total.calls + 1, input: total.input + usage.input, output: total.output + usage.output,
      cacheRead: total.cacheRead + usage.cacheRead, cacheWrite: total.cacheWrite + usage.cacheWrite, cost: total.cost + (usage.cost ?? 0),
    };
  }

  /**
   * The zoom tool (spec 7.1): line `id+n` opened into the two lines it was made from, each `id+n|text`; `n = 1` gives
   * message `id` whole as `id+0|kind: text`, newlines kept.
   */
  zoom(id: number, n: number): string {
    const part = partAt(id, n);
    if (!part || id + n > this.#log.length) return `No line ${id}+${n}.`;
    if (n === 1) {
      const { kind, text } = this.#log[id]!;
      return `${id}+0|${kind}: ${text}`;
    }
    const [l, i] = part;
    return ([[l - 1, 2 * i], [l - 1, 2 * i + 1]] as const).map((child) => `${label(child)}|${flatten(this.tree.text(child[0], child[1]) ?? PLACEHOLDER)}`).join("\n");
  }

  /** The date tool: local date and time of message `id`. */
  date(id: number): string {
    const message = isIndex(id) ? this.#log[id] : undefined;
    return message ? localDateTime(new Date(message.date)) : `No message ${id}.`;
  }

  /** The current view, rendered. */
  view(): string { return this.#view.render(); }

  /** A copy of the view's parts; with `before`, the parts tiling the messages before it (a turn's frozen view). */
  parts(before?: number): Part[] { return this.#view.parts(before); }

  /** Renders a frozen list of parts again: node texts never change once built. */
  renderParts(parts: readonly Part[]): string { return this.#view.render(parts); }

  /** The compaction view: its parts, and its size in bytes (an unbuilt part counts its placeholder). */
  compaction(): { readonly parts: Part[]; readonly size: number } {
    return { parts: this.#context.parts(), size: this.#context.size };
  }

  settled(before: number): boolean { return this.#view.settled(before); }

  /** Resolves true when every part covering messages before `before` is built, false if `signal` aborts first. */
  settle(before: number, signal?: AbortSignal): Promise<boolean> { return this.#view.settle(before, signal); }

  status(): OptChatStatus {
    const failing = this.#compactor.failing;
    return {
      messages: this.#log.length,
      built: this.tree.count,
      pending: Math.max(0, nodeCount(this.#log.length) - this.tree.count),
      viewBytes: this.#view.size,
      viewLines: this.#view.length,
      ...(this.#view.waiting > 0 ? { waiting: true as const } : {}),
      ...(failing ? { failing } : {}),
      usage: { ...this.#usage },
    };
  }

  /** Called after every change of the status; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* a listener's failure is its own */ }
    }
  }

  /** The browse page of this memory. */
  html(title = `OptChat memory of ${this.#name}`): string {
    return browsePage({ title, log: this.#log, tree: this.tree, view: this.#view.parts() });
  }

  /** Stops summarizing, releases waiters, then closes the files once pending writes land, the views' last. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#compactor.close();
    this.#view.close();
    this.#listeners.clear();
    await this.#appending;
    await this.#store.close();
    await this.#file?.flush();
  }
}
