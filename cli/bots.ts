/**
 * `hui bot`: bots (HUI-18) from a terminal. Everything goes through the running
 * gateway, as in Settings and the Bots tab: the `/__hui/bots` routes, the
 * session API for `chat`, and the Automation routes for routines. The CLI
 * never opens the Durable store or OptChat's files; the gateway is their only
 * writer.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { BOT_FACE_SHAPE_LABELS, botColorName, botFaceColor, botFaceShape, botLook, type BotMessageResult, type BotQuestion, type BotsUpdate, type BotView } from "../shared/bots.ts";
import { voiceLanguage, voiceLanguageName } from "../shared/voice.ts";
import { gptLiveVoiceLabel } from "../shared/calls.ts";
import type { AutomationSchedule, AutomationTask } from "../src/lib/automation-types.ts";

export type BotFlags = {
  archived?: boolean;
  json?: boolean;
  name?: string;
  title?: string;
  instructions?: string;
  "instructions-file"?: string;
  cwd?: string;
  model?: string;
  thinking?: string;
  "memory-model"?: string;
  emoji?: string;
  shape?: string;
  color?: string;
  voice?: string;
  "voice-speed"?: string;
  language?: string;
  "call-voice"?: string;
  wait?: boolean;
  timeout?: string;
  zoom?: string;
  html?: string;
  prompt?: string;
  at?: string;
  every?: string;
  cron?: string;
  timezone?: string;
};

/** The terminal, injectable so `chat` and `send` run against scripted input in tests. */
export type BotIO = {
  out(text: string): void;
  err(text: string): void;
  /** All of stdin, for `send -`. */
  readStdin(): Promise<string>;
  /** Lines typed in `chat`; ends with stdin. */
  lines(): AsyncIterable<string>;
  /** Ctrl+C during `chat`; returns an unsubscribe. */
  onInterrupt(listener: () => void): () => void;
  /** Where relative `--cwd`, `--instructions-file` and `--html` paths resolve. */
  cwd: string;
  /** `--cron` without `--timezone`. */
  timezone: string;
};

/** The real terminal: stdout, stderr, stdin and SIGINT. */
export function terminalBotIO(): BotIO {
  return {
    out: (text) => { process.stdout.write(text); },
    err: (text) => { process.stderr.write(text); },
    readStdin: async () => {
      let text = "";
      process.stdin.setEncoding("utf8");
      for await (const chunk of process.stdin) text += chunk as string;
      return text;
    },
    lines: () => createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY, terminal: false }),
    onInterrupt: (listener) => {
      process.on("SIGINT", listener);
      return () => { process.off("SIGINT", listener); };
    },
    cwd: process.cwd(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** A refused request, with the gateway's message. */
export class GatewayError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
  }
}

const SESSION_STATUSES_BUSY = new Set(["running", "waiting"]);
/** `send --wait` without `--timeout`: the gateway's default. */
const DEFAULT_WAIT_SECONDS = 300;

