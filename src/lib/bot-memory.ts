/**
 * A bot's memory as the panel reads it: OptChat's view is lines `id+n|text`,
 * one summary of the n messages from id on. Zooming a line returns its two
 * halves, and zooming a single message (n = 1) returns it whole.
 */
import { BOT_MEMORY_BUDGET_BYTES } from "./bots.ts";

export type MemoryLine = {
  id: number;
  n: number;
  /** "id+n", the line's stable address in the view and the zoom tree. */
  address: string;
  text: string;
  /** A message whole: the bottom of the zoom tree. */
  message?: true;
};

const LINE = /^(\d+)\+(\d+)\|([\s\S]*)$/u;

export function memoryAddress(id: number, n: number): string {
  return `${id}+${n}`;
}

function parseLines(text: string): MemoryLine[] {
  const lines: MemoryLine[] = [];
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "<chat>" || trimmed === "</chat>") continue;
    const match = LINE.exec(raw);
    if (match) {
      const id = Number(match[1]);
      const n = Number(match[2]);
      lines.push({ id, n, address: memoryAddress(id, n), text: match[3] ?? "" });
    } else if (lines.length) {
      // Defensive: the engine flattens newlines, but never drop text.
      lines.at(-1)!.text += ` ${trimmed}`;
    }
  }
  return lines;
}

/** The rendered view, oldest first, without its `<chat>` wrapper. */
export function parseMemoryView(view: string): MemoryLine[] {
  return parseLines(view);
}

/** The engine's refusal for an address it does not have. */
export class MemoryZoomError extends Error {}

/** A zoom answer: for n > 1 the line's two halves; for n = 1 the message whole,
 * which the engine renders `id+0|kind: text` with its newlines kept. */
export function parseMemoryZoom(text: string, line: Pick<MemoryLine, "id" | "n">): MemoryLine[] {
  if (/^No line \d+\+\d+\.?$/u.test(text.trim())) throw new MemoryZoomError(text.trim());
  if (line.n === 1) {
    const match = LINE.exec(text.replace(/^\s+/u, ""));
    return [{ id: line.id, n: 1, address: memoryAddress(line.id, 0), text: match ? match[3] ?? "" : text, message: true }];
  }
  return parseLines(text);
}

/** The two lines a summary was written from, or none for a single message. */
export function memoryChildren(line: Pick<MemoryLine, "id" | "n">): [{ id: number; n: number }, { id: number; n: number }] | undefined {
  if (line.n < 2) return undefined;
  const half = line.n / 2;
  return [{ id: line.id, n: half }, { id: line.id + half, n: half }];
}

/** Decimal kilobytes, as the 128 KB budget is stated. */
export function formatKilobytes(bytes: number): string {
  const kilobytes = Math.max(0, bytes) / 1000;
  return kilobytes < 10 ? kilobytes.toFixed(1).replace(/\.0$/u, "") : String(Math.round(kilobytes));
}

export function memoryBudgetLabel(viewBytes: number): string {
  return `${formatKilobytes(viewBytes)}/${formatKilobytes(BOT_MEMORY_BUDGET_BYTES)} KB`;
}
