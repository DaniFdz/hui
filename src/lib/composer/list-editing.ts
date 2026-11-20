/**
 * The composer's list-edit and wrap rules: the pure text edits behind Tab/Shift+Tab, Enter on an empty list item and
 * the inline/fence wrap shortcuts. The textarea stays the editor, so every rule returns the draft it would produce and
 * the selection to put back, and returns `undefined` when it would change nothing — the caller then leaves the key to
 * the browser, so Tab still moves focus out of a draft that holds no list.
 */

export type TextSelection = { text: string; start: number; end: number };
export type WrapMarker = "**" | "*" | "`";

/** One list level. Three spaces keep a nested list distinct without reaching a code block's four. */
export const LIST_INDENT = "   ";
/** Three levels: a list line may carry up to nine spaces of indent. */
export const MAX_LIST_INDENT = LIST_INDENT.length * 3;

const LIST_ITEM_LINE_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)/u;
const EMPTY_LIST_ITEM_LINE_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)$/u;

function lineStart(text: string, position: number): number {
  return text.lastIndexOf("\n", position - 1) + 1;
}

function lineEnd(text: string, position: number): number {
  const next = text.indexOf("\n", position);
  return next < 0 ? text.length : next;
}

/** The first and last line the selection touches: a selection that ends at the next line's start does not reach it. */
function touchedLines(text: string, start: number, end: number): { first: number; last: number } {
  const anchor = Math.min(start, end);
  const focus = Math.max(start, end);
  return { first: lineStart(text, anchor), last: lineStart(text, focus > anchor ? focus - 1 : anchor) };
}

/** Every line start the selection touches, in document order. */
function lineStarts(text: string, start: number, end: number): number[] {
  const { first, last } = touchedLines(text, start, end);
  const starts: number[] = [];
  for (let at = first; at <= last; at = lineEnd(text, at) + 1) starts.push(at);
  return starts;
}

/** A line's indent width, where a tab stands for one level so a mixed draft still counts its depth. */
function indentWidth(indent: string): number {
  let width = 0;
  for (const character of indent) width += character === "\t" ? LIST_INDENT.length : 1;
  return width;
}

/** Adds one list level to every selected list line, up to three levels. */
export function indentListSelection(text: string, start: number, end: number): TextSelection | undefined {
  const inserts = lineStarts(text, start, end).filter((at) => {
    const line = text.slice(at, lineEnd(text, at));
    const match = LIST_ITEM_LINE_RE.exec(line);
    return match !== null && indentWidth(match[1] ?? "") + LIST_INDENT.length <= MAX_LIST_INDENT;
  });
  if (!inserts.length) return undefined;
  let changed = "";
  let cursor = 0;
  for (const at of inserts) {
    changed += text.slice(cursor, at) + LIST_INDENT;
    cursor = at;
  }
  changed += text.slice(cursor);
  // A caret at a line start ends after that line's new indent, where its text now begins.
  const map = (position: number) => position + inserts.filter((at) => at <= position).length * LIST_INDENT.length;
  return { text: changed, start: map(start), end: map(end) };
}

/** Removes one list level from every selected list line: one tab, or up to three spaces. */
export function outdentListSelection(text: string, start: number, end: number): TextSelection | undefined {
  const removals = lineStarts(text, start, end).flatMap((at) => {
    const line = text.slice(at, lineEnd(text, at));
    const match = LIST_ITEM_LINE_RE.exec(line);
    if (!match) return [];
    const indent = match[1] ?? "";
    if (!indent) return [];
    return [{ at, length: indent.startsWith("\t") ? 1 : Math.min(LIST_INDENT.length, indent.length) }];
  });
  if (!removals.length) return undefined;
  let changed = "";
  let cursor = 0;
  for (const removal of removals) {
    changed += text.slice(cursor, removal.at);
    cursor = removal.at + removal.length;
  }
  changed += text.slice(cursor);
  // Only the indent before a position moves it, so a caret inside the removed spaces lands where the marker now starts.
  const map = (position: number) => position - removals.reduce((total, removal) => total + Math.min(removal.length, Math.max(0, position - removal.at)), 0);
  return { text: changed, start: map(start), end: map(end) };
}

/** Enter on an empty list item ends the list: the marker goes, the line stays empty and no newline is added. */
export function endEmptyListItem(text: string, caret: number): { text: string; caret: number } | undefined {
  const from = lineStart(text, caret);
  const to = lineEnd(text, caret);
  if (!EMPTY_LIST_ITEM_LINE_RE.test(text.slice(from, to))) return undefined;
  return { text: text.slice(0, from) + text.slice(to), caret: from };
}

/** Wraps the selection in an inline marker, or unwraps the run it already sits in. */
export function toggleWrap(text: string, start: number, end: number, marker: WrapMarker): TextSelection {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const selected = text.slice(start, end);
  if (start !== end) {
    if (before.endsWith(marker) && after.startsWith(marker)) {
      const remaining = marker.length;
      return { text: before.slice(0, -remaining) + selected + after.slice(remaining), start: start - remaining, end: end - remaining };
    }
    if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
      return { text: before + selected.slice(marker.length, -marker.length) + after, start, end: end - marker.length * 2 };
    }
    return { text: `${before}${marker}${selected}${marker}${after}`, start: start + marker.length, end: end + marker.length };
  }
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return { text: before.slice(0, -marker.length) + after.slice(marker.length), start: start - marker.length, end: start - marker.length };
  }
  const open = before.lastIndexOf(marker);
  const close = after.indexOf(marker);
  if (open >= 0 && close >= 0) {
    const closeAt = start + close;
    return {
      text: text.slice(0, open) + text.slice(open + marker.length, closeAt) + text.slice(closeAt + marker.length),
      start: start - marker.length,
      end: start - marker.length,
    };
  }
  return { text: `${before}${marker}${marker}${after}`, start: start + marker.length, end: start + marker.length };
}

/** Wraps a selection in a fenced block, or opens an empty one with the caret on its middle line. */
export function wrapFenceSelection(text: string, start: number, end: number): TextSelection {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  // A fence only opens at the start of a line, so the block takes the break it needs rather than mangling the draft.
  const lead = before && !before.endsWith("\n") ? "\n" : "";
  const trail = after && !after.startsWith("\n") ? "\n" : "";
  // An empty selection opens a block with an empty middle line for the caret; a selection keeps its text there.
  const body = !selected ? "\n" : selected.endsWith("\n") ? selected : `${selected}\n`;
  const fenced = `\`\`\`\n${body}\`\`\``;
  const caret = start + lead.length + 4;
  return { text: before + lead + fenced + trail + after, start: caret, end: caret + selected.length };
}
