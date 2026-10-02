/** Browser-facing view of remote workers and the bots they host. */
import type { AutomationSchedule } from "../src/lib/automation-types.ts";

export type WorkerState = "disconnected" | "connecting" | "connected" | "error";

export type WorkerBotRun = {
  id: string;
  source: "scheduled" | "manual";
  status: "running" | "completed" | "failed" | "skipped";
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
};

export type WorkerBot = {
  /** Also the id of the HUI session the bot talks through. */
  key: string;
  name: string;
  cwd: string;
  instructions: string;
  prompt: string;
  schedule: AutomationSchedule | null;
  enabled: boolean;
  model?: string;
  thinking?: string;
  timeoutSeconds: number;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  runs: WorkerBotRun[];
};

export type WorkerView = {
  id: string;
  name: string;
  /** The connect command, shell-quoted for display and editing. */
  command: string;
  /** Additional local files or directories mirrored to the remote. */
  extraPaths: string[];
  state: WorkerState;
  /** What a connecting worker is doing right now. */
  phase?: string;
  error?: string;
  host?: { hostname: string; platform: string; arch: string; node: string; home: string; release: string };
  sync?: { at: string; files: number; uploaded: number; deleted: number; installed: string[]; skipped: string[]; errors: string[] };
  /** Last bot list the host reported; absent until it is connected once. */
  bots?: WorkerBot[];
};

export type WorkerInput = { name: string; command: string; extraPaths?: string[] };

export type BotInput = {
  name: string;
  cwd: string;
  instructions?: string;
  prompt: string;
  schedule?: AutomationSchedule | null;
  enabled?: boolean;
  model?: string;
  thinking?: string;
  timeoutSeconds?: number;
};

/** Splits a connect command like a POSIX shell would for plain words and
 * single/double quotes; no expansion or operators. */
export function parseCommand(text: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  let started = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === "\\" && quote === "\"" && /["\\$`]/u.test(text[index + 1] ?? "")) current += text[++index];
      else current += char;
    } else if (char === "'" || char === "\"") { quote = char; started = true; }
    else if (char === "\\" && index + 1 < text.length) { current += text[++index]; started = true; }
    else if (/\s/u.test(char)) {
      if (started) words.push(current);
      current = "";
      started = false;
    } else { current += char; started = true; }
  }
  if (quote) throw new Error("The connect command has an unclosed quote.");
  if (started) words.push(current);
  return words;
}

/** POSIX single-quoting. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function formatCommand(words: readonly string[]): string {
  return words.map((word) => /^[\w@%+=:,./-]+$/u.test(word) ? word : shellQuote(word)).join(" ");
}
