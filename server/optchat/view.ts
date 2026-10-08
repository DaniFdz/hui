/**
 * OptChat's view (docs/optchat.md, "The view"): tree nodes ("parts") tiling the
 * whole chat, oldest first, that a turn reads in place of its history.
 *
 * Between batches the view only appends: a new message adds its level-0 part at
 * the end and leaves every other part as it was, so each turn's view starts with
 * the whole view of the turn before, which a prompt cache reads back. Once it passes
 * its high mark, one batch merges the most due adjacent pair whose parent is
 * built, again and again, until it is down to its low mark: a sawtooth that is
 * rewritten once per batch instead of at every message. Parents not built yet can
 * stop a batch short; it goes on as messages arrive and nodes are built. A part is
 * never split.
 *
 * A pair's urgency is the time since its last message in units of its own span:
 * (T - last) / 2^l for the siblings (l, i) and (l, i + 1) whose last message is
 * `last`, with T messages in the chat. The older a stretch of the chat, the fewer
 * lines it gets, the levels hold similar numbers of lines, and a line rarely
 * changes once it is old. With the length of Taelin's rollback list as the
 * budget, these are exactly the merges his `push` makes.
 */
import { bytes, flatten } from "./text.ts";
import { endOf, label, PLACEHOLDER, startOf, type Part, type Tree } from "./tree.ts";

/** What the view folds: how many messages exist and the nodes built so far. */
export type ViewSource = { readonly length: number; readonly tree: Tree };

/** The sawtooth: past `high` bytes a batch starts, and it merges until the view is down to `low`. */
export type ViewLimits = { readonly high: number; readonly low: number };

/** What a view keeps across restarts: its parts, and whether a batch is still under way. */
export type ViewState = { readonly parts: readonly Part[]; readonly batch: boolean };

export type ViewHooks = {
  /** Something a caller of `settle()` may report changed (a waiter came or went). */
  readonly changed?: () => void;
  /** The parts or the batch state changed: what `state()` returns is new. */
  readonly edited?: () => void;
};

type Waiter = { readonly before: number; done(settled: boolean): void };

const PLACEHOLDER_BYTES = bytes(PLACEHOLDER);

/** The tiling of [0, `before`) a view part contributes: the part itself, or its children when it straddles the bound. */
function tile(part: Part, before: number, out: Part[]): void {
  if (startOf(part) >= before) return;
  // A level-0 part covers one message, so only a merged part can straddle; its children are built because it is.
  if (endOf(part) <= before || part[0] === 0) { out.push(part); return; }
  tile([part[0] - 1, 2 * part[1]], before, out);
  tile([part[0] - 1, 2 * part[1] + 1], before, out);
}

export class View {
  /** The sawtooth's marks, read at every fit; a test may change them between steps. */
  limits: ViewLimits;
  readonly #source: ViewSource;
  readonly #changed: () => void;
  readonly #edited: () => void;
  #parts: Part[] = [];
  #size = 0;
  #batch = false;
  #batches = 0;
  #waiters = new Set<Waiter>();

  constructor(source: ViewSource, limits: ViewLimits, hooks: ViewHooks = {}) {
    this.#source = source;
    this.limits = limits;
    this.#changed = hooks.changed ?? (() => {});
    this.#edited = hooks.edited ?? (() => {});
  }

