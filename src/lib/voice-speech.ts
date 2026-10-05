/**
 * What a bot's Markdown sounds like (HUI-18): sentences without markup, code
 * or link targets, in chunks a speech engine can start on early.
 * `SpeechChunker` takes a reply as it streams and hands out each sentence
 * once it is complete; `speechChunks` does the same for a whole message
 * (read aloud). Pure: no DOM, no network.
 */

export type ChunkOptions = {
  /** The first chunk goes out at this length, usually at its first sentence, so the voice starts early. */
  firstChars: number;
  /** Later chunks gather sentences until they are at least this long; the voice is busy meanwhile. */
  minChars: number;
  /** No chunk is longer: a longer sentence is cut at a comma or space. */
  maxChars: number;
};

export const CHUNK_DEFAULTS: ChunkOptions = { firstChars: 1, minChars: 40, maxChars: 400 };

/** Abbreviations whose dot ends no sentence (an initial such as "J." neither). */
const ABBREVIATIONS = new Set(["e.g", "i.e", "vs", "approx", "mr", "mrs", "ms", "dr", "prof", "sr", "sra", "srta", "fig", "cf", "p.ej", "ej"]);
/** Sentence ends: `.`, `!`, `?`, `…` and closing quotes or brackets, then a space; CJK stops need no space. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s)|[。！？]+/gu;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "") || "a link";
  } catch {
    return "a link";
  }
}

/** One line's inline Markdown, as words: links keep their text, URLs become their host, code its content. */
export function speakableInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^)]*\))*(?:\s+"[^"]*")?\)/gu, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/gu, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/giu, (_, url: string) => hostOf(url))
    .replace(/\bhttps?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]/giu, (url) => hostOf(url))
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/giu, "")
    .replace(/\$\$[^$]*\$\$/gu, "")
    .replace(/`+([^`]*)`+/gu, "$1")
    .replace(/(\*\*|__)(?=\S)([^]*?\S)\1/gu, "$2")
    .replace(/~~(?=\S)([^]*?\S)~~/gu, "$1")
    .replace(/(^|[\s([{"'])[*_](?=\S)([^*_\n]*?\S)[*_](?=$|[\s)\]}.,;:!?"'])/gu, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

/** A whole line: headings, list items and quotes become sentences; tables and rules say nothing. */
export function speakableLine(line: string): { text: string; ends: boolean } | undefined {
  let rest = line.trim();
  if (!rest) return undefined;
  if (/^\|/u.test(rest) || /^:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?$/u.test(rest)) return undefined;
  if (/^(?:[-*_]\s*){3,}$/u.test(rest)) return undefined;
  let ends = false;
  const heading = /^#{1,6}\s+(.*?)(?:\s+#+)?$/u.exec(rest);
  if (heading) {
    rest = heading[1] ?? "";
    ends = true;
  }
  while (/^>\s?/u.test(rest)) rest = rest.replace(/^>\s?/u, "");
  const item = /^(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/u.exec(rest);
  if (item) {
    rest = rest.slice(item[0].length);
    ends = true;
  }
  const text = speakableInline(rest);
  return text ? { text, ends } : undefined;
}

/** Ends a sentence the line left open, so the voice pauses where the text did. */
function closed(sentence: string): string {
  return /[.!?…:;。！？]["'”’)\]]*$/u.test(sentence) ? sentence : `${sentence}.`;
}

/** Cuts a sentence longer than `max` at its last comma, else its last space, before the limit. */
function cutLong(sentence: string, max: number): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const comma = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
    const space = window.lastIndexOf(" ");
    const at = comma > max / 3 ? comma + 1 : space > max / 3 ? space : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export class SpeechChunker {
  readonly #options: ChunkOptions;
  /** The open line: Markdown not yet turned into speech. */
  #raw = "";
  /** The open line already gave its first sentences away: no line-start syntax is left in it. */
  #midLine = false;
  /** Inside a fenced code block: its fence. */
  #fence: string | undefined;
  /** Complete sentences not yet handed out, and the one still being said. */
  #sentences: string[] = [];
  #partial = "";
  /** Chunks handed out since the last reset. */
  #given = 0;

  constructor(options: Partial<ChunkOptions> = {}) {
    this.#options = { ...CHUNK_DEFAULTS, ...options };
  }

  /** Chunks the new text completes, in order. */
  push(delta: string): string[] {
    this.#raw += delta;
    for (let newline = this.#raw.indexOf("\n"); newline >= 0; newline = this.#raw.indexOf("\n")) {
      const line = this.#raw.slice(0, newline);
      this.#raw = this.#raw.slice(newline + 1);
      this.#line(line);
    }
    // The open line's finished sentences can be spoken before the line ends.
    if (!this.#fence && this.#raw && (this.#midLine || !/^\s*(?:`|~|\||#|>|[-*+]\s|\d{1,3}[.)]\s|$)/u.test(this.#raw))) {
      const cut = lastSentenceEnd(this.#raw);
      if (cut > 0) {
        // The cut is a sentence end, so what it closes is complete.
        this.#say(speakableInline(this.#raw.slice(0, cut)), true);
        this.#raw = this.#raw.slice(cut);
        this.#midLine = true;
      }
    }
    return this.#take(false);
  }

  /** Everything left, at the end of the reply. */
  flush(): string[] {
    if (this.#raw) this.#line(this.#raw);
    this.#raw = "";
    this.#fence = undefined;
    this.#boundary();
    return this.#take(true);
  }

  /** Drops what was not handed out (the operator interrupted). */
  reset(): void {
    this.#raw = "";
    this.#midLine = false;
    this.#fence = undefined;
    this.#sentences = [];
    this.#partial = "";
    this.#given = 0;
  }

  #line(line: string): void {
    const fence = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (this.#fence) {
      if (fence && fence[0] === this.#fence[0] && fence.length >= this.#fence.length && !line.trim().slice(fence.length).trim()) this.#fence = undefined;
      return;
    }
    if (fence) {
      this.#boundary();
      this.#fence = fence;
      return;
    }
    if (this.#midLine) {
      this.#midLine = false;
      this.#say(speakableInline(line), false);
      return;
    }
    const spoken = speakableLine(line);
    if (!spoken) {
      // A blank line ends a paragraph; a table or rule ends whatever came before.
      this.#boundary();
      return;
    }
    this.#say(spoken.text, spoken.ends);
  }

  #say(text: string, ends: boolean): void {
    if (text) this.#partial = this.#partial ? `${this.#partial} ${text}` : text;
    const cut = lastSentenceEnd(this.#partial);
    if (cut > 0) {
      this.#sentences.push(...splitSentences(this.#partial.slice(0, cut)));
      this.#partial = this.#partial.slice(cut).trim();
    }
    if (ends) this.#boundary();
  }

  #boundary(): void {
    const rest = this.#partial.trim();
    if (rest) this.#sentences.push(closed(rest));
    this.#partial = "";
  }

  #take(final: boolean): string[] {
    const chunks: string[] = [];
    let group = "";
    for (const sentence of this.#sentences) {
      for (const part of cutLong(sentence, this.#options.maxChars)) {
        if (group && group.length + 1 + part.length > this.#options.maxChars) {
          chunks.push(group);
          group = "";
        }
        group = group ? `${group} ${part}` : part;
        if (group.length >= (this.#given + chunks.length ? this.#options.minChars : this.#options.firstChars)) {
          chunks.push(group);
          group = "";
        }
      }
    }
    this.#sentences = [];
    if (group) {
      if (final) chunks.push(group);
      else this.#sentences = [group];
    }
    this.#given += chunks.length;
    return chunks;
  }
}

