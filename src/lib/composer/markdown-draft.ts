/**
 * The composer's draft Markdown as paint-only lines: the pure, linear formatter behind the mirror that draws under the
 * chat composer's textarea (`composer-mirror.ts`), and the escaped HTML it paints.
 *
 * The textarea stays the only editor, so this never rewrites what the operator typed: every source character — every
 * marker, fence, bullet and backtick — reproduces exactly, in order (`draftPlainText(formatDraft(source)) === source`),
 * and each run only carries the decoration it should be painted with. Fences, code spans, escapes, bullets, ordered
 * items and nesting (`**`/`__`, `*`/`_`, `***`) are recognised; an unmatched delimiter stays literal. A run may cross a
 * source line break, as markdown-it allows, so inline parsing reads each paragraph scope at once and splits the tokens
 * back onto their lines. Above `MAX_FORMATTED_LENGTH` the draft paints as plain text lines, which keeps one keystroke's
 * work bounded without breaking the invariant.
 */
export type DraftInlineKind = "text" | "marker" | "bold" | "italic" | "bold-italic" | "code";
export type DraftInline = { kind: DraftInlineKind; text: string };
export type DraftMarkerKind = "bullet" | "ordered" | "fence";
export type DraftLineKind = "text" | "blank" | "fence-open" | "fence-close" | "code" | "list" | "ordered";

export type DraftLine = {
  kind: DraftLineKind;
  /** The line's leading whitespace, reproduced verbatim. */
  indent: string;
  /** The literal marker this line starts with (a bullet, an ordered number, a fence run) when it has one. */
  marker?: string;
  markerKind?: DraftMarkerKind;
  inlines: readonly DraftInline[];
};

/** Above this many characters a draft paints plain: one keystroke must not pay for an unbounded parse or DOM. */
export const MAX_FORMATTED_LENGTH = 20_000;

const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/u;
const LIST_ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)/u;
const BLANK_RE = /^[ \t]*$/u;
const LEADING_WHITESPACE_RE = /^[ \t]*/u;
const ESCAPABLE_RE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/u;
/** A character that continues a word, which is what makes an underscore part of a name rather than emphasis. */
const WORD_CHAR_RE = /[0-9A-Za-z\u00c0-\uffff]/u;

/** A block pass sees each line whole; only the inline kinds are parsed for emphasis. */
type Block = { kind: DraftLineKind; indent: string; marker?: string; markerKind?: DraftMarkerKind; rest: string };

type Node =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "marker"; text: string }
  | { kind: "delim"; char: "*" | "_"; text: string; open: boolean; close: boolean; bold: boolean; italic: boolean; matched?: "open" | "close" };

/** Whether `text` starts with a run of at least `length` fence characters. */
function fenceRun(text: string): { char: string; length: number } | undefined {
  const char = text.charAt(0);
  if (char !== "`" && char !== "~") return undefined;
  let length = 0;
  while (text.charAt(length) === char) length += 1;
  return { char, length };
}

function closesFence(rest: string, fence: { char: string; length: number }): { markerLength: number } | undefined {
  const line = rest.endsWith("\r") ? rest.slice(0, -1) : rest;
  const run = fenceRun(line);
  if (!run || run.char !== fence.char || run.length < fence.length) return undefined;
  if (!BLANK_RE.test(line.slice(run.length))) return undefined;
  return { markerLength: run.length };
}