/** One `/__hui/` request; a refusal throws its message (a few, such as a disallowed Host, are plain text). */
async function request<T>(base: string, path: string, options: { method?: string; body?: unknown; timeoutMs?: number; html?: boolean } = {}): Promise<T> {
  const response = await fetch(new URL(path, base), {
    method: options.method ?? "GET",
    headers: { "x-hui": "1", ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    redirect: "error",
  });
  const text = await response.text();
  if (options.html && response.ok) return text as T;
  let reply: T & { error?: string };
  try {
    reply = JSON.parse(text) as T & { error?: string };
  } catch {
    throw new GatewayError(text.trim() || `HUI returned HTTP ${response.status}.`, response.status);
  }
  if (!response.ok) throw new GatewayError(reply.error ?? `HUI returned HTTP ${response.status}.`, response.status);
  return reply;
}

const bots = async (base: string, archived = false) =>
  (await request<{ bots: BotView[] }>(base, `/__hui/bots${archived ? "?archived=1" : ""}`)).bots;

/** The bot an id, handle (`@` optional) or exact name names, archived ones included; a shared name must be an id or handle. */
export async function findBot(base: string, target: string): Promise<BotView> {
  const all = [...await bots(base), ...await bots(base, true)];
  const byId = all.find((bot) => bot.id === target);
  if (byId) return byId;
  const handle = target.replace(/^@/u, "").toLowerCase();
  const byHandle = all.find((bot) => bot.handle === handle);
  if (byHandle) return byHandle;
  const named = all.filter((bot) => bot.name === target);
  if (named.length === 1) return named[0]!;
  throw new Error(named.length
    ? `${named.length} bots are named ${target}. Use a handle or an id: hui bot list --json.`
    : `No bot named ${target}. See hui bot list.`);
}

/** `30s`, `5m`, `2h` or `1d` in milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d{1,9})(s|m|h|d)$/u.exec(value.trim());
  if (!match) throw new Error("--every takes a duration such as 30s, 5m, 2h or 1d.");
  return Number(match[1]) * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
}

/** `id+n`, a line of a bot's memory view. */
export function parseZoom(value: string): { id: number; n: number } {
  const match = /^(\d{1,15})\+(\d{1,15})$/u.exec(value.trim());
  if (!match) throw new Error("--zoom takes a view line's id+n, such as 2184+8.");
  return { id: Number(match[1]), n: Number(match[2]) };
}

export function routineSchedule(flags: BotFlags, timezone: string): AutomationSchedule {
  if (flags.at !== undefined) {
    const at = Date.parse(flags.at);
    if (!Number.isFinite(at)) throw new Error("--at takes an ISO date and time, such as 2026-10-06T09:00:00+02:00.");
    return { kind: "at", at: new Date(at).toISOString() };
  }
  if (flags.every !== undefined) return { kind: "every", everyMs: parseDuration(flags.every) };
  return { kind: "cron", expression: flags.cron ?? "", timezone: flags.timezone ?? timezone };
}

/** A bot body from add/edit flags: only what was given. */
async function botBody(flags: BotFlags, io: BotIO): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  if (flags.name !== undefined) body["name"] = flags.name;
  if (flags.title !== undefined) body["title"] = flags.title;
  if (flags.instructions !== undefined) body["instructions"] = flags.instructions;
  if (flags["instructions-file"] !== undefined) body["instructions"] = await readFile(resolve(io.cwd, flags["instructions-file"]), "utf8");
  // `~` is the gateway user's home there; anything else is relative to where the command runs.
  if (flags.cwd !== undefined) body["cwd"] = flags.cwd.startsWith("~") ? flags.cwd : resolve(io.cwd, flags.cwd);
  if (flags.model !== undefined) body["model"] = flags.model;
  if (flags.thinking !== undefined) body["thinking"] = flags.thinking;
  if (flags["memory-model"] !== undefined) body["memoryModel"] = flags["memory-model"];
  // The look: an emoji, or (with --emoji "") the face, its shape and color; "" clears each.
  if (flags.emoji !== undefined || flags.shape !== undefined || flags.color !== undefined) {
    body["avatar"] = {
      ...(flags.emoji !== undefined ? { emoji: flags.emoji } : {}),
      ...(flags.shape !== undefined ? { shape: flags.shape.trim() ? botFaceShape(flags.shape) ?? flags.shape.trim().toLowerCase() : "" } : {}),
      ...(flags.color !== undefined ? { color: lookColor(flags.color) } : {}),
    };
  }
  // A VoiceStudio voice, speed and language, and a GPT-Live call voice; "" clears each on edit (a speed as null, as the
  // route takes it).
  if (flags.voice !== undefined || flags["voice-speed"] !== undefined || flags.language !== undefined || flags["call-voice"] !== undefined) {
    body["voice"] = {
      ...(flags.voice !== undefined ? { profile: flags.voice } : {}),
      ...(flags["voice-speed"] !== undefined ? { speed: flags["voice-speed"] === "" ? null : Number(flags["voice-speed"]) } : {}),
      ...(flags.language !== undefined ? { language: flags.language.trim().toLowerCase() } : {}),
      ...(flags["call-voice"] !== undefined ? { live: flags["call-voice"].trim().toLowerCase() } : {}),
    };
  }
  return body;
}

/** A palette name (`mint`) as its hex; a hex as given, lowercase; "" as "", which clears the color. */
export function lookColor(value: string): string {
  const color = value.trim();
  return color ? botFaceColor(color)?.hex ?? color.toLowerCase() : "";
}

