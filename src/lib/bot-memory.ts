/**
 * A bot's memory as the panel reads it: OptChat's view is lines `id+n|text`,
 * one summary of the n messages from id on. Zooming a line returns its two
 * halves, and zooming a single message (n = 1) returns it whole.
 */
import { BOT_MEMORY_BUDGET_BYTES, type BotMemoryStatus, type BotMemoryUsage } from "./bots.ts";
import { formatCount } from "./message-metadata.ts";

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

function statusFacts(status: BotMemoryStatus): readonly (number | string | boolean)[] {
  const { usage } = status;
  return [
    status.messages, status.built, status.pending, status.viewBytes, status.viewLines, status.waiting === true,
    status.failing?.node ?? "", status.failing?.error ?? "",
    usage.calls, usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.cost,
  ];
}

/** Whether the bots stream reports another memory than the one on screen, so
 * the open Memory tab reads it again. Without a pushed status there is
 * nothing to go by (the gateway cannot read that memory); without a shown one
 * the tab has yet to read it. */
export function memoryStatusChanged(shown: BotMemoryStatus | undefined, pushed: BotMemoryStatus | undefined): boolean {
  if (!pushed) return false;
  if (!shown) return true;
  const before = statusFacts(shown);
  return statusFacts(pushed).some((fact, index) => fact !== before[index]);
}

/** Decimal kilobytes, as the 128 KB budget is stated. */
export function formatKilobytes(bytes: number): string {
  const kilobytes = Math.max(0, bytes) / 1000;
  return kilobytes < 10 ? kilobytes.toFixed(1).replace(/\.0$/u, "") : String(Math.round(kilobytes));
}

export function memoryBudgetLabel(viewBytes: number): string {
  return `${formatKilobytes(viewBytes)}/${formatKilobytes(BOT_MEMORY_BUDGET_BYTES)} KB`;
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** US dollars as providers report them; a sliver below a hundredth of a cent
 * still reads as spent rather than as $0.0000. */
export function formatMemoryCost(cost: number): string {
  return cost < 0.0001 ? "<$0.0001" : `$${cost.toFixed(4)}`;
}

/** What the summarizer spent, in one line: model calls, tokens read (cache
 * reads and writes are input too) and written, and the cost once a provider
 * reported one. Short messages are their own summaries, so a memory can grow
 * without any call. */
export function memoryUsageLabel(usage: BotMemoryUsage): string {
  if (!usage.calls) return "No model calls yet";
  const input = usage.input + usage.cacheRead + usage.cacheWrite;
  return [
    plural(usage.calls, "call", "calls"),
    `${plural(input, "token", "tokens")} in, ${formatCount(usage.output)} out`,
    ...(usage.cost > 0 ? [formatMemoryCost(usage.cost)] : []),
  ].join(" · ");
}

/** The same spend, every counter spelled out (the line's tooltip). */
export function memoryUsageDetail(usage: BotMemoryUsage): string {
  const tokens = `tokens: ${formatCount(usage.input)} input, ${formatCount(usage.cacheRead)} cache read, ${formatCount(usage.cacheWrite)} cache write, ${formatCount(usage.output)} output`;
  return [plural(usage.calls, "model call", "model calls"), tokens, ...(usage.cost > 0 ? [`${formatMemoryCost(usage.cost)} reported`] : [])].join("; ");
}