function readBlock(line: string, fence: { char: string; length: number } | null): { block: Block; fence: { char: string; length: number } | null } {
  const indent = line.match(LEADING_WHITESPACE_RE)?.[0] ?? "";
  const content = line.slice(indent.length);
  if (fence) {
    const close = closesFence(content, fence);
    if (close) return { block: { kind: "fence-close", indent, marker: content.slice(0, close.markerLength), markerKind: "fence", rest: content.slice(close.markerLength) }, fence: null };
    return { block: { kind: "code", indent, rest: content }, fence };
  }
  const opener = FENCE_RE.exec(content);
  const run = opener ? fenceRun(content) : undefined;
  if (opener && run && run.length >= 3) {
    return {
      block: { kind: "fence-open", indent, marker: content.slice(0, run.length), markerKind: "fence", rest: content.slice(run.length) },
      fence: { char: run.char, length: run.length },
    };
  }
  const list = LIST_ITEM_RE.exec(content);
  if (list) {
    const marker = list[2] ?? "";
    return {
      block: { kind: /^\d/u.test(marker) ? "ordered" : "list", indent, marker, markerKind: /^\d/u.test(marker) ? "ordered" : "bullet", rest: content.slice(marker.length) },
      fence,
    };
  }
  if (BLANK_RE.test(line)) return { block: { kind: "blank", indent, rest: "" }, fence };
  return { block: { kind: "text", indent, rest: content }, fence };
}

function blocksOf(source: string): Block[] {
  const blocks: Block[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of source.split("\n")) {
    const read = readBlock(line, fence);
    blocks.push(read.block);
    fence = read.fence;
  }
  return blocks;
}

const isInlineKind = (kind: DraftLineKind) => kind === "text" || kind === "list" || kind === "ordered";

/** Pushes a run, merging it onto the previous one when it paints the same way: a draft must not become thousands of
 * spans for its words. */
function pushToken(tokens: DraftInline[], kind: DraftInlineKind, text: string): void {
  if (!text) return;
  const last = tokens.at(-1);
  if (last && last.kind === kind) tokens[tokens.length - 1] = { kind, text: last.text + text };
  else tokens.push({ kind, text });
}

/** The next backtick run of exactly `length` at or after `from`, or -1. A failed search is remembered per length so a
 * draft of unmatched runs cannot re-scan its own tail for each one. */
function findBacktickRun(source: string, from: number, length: number, exhausted: Map<number, number>): number {
  const failedFrom = exhausted.get(length);
  if (failedFrom !== undefined && from >= failedFrom) return -1;
  let index = from;
  while (index < source.length) {
    if (source.charAt(index) !== "`") {
      index += 1;
      continue;
    }
    let run = 1;
    while (source.charAt(index + run) === "`") run += 1;
    if (run === length) return index;
    index += run;
  }
  exhausted.set(length, from);
  return -1;
}

/** One left-to-right scan: escapes, code spans (whose content is never parsed) and emphasis delimiter runs. */
function scanInline(source: string): Node[] {
  const nodes: Node[] = [];
  const exhausted = new Map<number, number>();
  let literal = "";
  const flush = () => {
    if (!literal) return;
    nodes.push({ kind: "text", text: literal });
    literal = "";
  };
  let index = 0;
  while (index < source.length) {
    const char = source.charAt(index);
    const next = source.charAt(index + 1);
    if (char === "\\" && ESCAPABLE_RE.test(next)) {
      literal += char + next;
      index += 2;
      continue;
    }
    if (char === "`") {
      let length = 1;
      while (source.charAt(index + length) === "`") length += 1;
      const close = findBacktickRun(source, index + length, length, exhausted);
      if (close < 0) {
        literal += source.slice(index, index + length);
        index += length;
        continue;
      }
      flush();
      const ticks = "`".repeat(length);
      nodes.push({ kind: "marker", text: ticks });
      const content = source.slice(index + length, close);
      if (content) nodes.push({ kind: "code", text: content });
      nodes.push({ kind: "marker", text: ticks });
      index = close + length;
      continue;
    }
    if (char === "*" || char === "_") {
      let length = 1;
      while (source.charAt(index + length) === char) length += 1;
      if (length > 3) {
        literal += source.slice(index, index + length);
        index += length;
        continue;
      }
      flush();
      const previous = index > 0 ? source.charAt(index - 1) : "";
      const following = source.charAt(index + length);
      const before = previous === "" || /\s/u.test(previous);
      const after = following === "" || /\s/u.test(following);
      // An underscore between two word characters is a name, not emphasis: `read_text_file` stays plain. A star has no
      // such restriction, so `**bold**_italics_` and `2 * 3` both keep their meaning.
      const intraword = char === "_" && WORD_CHAR_RE.test(previous) && WORD_CHAR_RE.test(following);
      nodes.push({
        kind: "delim",
        char,
        text: source.slice(index, index + length),
        open: !after && !intraword,
        close: !before && !intraword,
        bold: length >= 2,
        italic: length !== 2,
      });
      index += length;
      continue;
    }
    literal += char;
    index += 1;
  }
  flush();
  return nodes;
}