/** `face · heart · Mint`, `emoji 🦊 · Mint`; "(from its id)" marks what the bot's id picked. */
export function formatLook(bot: Pick<BotView, "id" | "avatar">): string {
  const look = botLook(bot);
  const picked = " (from its id)";
  const color = `${botColorName(look.color)}${look.derived.color ? picked : ""}`;
  return look.kind === "emoji"
    ? `emoji ${look.emoji} · ${color}`
    : `face · ${BOT_FACE_SHAPE_LABELS[look.shape]}${look.derived.shape ? picked : ""} · ${color}`;
}

const routinesOf = async (base: string, bot: BotView) =>
  (await request<{ tasks: AutomationTask[] }>(base, "/__hui/automation")).tasks.filter((task) => task.sessionId === bot.sessionId);

function findRoutine(routines: readonly AutomationTask[], bot: BotView, target: string): AutomationTask {
  const byId = routines.find((task) => task.id === target);
  if (byId) return byId;
  const named = routines.filter((task) => task.name === target);
  if (named.length === 1) return named[0]!;
  throw new Error(named.length
    ? `${named.length} routines of @${bot.handle} are named ${target}. Use an id: hui bot routine list ${bot.handle} --json.`
    : `@${bot.handle} has no routine named ${target}. See hui bot routine list ${bot.handle}.`);
}