/** Where sentences end in `text` (just after their punctuation). "3.14" has no space after its dot, "Dr." and
 * initials end nothing, and a list's "1." was stripped with its line. */
function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  for (const match of text.matchAll(SENTENCE_END)) {
    if (match[0] === ".") {
      const word = /(?:^|[\s(])([^\s(]+)$/u.exec(text.slice(0, match.index))?.[1] ?? "";
      if (ABBREVIATIONS.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word)) continue;
    }
    ends.push(match.index + match[0].length);
  }
  return ends;
}

/** Index just after the last sentence end that more text follows, or 0. */
function lastSentenceEnd(text: string): number {
  return sentenceEnds(text).at(-1) ?? 0;
}

function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const end of sentenceEnds(text)) {
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/** A whole message as chunks to speak, in order. */
export function speechChunks(markdown: string, options: Partial<ChunkOptions> = {}): string[] {
  const chunker = new SpeechChunker(options);
  return [...chunker.push(markdown), ...chunker.flush()];
}

/** A message as one line of speakable text (a call's caption). */
export function speakableText(markdown: string): string {
  return speechChunks(markdown, { firstChars: Number.MAX_SAFE_INTEGER, minChars: Number.MAX_SAFE_INTEGER, maxChars: Number.MAX_SAFE_INTEGER }).join(" ");
}