/** Pairs delimiter runs into opening and closing markers, then flattens the result with the style each run sits in. */
function resolveEmphasis(nodes: Node[]): DraftInline[] {
  const stack: number[] = [];
  for (const [index, node] of nodes.entries()) {
    if (node.kind !== "delim") continue;
    let match = -1;
    if (node.close) {
      for (let cursor = stack.length - 1; cursor >= 0; cursor -= 1) {
        const candidate = nodes[stack[cursor] ?? -1];
        if (candidate?.kind === "delim" && candidate.char === node.char && candidate.text.length === node.text.length) {
          match = cursor;
          break;
        }
      }
    }
    if (match >= 0) {
      const opener = nodes[stack[match] ?? -1];
      if (opener?.kind === "delim") opener.matched = "open";
      node.matched = "close";
      // An unmatched run inside this pair stays literal; nothing can pair across a close.
      stack.length = match;
    } else if (node.open) {
      stack.push(index);
    }
  }

  const tokens: DraftInline[] = [];
  let bold = 0;
  let italic = 0;
  const style = (): DraftInlineKind => bold && italic ? "bold-italic" : bold ? "bold" : italic ? "italic" : "text";
  // Italic letters lean one word at a time so no skewed run swallows the space that lets the line wrap.
  const text = (value: string) => {
    const kind = style();
    if (kind !== "italic" && kind !== "bold-italic") {
      pushToken(tokens, kind, value);
      return;
    }
    for (const piece of value.split(/( +)/u)) {
      if (!piece) continue;
      pushToken(tokens, piece.startsWith(" ") ? "text" : kind, piece);
    }
  };
  for (const node of nodes) {
    if (node.kind === "text" || (node.kind === "delim" && !node.matched)) {
      text(node.text);
      continue;
    }
    if (node.kind === "code") {
      pushToken(tokens, "code", node.text);
      continue;
    }
    if (node.kind !== "delim") {
      pushToken(tokens, "marker", node.text);
      continue;
    }
    if (node.matched === "close") {
      if (node.bold) bold -= 1;
      if (node.italic) italic -= 1;
    }
    pushToken(tokens, "marker", node.text);
    if (node.matched === "open") {
      if (node.bold) bold += 1;
      if (node.italic) italic += 1;
    }
  }
  return tokens;
}

/** One paragraph scope's tokens, split back onto the source lines that produced them. */
function inlineLines(rests: readonly string[]): DraftInline[][] {
  const perLine: DraftInline[][] = rests.map(() => []);
  let line = 0;
  for (const token of resolveEmphasis(scanInline(rests.join("\n")))) {
    for (const [position, piece] of token.text.split("\n").entries()) {
      if (position > 0) line += 1;
      if (line < perLine.length) pushToken(perLine[line] ?? [], token.kind, piece);
    }
  }
  return perLine;
}

function plainLines(source: string): DraftLine[] {
  return source.split("\n").map((line) => ({ kind: line ? "text" as const : "blank" as const, indent: "", inlines: line ? [{ kind: "text" as const, text: line }] : [] }));
}