/** Runs one `hui bot` action and returns the exit code. */
export async function botCommand(base: string, action: string, operands: readonly string[], flags: BotFlags, io: BotIO): Promise<number> {
  const print = (value: unknown, text: string) => io.out(`${flags.json ? JSON.stringify(value) : text}\n`);
  if (action === "list") {
    const list = await bots(base, flags.archived === true);
    print(list, formatBots(list, flags.archived === true));
    return 0;
  }
  if (action === "add") {
    const { bot } = await request<{ bot: BotView }>(base, "/__hui/bots", { method: "POST", body: await botBody(flags, io), timeoutMs: 60_000 });
    print(bot, `Added @${bot.handle} (${bot.name}). Talk to it with hui bot chat ${bot.handle}.`);
    return 0;
  }
  const bot = await findBot(base, operands[0]!);
  const path = `/__hui/bots/${encodeURIComponent(bot.id)}`;
  switch (action) {
    case "show": {
      const { bot: view } = await request<{ bot: BotView }>(base, path);
      print(view, formatBot(view));
      return 0;
    }
    case "edit": {
      const { bot: view } = await request<{ bot: BotView }>(base, path, { method: "PATCH", body: await botBody(flags, io), timeoutMs: 60_000 });
      print(view, `Updated @${view.handle} (${view.name}).`);
      return 0;
    }
    case "remove": {
      const { bot: view } = await request<{ bot: BotView }>(base, path, { method: "DELETE" });
      print(view, `Archived @${view.handle}. Its chat transcript and memory are kept and its routines are disabled; hui bot restore ${view.handle} brings it back.`);
      return 0;
    }
    case "restore": {
      const { bot: view } = await request<{ bot: BotView }>(base, `${path}/restore`, { method: "POST", body: {} });
      print(view, `Restored @${view.handle}. Its routines stay disabled until you turn them on in Automations.`);
      return 0;
    }
    case "stop": {
      const busy = SESSION_STATUSES_BUSY.has(bot.status);
      const { bot: view } = await request<{ bot: BotView }>(base, `${path}/stop`, { method: "POST", body: {}, timeoutMs: 60_000 });
      print(view, busy ? `Stopped @${view.handle}'s turn.` : `@${view.handle} had no turn running.`);
      return 0;
    }
    case "send": return send(base, bot, operands[1]!, flags, io);
    case "chat": return botChat(base, bot, io);
    case "memory": return memory(base, bot, flags, io);
    case "routine list": {
      const routines = await routinesOf(base, bot);
      print(routines, formatRoutines(bot, routines));
      return 0;
    }
    case "routine add": {
      const { task } = await request<{ task: AutomationTask }>(base, "/__hui/automation/tasks", {
        method: "POST",
        body: { name: flags.name, sessionId: bot.sessionId, prompt: flags.prompt, schedule: routineSchedule(flags, io.timezone), enabled: true },
      });
      print(task, `Added routine ${task.name} for @${bot.handle}${task.nextRunAt ? `; first run ${task.nextRunAt}` : ""}.`);
      return 0;
    }
    case "routine run": {
      const task = findRoutine(await routinesOf(base, bot), bot, operands[1]!);
      const { run } = await request<{ run: unknown }>(base, `/__hui/automation/tasks/${encodeURIComponent(task.id)}/run`, { method: "POST", body: {} });
      print(run, `Started routine ${task.name}; @${bot.handle} answers in its chat.`);
      return 0;
    }
    case "routine remove": {
      const task = findRoutine(await routinesOf(base, bot), bot, operands[1]!);
      await request(base, `/__hui/automation/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      print({ removed: task.name, id: task.id }, `Removed routine ${task.name} of @${bot.handle}.`);
      return 0;
    }
    default:
      throw new Error("Unknown command. Run hui --help.");
  }
}

/** `send`: exit 0 once answered (or accepted, without --wait), 1 on failure or timeout, 2 while a question waits. */
async function send(base: string, bot: BotView, message: string, flags: BotFlags, io: BotIO): Promise<number> {
  const text = message === "-" ? await io.readStdin() : message;
  const timeoutSeconds = flags.timeout === undefined ? undefined : Number(flags.timeout);
  const wait = flags.wait === true;
  const result = await request<BotMessageResult>(base, `/__hui/bots/${encodeURIComponent(bot.id)}/messages`, {
    method: "POST",
    body: { text, ...(wait ? { wait: true, ...(timeoutSeconds ? { timeoutSeconds } : {}) } : {}) },
    // The gateway answers a wait itself once its timeout passes; allow it that long.
    timeoutMs: wait ? ((timeoutSeconds ?? DEFAULT_WAIT_SECONDS) + 30) * 1_000 : 60_000,
  });
  const code = result.status === "failed" || result.status === "timeout" ? 1 : result.status === "needs-input" ? 2 : 0;
  if (flags.json) {
    io.out(`${JSON.stringify(result)}\n`);
    return code;
  }
  if (result.status === "sent") io.out(`Sent to @${bot.handle}.\n`);
  else if (result.status === "queued") io.out(`Queued for @${bot.handle}; it answers once its current turn ends.\n`);
  else if (result.status === "answered") io.out(`${result.reply ?? "(no reply)"}\n`);
  else if (result.status === "failed") io.err(`@${bot.handle} failed: ${result.error ?? "the turn ended with an error."}\n`);
  else if (result.status === "timeout") io.err(`No answer within ${timeoutSeconds ?? DEFAULT_WAIT_SECONDS}s; @${bot.handle} keeps working. Follow it with hui bot chat ${bot.handle}.\n`);
  else {
    for (const question of "questions" in result ? result.questions ?? [] : []) io.out(formatQuestion(question));
    io.out(`@${bot.handle} needs an answer: reply with hui bot chat ${bot.handle}.\n`);
  }
  return code;
}

async function memory(base: string, bot: BotView, flags: BotFlags, io: BotIO): Promise<number> {
  const path = `/__hui/bots/${encodeURIComponent(bot.id)}/memory`;
  if (flags.zoom !== undefined) {
    const { id, n } = parseZoom(flags.zoom);
    const result = await request<{ text: string }>(base, `${path}/zoom?id=${id}&n=${n}`);
    io.out(`${flags.json ? JSON.stringify(result) : result.text}\n`);
    return 0;
  }
  if (flags.html !== undefined) {
    const file = resolve(io.cwd, flags.html);
    await writeFile(file, await request<string>(base, `${path}/html`, { html: true }), { mode: 0o600 });
    io.out(`${flags.json ? JSON.stringify({ file }) : `Wrote @${bot.handle}'s memory to ${file}.`}\n`);
    return 0;
  }
  const result = await request<{ status: NonNullable<BotView["memory"]>; view: string }>(base, path);
  io.out(`${flags.json ? JSON.stringify(result) : `${formatMemory(result.status)}\n${result.view}`}\n`);
  return 0;
}

type ChatEntry = { kind: string; role?: string; text?: string; id?: string; name?: string };
type ChatSnapshot = { status: string; questions?: BotQuestion[]; transcript?: readonly ChatEntry[] };
type ChatEvent = { type: string; id?: string; delta?: string; name?: string; message?: string; level?: string; question?: BotQuestion };

/** Frames of one server-sent `/__hui/` stream until it ends or `signal` aborts. */
async function* frames(base: string, path: string, signal: AbortSignal): AsyncGenerator<{ event: string; data: unknown }> {
  const response = await fetch(new URL(path, base), { headers: { "x-hui": "1", accept: "text/event-stream" }, signal, redirect: "error" });
  if (!response.ok || !response.body) {
    const text = await response.text();
    let error: string | undefined;
    try { error = (JSON.parse(text) as { error?: string }).error; } catch { error = text.trim() || undefined; }
    throw new GatewayError(error ?? `HUI returned HTTP ${response.status}.`, response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length) yield { event, data: JSON.parse(data.join("\n")) as unknown };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** What typing an answer sends for a question. */
export function questionAnswer(question: BotQuestion, typed: string): Record<string, unknown> {
  const value = typed.trim();
  if (value === "/cancel") return { id: question.id, cancelled: true };
  if (question.method === "confirm") {
    if (/^(y|yes)$/iu.test(value)) return { id: question.id, confirmed: true };
    if (/^(n|no)$/iu.test(value)) return { id: question.id, confirmed: false };
    throw new Error("Answer y or n (or /cancel).");
  }
  if (question.method === "select") {
    const options = question.options ?? [];
    const index = /^\d+$/u.test(value) ? Number(value) - 1 : options.findIndex((option) => option.toLowerCase() === value.toLowerCase());
    const option = options[index];
    if (option === undefined) throw new Error(`Answer with a number from 1 to ${options.length} (or /cancel).`);
    return { id: question.id, value: option };
  }
  return { id: question.id, value: typed };
}

const isUserMessage = (entry: ChatEntry) => entry.kind === "message" && entry.role === "user" && Boolean(entry.text?.trim());

/**
 * `chat`: the bot's replies as they stream, typed lines as prompts while it is
 * idle and steering while it works, questions answered inline, and every
 * message the bot gets from elsewhere (a routine, another bot, the Bots tab)
 * as a `> ` line before its reply. Plain text, so it works over SSH. The first
 * Ctrl+C stops a running turn, the next one exits.
 */
export async function botChat(base: string, bot: BotView, io: BotIO): Promise<number> {
  const session = `/__hui/sessions/${encodeURIComponent(bot.sessionId)}`;
  const closing = new AbortController();
  let status = bot.status as string;
  let questions: BotQuestion[] = [];
  let atLineStart = true;
  let speaking = false;
  let interrupts = 0;
  let summarizing = false;
  // Durable may commit a quick reply whole, with no text deltas: the transcript a settle brings is then the only
  // record of it. `seen` entries are accounted for; `streamed` is the text printed live since the last settle.
  let seen = 0;
  let streamed = "";
  let settling = false;
  let firstSnapshot = true;
  const toolsShown = new Set<string>();
  // Lines typed here (prompts and steering) no transcript has shown yet, and how many user messages after `seen` are
  // accounted for: printed when they arrived, or found to be typed here.
  const typed: string[] = [];
  let users = 0;
  let finish!: (code: number) => void;
  const finished = new Promise<number>((resolveCode) => { finish = resolveCode; });
  // Nothing typed is sent before the live stream is attached: a fast reply would otherwise finish unseen.
  let attached!: () => void;
  const streaming = new Promise<void>((resolveStream) => { attached = resolveStream; });
  const write = (text: string) => {
    if (!text) return;
    io.out(text);
    atLineStart = text.endsWith("\n");
  };
  const line = (text: string) => {
    if (!atLineStart) write("\n");
    write(`${text}\n`);
    speaking = false;
  };
  const ask = (question: BotQuestion) => {
    if (!atLineStart) write("\n");
    write(formatQuestion(question));
    speaking = false;
  };
  const failed = (error: unknown) => line(`error: ${error instanceof Error ? error.message : String(error)}`);
  /** A message the bot received: one typed here is on screen already; any other is printed as a user line. */
  const received = (text: string) => {
    const own = typed.indexOf(text.trim());
    if (own >= 0) typed.splice(own, 1);
    else line(`> ${text.trim().replace(/\n/gu, "\n> ")}`);
  };
  /** The user messages a snapshot holds after `seen` that are not accounted for yet, in order. */
  const announce = (transcript: readonly ChatEntry[]) => {
    const messages = transcript.slice(seen).filter(isUserMessage);
    for (const entry of messages.slice(users)) received(entry.text!);
    users = Math.max(users, messages.length);
  };
  const adopt = (snapshot: ChatSnapshot) => {
    status = snapshot.status;
    const known = new Set(questions.map((question) => question.id));
    questions = [...snapshot.questions ?? []];
    for (const question of questions) if (!known.has(question.id)) ask(question);
  };
  /** After a settle: prints what the run said that never streamed (or the tail of what streamed partly). */
  const reconcile = (transcript: readonly ChatEntry[]) => {
    let pending = streamed;
    let user = 0;
    for (const entry of transcript.slice(seen)) {
      // Printed when it arrived, or now in its place.
      if (isUserMessage(entry)) {
        if (user++ >= users) received(entry.text!);
        continue;
      }
      if (entry.kind === "tool" && entry.id && entry.name && !toolsShown.has(entry.id)) line(`· ${entry.name}`);
      if (entry.kind !== "message" || entry.role !== "assistant" || !entry.text?.trim()) continue;
      const text = entry.text;
      if (pending && pending.startsWith(text)) pending = pending.slice(text.length);
      else if (pending && text.startsWith(pending)) {
        write(text.slice(pending.length));
        pending = "";
      } else line(`@${bot.handle}: ${text.trim()}`);
    }
    if (!atLineStart) write("\n");
    seen = transcript.length;
    users = 0;
    streamed = "";
    speaking = false;
    toolsShown.clear();
  };

  const opened = await request<{ snapshot: ChatSnapshot }>(base, `${session}/open`, { method: "POST", body: {}, timeoutMs: 60_000 });
  line(`Chatting with @${bot.handle} (${bot.name}). Type a message and press Enter. Ctrl+C stops a turn; twice exits.`);
  const last = [...opened.snapshot.transcript ?? []].reverse().find((entry) => entry.kind === "message" && entry.role === "assistant" && entry.text?.trim());
  if (last?.text) line(`@${bot.handle}: ${last.text.trim()}`);
  adopt(opened.snapshot);

  const onEvent = (event: ChatEvent) => {
    if (event.type === "text" && event.delta) {
      if (!speaking) {
        if (!atLineStart) write("\n");
        write(`@${bot.handle}: `);
        speaking = true;
      }
      write(event.delta);
      streamed += event.delta;
    } else if (event.type === "tool_start" && event.name) {
      if (event.id) toolsShown.add(event.id);
      line(`· ${event.name}`);
    }
    else if (event.type === "question" && event.question) {
      if (!questions.some((question) => question.id === event.question!.id)) {
        questions.push(event.question);
        ask(event.question);
      }
    } else if (event.type === "notice" && event.message && event.level !== "info") line(`${event.level}: ${event.message}`);
    else if (event.type === "error" && event.message) line(`error: ${event.message}`);
    else if (event.type === "settled") {
      // The snapshot that follows carries the settled transcript.
      settling = true;
      summarizing = false;
      // The next turn's first Ctrl+C stops it again.
      interrupts = 0;
    }
  };

  void (async () => {
    try {
      for await (const { event, data } of frames(base, `${session}/events`, closing.signal)) {
        if (event === "snapshot") {
          const snapshot = data as ChatSnapshot;
          adopt(snapshot);
          if (settling) reconcile(snapshot.transcript ?? []);
          // The first snapshot is history already on screen (its last reply was printed on opening).
          else if (firstSnapshot) seen = snapshot.transcript?.length ?? 0;
          // A bot's chat sends one when it accepts a message, and when a turn takes in steering: before the reply.
          else announce(snapshot.transcript ?? []);
          settling = false;
          firstSnapshot = false;
          attached();
        } else if (event === "status") status = (data as { status: string }).status;
        else if (event === "event") onEvent(data as ChatEvent);
        else if (event === "closed") {
          line(`@${bot.handle}'s chat runtime exited.`);
          finish(1);
          return;
        }
      }
      if (!closing.signal.aborted) {
        line("The gateway closed the stream.");
        finish(1);
      }
    } catch (error) {
      if (closing.signal.aborted) return;
      failed(error);
      finish(1);
    } finally {
      attached();
    }
  })();

  // "Summarizing memory…" while a turn waits on OptChat's compactor; nothing while the gateway cannot read the memory.
  void (async () => {
    try {
      for await (const { event, data } of frames(base, "/__hui/bots/events", closing.signal)) {
        if (event !== "bots") continue;
        const view = (data as BotsUpdate).upserts.find((candidate) => candidate.id === bot.id);
        if (!view) continue;
        if (view.memory?.waiting && !summarizing) line("Summarizing memory…");
        summarizing = view.memory?.waiting === true;
      }
    } catch { /* optional: the chat works without it */ }
  })();

  const submit = async (entered: string) => {
    if (questions.length) {
      const question = questions[0]!;
      let answer: Record<string, unknown>;
      try {
        answer = questionAnswer(question, entered);
      } catch (error) {
        failed(error);
        return;
      }
      questions.shift();
      await request(base, `${session}/question`, { method: "POST", body: answer }).catch((error: unknown) => {
        questions.unshift(question);
        failed(error);
      });
      return;
    }
    const text = entered.trim();
    if (!text) return;
    const steer = () => request(base, `${session}/steer`, { method: "POST", body: { text }, timeoutMs: 60_000 });
    // Before the request: the snapshot that shows it may come before the reply to it.
    typed.push(text);
    try {
      if (SESSION_STATUSES_BUSY.has(status)) await steer();
      else {
        try {
          await request(base, `${session}/prompt`, { method: "POST", body: { text }, timeoutMs: 60_000 });
        } catch (error) {
          // A turn started meanwhile (a routine, another bot): steer it instead.
          if (!(error instanceof GatewayError) || error.status !== 409 || /starting/u.test(error.message)) throw error;
          await steer();
        }
      }
    } catch (error) {
      typed.splice(typed.lastIndexOf(text), 1);
      failed(error);
    }
  };

  // Held as an iterator, so leaving the chat also closes the terminal's line reader.
  const input = io.lines()[Symbol.asyncIterator]();
  void (async () => {
    try {
      await streaming;
      for (;;) {
        const next = await input.next();
        if (next.done || closing.signal.aborted) break;
        await submit(next.value);
      }
      finish(0);
    } catch (error) {
      failed(error);
      finish(1);
    }
  })();

  const stopListening = io.onInterrupt(() => {
    interrupts += 1;
    if (interrupts === 1 && SESSION_STATUSES_BUSY.has(status)) {
      line("Stopping… (Ctrl+C again to exit)");
      void request(base, `${session}/abort`, { method: "POST", body: {}, timeoutMs: 60_000 }).catch(failed);
      return;
    }
    finish(130);
  });

  const code = await finished;
  closing.abort();
  stopListening();
  void input.return?.();
  if (!atLineStart) write("\n");
  return code;
}

