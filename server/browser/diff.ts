/**
 * Line diffs between two snapshots of one tab, so a conversation that already
 * read a page can see what an action changed instead of the whole outline.
 *
 * The output keeps the snapshot's own lines, prefixed `+`, `-` or a space, so a
 * line the agent acts on still carries the ref the snapshot bound. The cost is
 * bounded: common lines at both ends are matched for free, a changed middle is
 * matched exactly only while it is small, and the printed result is capped, so
 * a page that changed wholesale is reported as such instead of as thousands of
 * lines.
 */

/** Longest changed middle compared line by line; beyond this it is reported whole. */
const MAX_MATCHED_LINES = 600;
/** Unchanged lines printed on each side of a change. */
const CONTEXT_LINES = 2;
/** Diff lines printed before the rest is summarized. */
export const MAX_DIFF_LINES = 400;

export type SnapshotDiff = {
  /** Changed lines and their context; empty when the change was too large to match. */
  lines: string[];
  added: number;
  removed: number;
  /** Unchanged lines left out of `lines`. */
  unchanged: number;
  /** Changed lines the cap left out. */
  omitted: number;
  /** The change was too large to match line by line; the caller shows the whole snapshot. */
  coarse: boolean;
};

type Block = { kind: "same" | "removed" | "added"; lines: string[] };

/** A snapshot line already starts with `- `, so the marker is separated by a space. */
function prefixed(kind: Block["kind"], line: string): string {
  return `${kind === "removed" ? "-" : kind === "added" ? "+" : " "} ${line}`;
}

/** Exact line matching for a small changed middle, as removed/added/same blocks. */
function matchMiddle(previous: readonly string[], next: readonly string[]): Block[] {
  const rows = previous.length;
  const columns = next.length;
  // lengths[i][j] is the longest common subsequence of previous[i:] and next[j:].
  const lengths = new Uint16Array((rows + 1) * (columns + 1));
  const at = (row: number, column: number): number => lengths[row * (columns + 1) + column] ?? 0;
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i * (columns + 1) + j] = previous[i] === next[j]
        ? at(i + 1, j + 1) + 1
        : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const blocks: Block[] = [];
  const push = (kind: Block["kind"], line: string): void => {
    const last = blocks.at(-1);
    if (last?.kind === kind) last.lines.push(line);
    else blocks.push({ kind, lines: [line] });
  };
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    const left = previous[i] ?? "";
    const right = next[j] ?? "";
    if (left === right) {
      push("same", left);
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      push("removed", left);
      i += 1;
    } else {
      push("added", right);
      j += 1;
    }
  }
  while (i < rows) { push("removed", previous[i] ?? ""); i += 1; }
  while (j < columns) { push("added", next[j] ?? ""); j += 1; }
  return blocks;
}

/** Pure: two renderings of one tab's snapshot into the lines worth reporting. */
export function diffSnapshots(previous: readonly string[], next: readonly string[]): SnapshotDiff {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
  let endPrevious = previous.length;
  let endNext = next.length;
  while (endPrevious > start && endNext > start && previous[endPrevious - 1] === next[endNext - 1]) {
    endPrevious -= 1;
    endNext -= 1;
  }
  const middlePrevious = previous.slice(start, endPrevious);
  const middleNext = next.slice(start, endNext);
  if (middlePrevious.length === 0 && middleNext.length === 0) {
    return { lines: [], added: 0, removed: 0, unchanged: previous.length, omitted: 0, coarse: false };
  }
  // A page that changed wholesale is reported whole, not as an unusable hunk.
  if (middlePrevious.length > MAX_MATCHED_LINES || middleNext.length > MAX_MATCHED_LINES) {
    return {
      lines: [],
      added: middleNext.length,
      removed: middlePrevious.length,
      unchanged: start + (previous.length - endPrevious),
      omitted: 0,
      coarse: true,
    };
  }

  // One operation per line, so context is chosen per line and a long unchanged
  // stretch between two changes is counted rather than listed.
  const operations = matchMiddle(middlePrevious, middleNext).flatMap((block) => block.lines.map((line) => ({ kind: block.kind, line })));
  const keep = new Array<boolean>(operations.length).fill(false);
  operations.forEach((operation, index) => {
    if (operation.kind === "same") return;
    keep[index] = true;
    for (let around = index - 1; around >= 0 && index - around <= CONTEXT_LINES && operations[around]?.kind === "same"; around -= 1) keep[around] = true;
    for (let around = index + 1; around < operations.length && around - index <= CONTEXT_LINES && operations[around]?.kind === "same"; around += 1) keep[around] = true;
  });

  const before = previous.slice(Math.max(0, start - CONTEXT_LINES), start);
  const after = previous.slice(endPrevious, endPrevious + CONTEXT_LINES);
  const printed = [
    ...before.map((line) => ({ kind: "same" as const, line })),
    ...operations.filter((_, index) => keep[index]),
    ...after.map((line) => ({ kind: "same" as const, line })),
  ];

  const lines: string[] = [];
  let added = 0;
  let removed = 0;
  let unchanged = (start - before.length) + (previous.length - endPrevious - after.length);
  let omitted = 0;
  for (const [index, operation] of operations.entries()) {
    if (operation.kind === "same" && !keep[index]) unchanged += 1;
    else if (operation.kind === "added") added += 1;
    else if (operation.kind === "removed") removed += 1;
  }
  for (const operation of printed) {
    if (lines.length >= MAX_DIFF_LINES) {
      omitted += 1;
      continue;
    }
    lines.push(prefixed(operation.kind, operation.line));
  }
  return { lines, added, removed, unchanged, omitted, coarse: false };
}

/** One sentence for the result: what changed, or that nothing did. */
export function describeDiff(diff: SnapshotDiff): string {
  if (diff.added === 0 && diff.removed === 0) return "Nothing changed in the page since the previous snapshot.";
  const counts = `${diff.added} line${diff.added === 1 ? "" : "s"} added, ${diff.removed} removed`;
  return `Page changed since the previous snapshot: ${counts}.${diff.coarse ? " The change was too large to match line by line, so here is the whole snapshot." : ""}`;
}
