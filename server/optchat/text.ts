/**
 * Text measures of the OptChat engine. Every size is UTF-8 bytes (or UTF-16
 * characters for the caps and cache marks), never tokens: a tokenizer changes
 * between models, a byte count never does.
 */

export const bytes = (text: string): number => Buffer.byteLength(text, "utf8");

/** One line of a view or a prompt: newlines become single spaces. */
export const flatten = (text: string): string => text.replace(/\r\n|\r|\n/gu, " ");

/** The longest prefix of `text` within `limit` bytes, never splitting a character. */
export function cutUtf8(text: string, limit: number): string {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= limit) return text;
  let end = Math.max(0, limit);
  // A continuation byte (10xxxxxx) at the cut means the character before it does not fit whole.
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
  return encoded.subarray(0, end).toString("utf8");
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const cutNote = (count: number) => `\n[${count} characters cut]\n`;

/**
 * At most `cap` characters: the head and the tail of `text` with a note of what was cut between them. Tool results
 * are resent on every later step of a turn and land in the permanent log, so they are bounded once, when logged.
 */
export function capText(text: string, cap: number): string {
  if (text.length <= cap) return text;
  // The note's length depends on the count it reports; settle it before splitting the room left.
  let note = cutNote(text.length);
  note = cutNote(text.length - Math.max(0, cap - note.length));
  const room = Math.max(0, cap - note.length);
  let head = Math.ceil(room / 2);
  let tail = room - head;
  // Never split a surrogate pair at either cut.
  if (head > 0 && isHigh(text.charCodeAt(head - 1))) head--;
  if (tail > 0 && isLow(text.charCodeAt(text.length - tail))) tail--;
  return text.slice(0, head) + cutNote(text.length - head - tail) + (tail ? text.slice(text.length - tail) : "");
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The local day a line is written on; it picks the file the line goes to. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local date and time with its UTC offset, e.g. `2026-10-05 19:09:33 +02:00`. */
export function localDateTime(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const zone = `${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${localDay(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${zone}`;
}
