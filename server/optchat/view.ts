/**
 * OptChat's view (spec section 5): tree nodes ("parts") tiling the whole chat,
 * oldest first, kept under a byte budget. It only ever appends at its end and
 * coarsens: each new message appends its level-0 part, then `fit()` merges the
 * most due adjacent pair whose parent is built until the view fits. It never
 * splits a part, and passes over pairs whose parent is not built yet, so a line
 * at level l changes about once every 2^l messages and the start of the view
 * stays the same from one call to the next: that is what makes it cacheable.
 */
import { bytes, flatten } from "./text.ts";
import { endOf, label, PLACEHOLDER, startOf, type Part, type Tree } from "./tree.ts";

/** What the view folds: how many messages exist and the nodes built so far. */
export type ViewSource = { readonly length: number; readonly tree: Tree };

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
  readonly #source: ViewSource;
  readonly #budget: number;
  readonly #changed: () => void;
  #parts: Part[] = [];
  #size = 0;
  #waiters = new Set<Waiter>();

  constructor(source: ViewSource, budget: number, changed: () => void = () => {}) {
    this.#source = source;
    this.#budget = budget;
    this.#changed = changed;
  }

  /** Bytes of the parts' texts; an unbuilt part counts its placeholder. */
  get size(): number { return this.#size; }
  get length(): number { return this.#parts.length; }
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

  /** The first message whose part is not built (spec 4.1 `first`); the message count when every part is. */
  first(): number {
    for (const part of this.#parts) if (!this.#built(part)) return startOf(part);
    return this.#source.length;
  }

  /** Every part covering messages before `before` is a built summary (messages not logged yet have no part). */
  settled(before: number): boolean {
    return this.first() >= Math.min(before, this.#source.length);
  }

  /** Resolves true once `settled(before)`, or false if `signal` aborts first (spec section 6). */
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

  /** A new message: its level-0 part goes at the end, then the view fits again. */
  append(i: number): void {
    const part: Part = [0, i];
    this.#parts.push(part);
    this.#size += this.#bytes(part);
    this.fit();
  }

  /** A node was built. A level-0 node was in the view as its placeholder; a parent enters only by a merge. */
  built(l: number, i: number): void {
    if (l === 0) this.#size += (this.#source.tree.size(0, i) ?? PLACEHOLDER_BYTES) - PLACEHOLDER_BYTES;
    this.fit();
  }

  /**
   * While over budget, merge the most due adjacent pair whose parent is built: due = (T - start) / 2^(l+2), OptMem's
   * age rule, so detail fades with age while each level keeps about as many lines. Ties go to the oldest pair. With no
   * pair mergeable, the view stays over budget until a parent is built.
   */
  fit(): void {
    const count = this.#source.length;
    while (this.#size > this.#budget) {
      let best = -1;
      let bestDue = Number.NEGATIVE_INFINITY;
      for (let k = 0; k + 1 < this.#parts.length; k++) {
        const [l, i] = this.#parts[k]!;
        const [nextL, nextI] = this.#parts[k + 1]!;
        if (l !== nextL || i % 2 !== 0 || nextI !== i + 1 || !this.#source.tree.has(l + 1, i / 2)) continue;
        const due = (count - i * 2 ** l) / 2 ** (l + 2);
        if (due > bestDue) { bestDue = due; best = k; }
      }
      if (best === -1) break;
      const [l, i] = this.#parts[best]!;
      const parent: Part = [l + 1, i / 2];
      this.#size += this.#bytes(parent) - this.#bytes(this.#parts[best]!) - this.#bytes(this.#parts[best + 1]!);
      this.#parts.splice(best, 2, parent);
    }
    for (const waiter of [...this.#waiters]) if (this.settled(waiter.before)) waiter.done(true);
  }

  /** The compactor's context (spec 4.2): the texts of the parts before `end`, bare, with no ids. */
  context(end: number): string[] {
    const lines: string[] = [];
    for (const part of this.#parts) {
      if (startOf(part) >= end) break;
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
