/**
 * Bots are named agents that live on a remote worker: their own instructions,
 * a check-in prompt and an optional schedule. The host runs them itself, so a
 * bot keeps working while no gateway is connected; each one is also an
 * ordinary HUI session the operator can open and talk to.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { nextScheduleAt, normalizeSchedule } from "../automation.ts";
import type { WorkerBot, WorkerBotRun } from "../../shared/workers.ts";
import type { RemoteLaunch } from "./host.ts";
import { isRecord } from "./protocol.ts";
import { writeAtomic } from "./sync-apply.ts";

const MAX_RUNS = 20;
const MAX_BOTS = 50;
const MAX_TIMER_MS = 2_147_483_647;

export type BotRun = WorkerBotRun;
/** The host also remembers which transcript the bot continues. */
export type BotRecord = WorkerBot & { sessionFile?: string };

type Runner = (bot: BotRecord, launch: RemoteLaunch, signal: AbortSignal) => Promise<{ sessionFile?: string; summary?: string }>;

function text(value: unknown, label: string, max: number, required = true): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error(`${label} is required.`);
  if (trimmed.length > max) throw new Error(`${label} is longer than ${max} characters.`);
  return trimmed;
}

/** The shape a gateway relies on before it writes a bot into its registry,
 * also applied to the host's own file, which may be hand-edited. */
export function isBotShape(value: unknown): value is BotRecord {
  return isRecord(value) && typeof value["key"] === "string" && /^[A-Za-z0-9_-]{1,80}$/u.test(value["key"])
    && typeof value["name"] === "string" && value["name"].trim().length > 0 && value["name"].length <= 80
    && typeof value["cwd"] === "string" && value["cwd"].trim().length > 0 && value["cwd"].length <= 4096
    && typeof value["prompt"] === "string" && typeof value["enabled"] === "boolean" && Array.isArray(value["runs"]);
}

/** Validates a bot as received from a gateway; host-owned fields are kept. */
export function normalizeBot(value: unknown, existing?: BotRecord, now = Date.now()): BotRecord {
  if (!isRecord(value)) throw new Error("A bot is required.");
  const key = text(value["key"], "Bot id", 80);
  if (!/^[A-Za-z0-9_-]+$/u.test(key)) throw new Error("Invalid bot id.");
  const schedule = value["schedule"] === null || value["schedule"] === undefined ? null : normalizeSchedule(value["schedule"]);
  const timeout = value["timeoutSeconds"] ?? 1800;
  if (!Number.isSafeInteger(timeout) || (timeout as number) < 30 || (timeout as number) > 86_400) throw new Error("Bot timeout must be between 30 seconds and one day.");
  const model = text(value["model"], "Model", 200, false);
  const thinking = text(value["thinking"], "Thinking", 16, false);
  const enabled = value["enabled"] !== false;
  const stamp = new Date(now).toISOString();
  const next = enabled && schedule ? nextScheduleAt(schedule, now) : null;
  return {
    key,
    name: text(value["name"], "Bot name", 80),
    cwd: text(value["cwd"], "Working directory", 4096),
    instructions: text(value["instructions"], "Instructions", 20_000, false),
    prompt: text(value["prompt"], "Check-in prompt", 20_000),
    schedule,
    enabled,
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    timeoutSeconds: timeout as number,
    ...(existing?.sessionFile ? { sessionFile: existing.sessionFile } : {}),
    nextRunAt: next === null ? null : new Date(next).toISOString(),
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
    runs: existing?.runs ?? [],
  };
}

export class BotScheduler {
  #file: string;
  #launchFile: string;
  #run: Runner;
  #onChange: (bots: BotRecord[]) => void;
  #bots = new Map<string, BotRecord>();
  #launch: Record<string, unknown> | undefined;
  #active = new Map<string, AbortController>();
  #timer: NodeJS.Timeout | undefined;
  #started = false;
  #writes = Promise.resolve();