function formatQuestion(question: BotQuestion): string {
  const lines = [`? ${question.title}`];
  if (question.message) lines.push(`  ${question.message}`);
  (question.options ?? []).forEach((option, index) => lines.push(`  ${index + 1}. ${option}`));
  lines.push(question.method === "confirm" ? "  Answer y or n, or /cancel."
    : question.method === "select" ? "  Answer with a number, or /cancel."
      : `  Type your answer${question.prefill ? ` (was: ${question.prefill})` : ""}, or /cancel.`);
  return `${lines.join("\n")}\n`;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** One line: the log, the tree, the view, and what the compactor spent since the gateway opened the memory. */
function formatMemory(status: NonNullable<BotView["memory"]>): string {
  const size = status.viewBytes < 1024 ? `${status.viewBytes} B` : `${Math.round(status.viewBytes / 1024)} KB`;
  const { usage } = status;
  return [
    plural(status.messages, "message"),
    `${plural(status.built, "summary", "summaries")} built`,
    `${status.pending} pending`,
    `view ${size} in ${plural(status.viewLines, "line")}`,
    ...(status.waiting ? ["summarizing"] : []),
    ...(status.failing ? [`retrying ${status.failing.node} since ${status.failing.since}: ${status.failing.error}`] : []),
    `compactor ${plural(usage.calls, "call")}, ${plural(usage.input + usage.cacheRead + usage.cacheWrite, "token")} in, ${usage.output} out${usage.cost > 0 ? `, $${usage.cost.toFixed(4)}` : ""}`,
  ].join(" · ");
}

/** One line per bot, for people; --json prints the views. */
export function formatBots(list: readonly BotView[], archived = false): string {
  if (!list.length) return archived ? "No archived bots." : "No bots. Add one with hui bot add --name <name>.";
  return list.map((bot) => [
    `${bot.avatar?.emoji ? `${bot.avatar.emoji} ` : ""}@${bot.handle}`,
    bot.name,
    `${bot.status}${bot.unread ? " · unread" : ""}`,
    ...(bot.title ? [bot.title] : []),
    `${bot.routines} routine${bot.routines === 1 ? "" : "s"}`,
    bot.id,
  ].join("  ")).join("\n");
}

/** `es (Spanish)`; `auto` when VoiceStudio detects the language. */
function formatLanguage(value: string | undefined): string {
  const code = voiceLanguage(value);
  return code ? `${code} (${voiceLanguageName(code)})` : "auto";
}

export function formatBot(bot: BotView): string {
  return [
    `${bot.avatar?.emoji ? `${bot.avatar.emoji} ` : ""}@${bot.handle} · ${bot.name}${bot.title ? ` (${bot.title})` : ""}${bot.archived ? " · archived" : ""}`,
    `status: ${bot.status}${bot.unread ? " · unread" : ""}`,
    `look: ${formatLook(bot)}`,
    `model: ${bot.model ?? "default"}${bot.thinking ? ` · thinking ${bot.thinking}` : ""}`,
    `memory: ${bot.memory ? formatMemory(bot.memory) : "unavailable"}${bot.memoryModel ? ` · compactor model ${bot.memoryModel}` : ""}`,
    ...(bot.voice?.profile !== undefined || bot.voice?.speed !== undefined
      ? [`voice: ${bot.voice.profile ?? "VoiceStudio default"}${bot.voice.speed !== undefined ? ` · ${bot.voice.speed}×` : ""}`]
      : []),
    `language: ${formatLanguage(bot.voice?.language)}`,
    ...(bot.voice?.live ? [`call voice: ${gptLiveVoiceLabel(bot.voice.live)}`] : []),
    `routines: ${bot.routines}`,
    `cwd: ${bot.cwd}`,
    `chat session: ${bot.sessionId}`,
    `id: ${bot.id}`,
    ...(bot.lastMessage ? [`last message (${bot.lastMessage.role}, ${bot.lastMessage.at}): ${bot.lastMessage.text}`] : []),
    ...(bot.description ? [`description: ${bot.description}`] : []),
    ...(bot.instructions ? [`instructions:\n${bot.instructions.replace(/^/gmu, "  ")}`] : []),
  ].join("\n");
}

function formatSchedule(schedule: AutomationSchedule): string {
  if (schedule.kind === "at") return `at ${schedule.at}`;
  if (schedule.kind === "every") {
    const units = [[86_400_000, "d"], [3_600_000, "h"], [60_000, "m"], [1_000, "s"]] as const;
    const [size, unit] = units.find(([step]) => schedule.everyMs % step === 0) ?? [1, "ms"];
    return `every ${schedule.everyMs / size}${unit}`;
  }
  return `cron ${schedule.expression} (${schedule.timezone})`;
}

export function formatRoutines(bot: BotView, routines: readonly AutomationTask[]): string {
  if (!routines.length) return `@${bot.handle} has no routines. Add one with hui bot routine add ${bot.handle} --name <name> --prompt <text> --every 1d.`;
  return routines.map((task) => [
    task.name,
    formatSchedule(task.schedule),
    task.enabled ? `next ${task.nextRunAt ?? "-"}` : "disabled",
    task.id,
  ].join("  ")).join("\n");
}
