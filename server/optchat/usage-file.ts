/**
 * What a memory's compactor spent, kept in `usage.json` beside the log and the
 * tree. It is derived state, not history: the calls, tokens and cost of every
 * summary the memory ever bought, so a bot's memory cost can be read after a
 * restart and compared with what the memory is worth. A missing file is a
 * memory that has not spent anything since this existed, and starts at zero; a
 * file that cannot be used is reported and rewritten from zero, since nothing
 * else can rebuild it.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { JsonFile } from "./json-file.ts";
import type { OptChatUsage } from "./compactor.ts";

export const USAGE_FILE = "usage.json";
const VERSION = 1;

export const NO_USAGE: OptChatUsage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** The usage a file holds, or why it cannot be used. */
export function checkUsage(value: unknown): OptChatUsage | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "holds no record";
  const record = value as Record<string, unknown>;
  if (record["version"] !== VERSION) return `has no version ${VERSION}`;
  const usage = record["usage"];
  if (typeof usage !== "object" || usage === null || Array.isArray(usage)) return "holds no usage";
  const fields = usage as Record<string, unknown>;
  for (const name of ["calls", "input", "output", "cacheRead", "cacheWrite", "cost"] as const) {
    if (!isCount(fields[name])) return `holds a ${name} that is not a count`;
  }
  return {
    calls: fields["calls"] as number, input: fields["input"] as number, output: fields["output"] as number,
    cacheRead: fields["cacheRead"] as number, cacheWrite: fields["cacheWrite"] as number, cost: fields["cost"] as number,
  };
}

/**
 * The usage a memory's directory holds: zero when the file is missing (nothing
 * spent yet), and zero with the reason when it cannot be used. `rewrite` says
 * the file exists but is unusable, so the next write should replace it.
 */
export async function readUsage(dir: string): Promise<{ usage: OptChatUsage; problem?: string; rewrite: boolean }> {
  let text: string;
  try {
    text = await readFile(join(dir, USAGE_FILE), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { usage: NO_USAGE, rewrite: false };
    return { usage: NO_USAGE, rewrite: false, problem: `${USAGE_FILE} could not be read (${code ?? String(error)})` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { usage: NO_USAGE, rewrite: true, problem: `${USAGE_FILE} is not valid JSON` };
  }
  const checked = checkUsage(value);
  return typeof checked === "string" ? { usage: NO_USAGE, rewrite: true, problem: `${USAGE_FILE} ${checked}` } : { usage: checked, rewrite: false };
}

/** Writes a memory's usage whenever it changes, coalescing writes the way its views are written. */
export class UsageFile extends JsonFile {
  constructor(dir: string, usage: () => OptChatUsage, report: (problem: string, error?: unknown) => void) {
    super(join(dir, USAGE_FILE), () => ({ version: VERSION, usage: usage() }), report);
  }
}