  constructor(options: { file: string; launchFile: string; run: Runner; onChange: (bots: BotRecord[]) => void }) {
    this.#file = options.file;
    this.#launchFile = options.launchFile;
    this.#run = options.run;
    this.#onChange = options.onChange;
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.#file, "utf8")) as { bots?: unknown[] };
      for (const bot of raw.bots ?? []) {
        if (isBotShape(bot)) {
          // A run that was in flight when the host died did not finish.
          const runs = bot.runs.map((run) => run.status === "running"
            ? { ...run, status: "failed" as const, error: "The worker host stopped during this run.", finishedAt: run.finishedAt ?? new Date().toISOString() }
            : run);
          this.#bots.set(bot.key, { ...bot, runs });
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("The bot list on this worker could not be read.");
    }
    try { this.#launch = JSON.parse(await readFile(this.#launchFile, "utf8")) as Record<string, unknown>; } catch { this.#launch = undefined; }
  }

  start(): void {
    this.#started = true;
    this.#schedule();
  }

  stop(): void {
    this.#started = false;
    clearTimeout(this.#timer);
    for (const controller of this.#active.values()) controller.abort();
  }

  list(): BotRecord[] {
    return [...this.#bots.values()].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  running(): boolean {
    return this.#active.size > 0;
  }

  has(key: string): boolean {
    return this.#bots.has(key);
  }

  /** Whether the host must stay up to keep a schedule. */
  active(): boolean {
    return this.#active.size > 0 || [...this.#bots.values()].some((bot) => bot.enabled && bot.nextRunAt);
  }

  async setLaunch(launch: Record<string, unknown>): Promise<void> {
    this.#launch = launch;
    await writeAtomic(this.#launchFile, `${JSON.stringify(launch)}\n`, 0o600);
  }

  /** Merges a bot's own settings into a launch; the host owns its transcript. */
  launchFor(key: string, base: RemoteLaunch): RemoteLaunch {
    const bot = this.#bots.get(key);
    if (!bot) return base;
    return {
      ...base,
      cwd: bot.cwd,
      ...(bot.sessionFile ? { sessionFile: bot.sessionFile } : {}),
      ...(bot.instructions ? { appendSystemPrompt: [bot.instructions] } : {}),
    };
  }

  /** Learned from PI after a gateway first opens the bot's conversation. */
  async rememberSessionFile(key: string, sessionFile: string): Promise<void> {
    const bot = this.#bots.get(key);
    if (!bot || bot.sessionFile === sessionFile) return;
    this.#bots.set(key, { ...bot, sessionFile });
    await this.#persist();
  }

  async save(value: unknown): Promise<BotRecord> {
    const key = isRecord(value) && typeof value["key"] === "string" ? value["key"] : "";
    const existing = this.#bots.get(key);
    if (!existing && this.#bots.size >= MAX_BOTS) throw new Error(`A worker holds at most ${MAX_BOTS} bots.`);
    const bot = normalizeBot(value, existing);
    this.#bots.set(bot.key, bot);
    await this.#persist();
    this.#schedule();
    return bot;
  }

  async remove(key: string): Promise<{ removed: boolean }> {
    this.#active.get(key)?.abort();
    const removed = this.#bots.delete(key);
    if (removed) await this.#persist();
    this.#schedule();
    return { removed };
  }

  runNow(key: string): { runId: string } {
    const bot = this.#bots.get(key);
    if (!bot) throw new Error("That bot no longer exists on this worker.");
    if (this.#active.has(key)) throw new Error("The bot is already running.");
    const runId = randomUUID();
    void this.#execute(bot, "manual", runId);
    return { runId };
  }

  #schedule(): void {
    clearTimeout(this.#timer);
    if (!this.#started) return;
    const due = [...this.#bots.values()]
      .filter((bot) => bot.enabled && bot.nextRunAt)
      .map((bot) => Date.parse(bot.nextRunAt!))
      .filter(Number.isFinite);
    if (!due.length) return;
    const delay = Math.max(0, Math.min(Math.min(...due) - Date.now(), MAX_TIMER_MS));
    this.#timer = setTimeout(() => this.#fire(), delay);
  }

  #fire(): void {
    const now = Date.now();
    for (const bot of this.#bots.values()) {
      if (!bot.enabled || !bot.nextRunAt || Date.parse(bot.nextRunAt) > now) continue;
      // Advance first, so a slow or failing run never fires twice for one slot.
      const next = bot.schedule ? nextScheduleAt(bot.schedule, now) : null;
      const advanced = { ...bot, nextRunAt: next === null ? null : new Date(next).toISOString() };
      this.#bots.set(bot.key, advanced);
      if (this.#active.has(bot.key)) this.#record(bot.key, { id: randomUUID(), source: "scheduled", status: "skipped", startedAt: new Date(now).toISOString(), finishedAt: new Date(now).toISOString(), error: "The previous run was still going." });
      else void this.#execute(advanced, "scheduled", randomUUID());
    }
    this.#persistQuietly();
    this.#schedule();
  }

  async #execute(bot: BotRecord, source: BotRun["source"], id: string): Promise<void> {
    const startedAt = new Date().toISOString();
    if (!this.#launch) {
      this.#record(bot.key, { id, source, status: "failed", startedAt, finishedAt: startedAt, error: "Connect HUI to this worker once to finish setting it up." });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), bot.timeoutSeconds * 1000);
    this.#active.set(bot.key, controller);
    this.#record(bot.key, { id, source, status: "running", startedAt });
    try {
      const launch = this.launchFor(bot.key, {
        ...this.#launch, cwd: bot.cwd,
        ...(bot.model ? { model: bot.model } : {}), ...(bot.thinking ? { thinking: bot.thinking } : {}),
      } as RemoteLaunch);
      const result = await this.#run(bot, launch, controller.signal);
      const current = this.#bots.get(bot.key);
      if (current && result.sessionFile) this.#bots.set(bot.key, { ...current, sessionFile: result.sessionFile });
      this.#record(bot.key, { id, source, status: controller.signal.aborted ? "failed" : "completed", startedAt, finishedAt: new Date().toISOString(), ...(result.summary ? { summary: result.summary } : {}), ...(controller.signal.aborted ? { error: "The run timed out." } : {}) });
    } catch (error) {
      this.#record(bot.key, { id, source, status: error instanceof Error && error.message === "The bot is busy." ? "skipped" : "failed", startedAt, finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timer);
      this.#active.delete(bot.key);
      this.#persistQuietly();
    }
  }

  #record(key: string, run: BotRun): void {
    const bot = this.#bots.get(key);
    if (!bot) return;
    const runs = [run, ...bot.runs.filter((item) => item.id !== run.id)].slice(0, MAX_RUNS);
    this.#bots.set(key, { ...bot, runs });
    this.#onChange(this.list());
  }

  /** Writes are serialized; the last one always reflects the latest state. */
  #persist(): Promise<void> {
    // A failed write must not poison every later one.
    this.#writes = this.#writes.catch(() => undefined).then(() => writeAtomic(this.#file, `${JSON.stringify({ version: 1, bots: this.list() }, null, 2)}\n`, 0o600));
    this.#onChange(this.list());
    return this.#writes;
  }

  /** For callers that cannot report a failed write anywhere but the log. */
  #persistQuietly(): void {
    this.#persist().catch((error: unknown) => console.error(`Could not save bots: ${error instanceof Error ? error.message : String(error)}`));
  }
}