  /** Bytes of the parts' texts; an unbuilt part counts its placeholder. */
  get size(): number { return this.#size; }
  get length(): number { return this.#parts.length; }
  /** The messages the view covers: the end of its last part. */
  get end(): number {
    const last = this.#parts.at(-1);
    return last ? endOf(last) : 0;
  }
  /** A batch is under way: each append and build merges until the view is down to its low mark. */
  get batching(): boolean { return this.#batch; }
  /** Batches started so far. */
  get batches(): number { return this.#batches; }
  /** Callers waiting in `settle()`. */
  get waiting(): number { return this.#waiters.size; }

  #built([l, i]: Part): boolean { return this.#source.tree.has(l, i); }
  #text([l, i]: Part): string { return this.#source.tree.text(l, i) ?? PLACEHOLDER; }
  #bytes([l, i]: Part): number { return this.#source.tree.size(l, i) ?? PLACEHOLDER_BYTES; }

  /** A copy of the parts; with `before`, only those tiling the messages before it. */
  parts(before?: number): Part[] {
    if (before === undefined) return this.#parts.map(([l, i]) => [l, i] as const);
    const out: Part[] = [];
    for (const part of this.#parts) {
      if (startOf(part) >= before) break;
      tile(part, before, out);
    }
    return out;
  }

  /** The parts and the batch state, for `view.json`. */
  state(): ViewState { return { parts: this.parts(), batch: this.#batch }; }

  /**
   * Takes over a saved state, or another view's parts. The caller has checked that they tile the first messages
   * without a gap and that every merged part is built. A batch the state left under way goes on at once, and so does
   * one a lower mark calls for.
   */
  restore(state: ViewState): void {
    this.#parts = state.parts.map(([l, i]) => [l, i] as const);
    this.#size = this.#parts.reduce((total, part) => total + this.#bytes(part), 0);
    this.#batch = state.batch;
    this.fit();
  }

  /** The first message whose part is not built; the message count when every part is. */
  first(): number {
    for (const part of this.#parts) if (!this.#built(part)) return startOf(part);
    return this.#source.length;
  }

  /** Every part covering messages before `before` is a built summary (messages not logged yet have no part). */
  settled(before: number): boolean {
    return this.first() >= Math.min(before, this.#source.length);
  }

  /** Resolves true once `settled(before)`, or false if `signal` aborts first. */
  settle(before: number, signal?: AbortSignal): Promise<boolean> {
    if (this.settled(before)) return Promise.resolve(true);
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const onAbort = () => waiter.done(false);
      const waiter: Waiter = {
        before,
        done: (settled) => {
          if (!this.#waiters.delete(waiter)) return;
          signal?.removeEventListener("abort", onAbort);
          resolve(settled);
          this.#changed();
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.add(waiter);
      this.#changed();
    });
  }

  /**
   * A new message: its level-0 part goes at the end and, between batches, nothing else changes. `batch` starts a batch
   * even under the high mark (the compaction view merges whenever the chat view does).
   */
  append(i: number, batch = false): void {
    const part: Part = [0, i];
    this.#parts.push(part);
    this.#size += this.#bytes(part);
    this.#edited();
    this.fit(batch);
  }

  /** A node was built: a level-0 node replaces its placeholder, and a batch may now merge a pair it could not. */
  built(l: number, i: number, batch = false): void {
    if (l === 0 && this.#holds(i)) this.#size += (this.#source.tree.size(0, i) ?? PLACEHOLDER_BYTES) - PLACEHOLDER_BYTES;
    this.fit(batch);
  }

  /** Message `i` is in the view as its own level-0 part. */
  #holds(i: number): boolean {
    let low = 0;
    let high = this.#parts.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (endOf(this.#parts[middle]!) <= i) low = middle + 1;
      else high = middle;
    }
    const part = this.#parts[low];
    return part !== undefined && part[0] === 0 && part[1] === i;
  }

  /**
   * The sawtooth. A batch starts once the view passes its high mark (or, with `batch`, its low mark), then merges the
   * most due pair whose parent is built until the view is down to its low mark. Pairs whose parent is not built wait:
   * a batch they stop short stays under way and goes on at the next append or build.
   */
  fit(batch = false): void {
    const { high, low } = this.limits;
    if (!this.#batch && (this.#size > high || (batch && this.#size > low))) {
      this.#batch = true;
      this.#batches++;
      this.#edited();
    }
    if (this.#batch) {
      while (this.#size > low && this.#merge()) { /* the most due pair, one at a time */ }
      if (this.#size <= low) {
        this.#batch = false;
        this.#edited();
      }
    }
    for (const waiter of [...this.#waiters]) if (this.settled(waiter.before)) waiter.done(true);
  }

  /**
   * Merges the most due adjacent pair whose parent is built, the oldest of equals; false when no pair can merge. The
   * siblings (l, i) and (l, i + 1) end at message (i + 2)·2^l - 1, so (T - last) / 2^l = (T + 1) / 2^l - i - 2: the
   * same order as (T + 1) / 2^l - i, which is exact in floating point.
   */
  #merge(): boolean {
    const count = this.end;
    let best = -1;
    let bestDue = Number.NEGATIVE_INFINITY;
    for (let k = 0; k + 1 < this.#parts.length; k++) {
      const [l, i] = this.#parts[k]!;
      const [nextL, nextI] = this.#parts[k + 1]!;
      if (l !== nextL || i % 2 !== 0 || nextI !== i + 1 || !this.#source.tree.has(l + 1, i / 2)) continue;
      const due = (count + 1) / 2 ** l - i;
      if (due > bestDue) { bestDue = due; best = k; }
    }
    if (best === -1) return false;
    const [l, i] = this.#parts[best]!;
    const parent: Part = [l + 1, i / 2];
    this.#size += this.#bytes(parent) - this.#bytes(this.#parts[best]!) - this.#bytes(this.#parts[best + 1]!);
    this.#parts.splice(best, 2, parent);
    this.#edited();
    return true;
  }

  /**
   * A compaction's context: the texts of the parts before `end`, bare, with no ids, stopping at the first part not
   * built, so a compaction never reads a placeholder or what follows one.
   */
  context(end: number): string[] {
    const lines: string[] = [];
    for (const part of this.#parts) {
      if (startOf(part) >= end || !this.#built(part)) break;
      lines.push(flatten(this.#text(part)));
    }
    return lines;
  }

  /** `<chat>`, one `id+n|text` line per part, `</chat>`. Node texts never change, so a frozen list renders the same. */
  render(parts: readonly Part[] = this.#parts): string {
    return `<chat>\n${parts.map((part) => `${label(part)}|${flatten(this.#text(part))}`).join("\n")}\n</chat>`;
  }

  /** Releases every waiter: nothing will be summarized any more. */
  close(): void {
    for (const waiter of [...this.#waiters]) waiter.done(false);
  }
}