/** The draft's lines with the runs they should paint with. */
export function formatDraft(source: string): DraftLine[] {
  if (source.length > MAX_FORMATTED_LENGTH) return plainLines(source);
  const blocks = blocksOf(source);
  const lines: (Omit<DraftLine, "inlines"> & { inlines: DraftInline[] })[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (!isInlineKind(block.kind)) {
      lines.push({
        kind: block.kind,
        indent: block.indent,
        ...(block.marker === undefined ? {} : { marker: block.marker }),
        ...(block.markerKind === undefined ? {} : { markerKind: block.markerKind }),
        inlines: block.rest ? [{ kind: block.kind === "code" ? "text" : "marker", text: block.rest }] : [],
      });
      continue;
    }
    // A paragraph scope: consecutive prose and list lines, which emphasis may cross and a blank or code line may not.
    const scope: Block[] = [];
    let cursor = index;
    for (; cursor < blocks.length && isInlineKind(blocks[cursor]!.kind); cursor += 1) scope.push(blocks[cursor]!);
    const parsed = inlineLines(scope.map((entry) => entry.rest));
    for (const [offset, entry] of scope.entries()) {
      lines.push({
        kind: entry.kind,
        indent: entry.indent,
        ...(entry.marker === undefined ? {} : { marker: entry.marker }),
        ...(entry.markerKind === undefined ? {} : { markerKind: entry.markerKind }),
        inlines: parsed[offset] ?? [],
      });
    }
    index = cursor - 1;
  }
  return lines;
}

/** The source a formatted draft stands for: the invariant `formatDraft` must never break. */
export function draftPlainText(lines: readonly DraftLine[]): string {
  return lines.map((line) => `${line.indent}${line.marker ?? ""}${line.inlines.map((token) => token.text).join("")}`).join("\n");
}

const LINE_CLASS: Record<DraftLineKind, string> = {
  text: "hui-draft-line",
  blank: "hui-draft-line hui-draft-line--blank",
  "fence-open": "hui-draft-line hui-draft-line--fence hui-draft-line--fence-open",
  "fence-close": "hui-draft-line hui-draft-line--fence hui-draft-line--fence-close",
  code: "hui-draft-line hui-draft-line--code",
  list: "hui-draft-line hui-draft-line--list",
  ordered: "hui-draft-line hui-draft-line--ordered",
};

const INLINE_CLASS: Record<Exclude<DraftInlineKind, "text">, string> = {
  marker: "hui-draft-marker",
  bold: "hui-draft-bold",
  italic: "hui-draft-italic",
  "bold-italic": "hui-draft-bold-italic",
  code: "hui-draft-code",
};

const MARKER_CLASS: Record<DraftMarkerKind, string> = {
  bullet: "hui-draft-marker hui-draft-marker--bullet",
  ordered: "hui-draft-marker hui-draft-marker--ordered",
  fence: "hui-draft-marker hui-draft-marker--fence",
};

/** The dot a bullet paints instead of its dash, which keeps the column the textarea reserved for `- `. */
const BULLET_DOT = '<i class="hui-draft-marker__dot"></i>';

/** Every character the draft holds, escaped, with the class names above and nothing else: the mirror draws only what
 * this module built, so no source character can become markup. */
export function renderDraftHtml(lines: readonly DraftLine[]): string {
  let html = "";
  for (const line of lines) {
    html += `<div class="${LINE_CLASS[line.kind]}">`;
    if (line.indent) html += escapeHtml(line.indent);
    if (line.marker !== undefined) {
      const bullet = line.markerKind === "bullet" ? BULLET_DOT : "";
      html += `<span class="${MARKER_CLASS[line.markerKind ?? "fence"]}">${escapeHtml(line.marker)}${bullet}</span>`;
    }
    for (const token of line.inlines) {
      html += token.kind === "text" ? escapeHtml(token.text) : `<span class="${INLINE_CLASS[token.kind]}">${escapeHtml(token.text)}</span>`;
    }
    html += "</div>";
  }
  return html;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
