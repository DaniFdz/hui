/**
 * OptChat's summary tree (spec section 3). Node (l, i) covers messages
 * [i·2^l, (i+1)·2^l): level 0 summarizes one message, level l > 0 merges its two
 * children (l-1, 2i) and (l-1, 2i+1). The tree is purely binary. A node is named
 * `id+n` after its first message and how many it covers, so the agent reads
 * `2184+8` in its view and calls zoom(2184, 8) directly.
 */
import { bytes } from "./text.ts";

/** One node of the tree as [level, index]; a view is a list of them. */
export type Part = readonly [l: number, i: number];

/** How an unsummarized message shows; no request ever carries it (spec section 6). */
export const PLACEHOLDER = "(not summarized yet: zoom it)";

export const span = (l: number): number => 2 ** l;
export const startOf = ([l, i]: Part): number => i * span(l);
export const endOf = ([l, i]: Part): number => (i + 1) * span(l);
/** `id+n`: real message ids, not tree coordinates. */
export const label = (part: Part): string => `${startOf(part)}+${span(part[0])}`;

/** The node `id+n` names, when n is a power of two and id a multiple of it. */
export function partAt(id: number, n: number): Part | undefined {
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(n) || id < 0 || n < 1) return undefined;
  const l = Math.log2(n);
  return Number.isInteger(l) && id % n === 0 ? [l, id / n] : undefined;
}

/** A short message is its own level-0 node, verbatim, with no model call. */
export function freeLeaf(kind: string, text: string, node: number): string | undefined {
  const line = `${kind}: ${text}`;
  return bytes(line) <= node ? line : undefined;
}

/** Two children that fit together are their parent, verbatim, with no model call. */
export function freeMerge(first: string, second: string, node: number): string | undefined {
  const line = `${first}\n${second}`;
  return bytes(line) <= node ? line : undefined;
}

/** Every complete node over `count` messages: what a fully built tree holds. */
export function nodeCount(count: number): number {
  let total = 0;
  for (let l = 0; span(l) <= count; l++) total += Math.floor(count / span(l));
  return total;
}

/** Built nodes; their texts never change once built. */
export class Tree {
  #levels: Map<number, { text: string; size: number }>[] = [];
  #count = 0;

  text(l: number, i: number): string | undefined { return this.#levels[l]?.get(i)?.text; }
  size(l: number, i: number): number | undefined { return this.#levels[l]?.get(i)?.size; }
  has(l: number, i: number): boolean { return this.#levels[l]?.has(i) === true; }
  get count(): number { return this.#count; }
  get depth(): number { return this.#levels.length; }

  /** Adds a node; a node already built keeps its first text (the files are append-only and first wins). */
  set(l: number, i: number, text: string): boolean {
    while (this.#levels.length <= l) this.#levels.push(new Map());
    const level = this.#levels[l]!;
    if (level.has(i)) return false;
    level.set(i, { text, size: bytes(text) });
    this.#count++;
    return true;
  }

  /** The built nodes of one level, by index. */
  level(l: number): [number, string][] {
    const level = this.#levels[l];
    return level ? [...level.entries()].sort((a, b) => a[0] - b[0]).map(([i, node]) => [i, node.text]) : [];
  }
}
