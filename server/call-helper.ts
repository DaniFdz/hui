/**
 * The bot's quick helper during a GPT-Live call, and the record of the call at
 * hang-up (HUI-18), after OpenDots (CopilotKit/OpenDots, MIT): the voice model
 * has one tool, which asks the bot. Here that tool is answered by the bot's
 * utility model at low thinking, from the bot's instructions, its memory and
 * the call so far; what needs tools or real work is handed to the bot's own
 * chat instead. At hang-up the same utility model writes what happened.
 *
 * The model call is injected (`CallCompletion`), so these run under test.
 */
import { randomUUID } from "node:crypto";
import { boundText, CALL_LIMITS, CALL_TASK_PREFIX, callMinutes, callTranscriptText, type CallDelegationResult, type CallRecord, type CallRecordLine } from "../shared/calls.ts";
import type { BotRecord, BotReply } from "../shared/bots.ts";
import type { ActiveCall } from "./calls.ts";
import { voiceLanguage, voiceLanguageName } from "../shared/voice.ts";
import { boundBytes, memorySlice } from "./calls.ts";

/** One model completion: the reply's text. Throws when the model fails or the signal aborts. */
export type CallCompletion = (model: string, request: { system: string; prompt: string; signal: AbortSignal }) => Promise<string>;

const MODEL_REF = /^[^/\s]+\/\S+$/u;

/**
 * The models a bot's quick work tries, in order: its utility model (stored as `memoryModel`), then Settings' utility
 * model, then its own model. A model that fails hands over to the next one.
 */
export function utilityCandidates(bot: Pick<BotRecord, "memoryModel" | "model">, settingsUtility: string | undefined): string[] {
  return [...new Set([bot.memoryModel, settingsUtility, bot.model].filter((ref): ref is string => typeof ref === "string" && MODEL_REF.test(ref)))];
}

function languageRule(bot: Pick<BotRecord, "voice">): string {
  const language = voiceLanguage(bot.voice?.language);
  return language ? voiceLanguageName(language) : "the language the user speaks";
}

const quote = (text: string, tag: string) => text.replace(new RegExp(`</?${tag}`, "giu"), (match) => match.replace("<", "‹"));

export type HelperInput = {
  bot: Pick<BotRecord, "name" | "instructions" | "voice">;
  operator: string;
  view?: string;
  lines: readonly CallRecordLine[];
  request: string;
};

/** The helper's prompt: who it helps and how it answers, then the instructions, the memory, the call and the request. */
export function helperPrompt(input: HelperInput): { system: string; prompt: string } {
  const name = input.bot.name;
  const system = [
    `You are ${name}'s quick helper during a live phone call between ${input.operator} and ${name}. A fast voice model is talking for ${name}; it asks you what it cannot answer from the call alone.`,
    `Answer from ${name}'s instructions, its memory and the call below, in one to three short sentences meant to be spoken, in ${languageRule(input.bot)}.`,
    "Use only what is below. Never invent facts, results or memories: when you do not know, say so briefly.",
    `When the request needs tools, files, current information (news, weather, prices, the time), an action, or more than a quick answer, do not answer it. Reply with exactly one line: "HANDOFF: <the task in one sentence>". ${name} then does it in its own chat.`,
    `When the user asks for ${name} to do something, or to hand it off, reply with HANDOFF too.`,
  ].join("\n");
  const persona = input.bot.instructions?.trim();
  const memory = input.view ? memorySlice(input.view, CALL_LIMITS.helperMemoryBytes) : "";
  const prompt = [
    persona ? `<instructions>\n${quote(boundBytes(persona, CALL_LIMITS.personaBytes), "instructions")}\n</instructions>` : "",
    memory ? `<memory>\n${quote(memory, "memory")}\n</memory>` : "<memory>\n(empty)\n</memory>",
    `<call>\n${quote(callTranscriptText(input.lines.slice(-60), name, input.operator), "call") || "(nothing said yet)"}\n</call>`,
    `The voice model asks: ${input.request}`,
  ].filter(Boolean).join("\n\n");
  return { system, prompt };
}

/** An answer, or a task for the bot's chat. */
export function parseHelperReply(text: string): { kind: "answer"; text: string } | { kind: "handoff"; task: string } {
  const trimmed = text.trim();
  const handoff = /^\s*HANDOFF\s*:\s*(.+)$/imu.exec(trimmed);
  if (handoff?.[1]?.trim()) return { kind: "handoff", task: boundText(handoff[1].trim(), CALL_LIMITS.request) };
  return { kind: "answer", text: boundText(trimmed, CALL_LIMITS.result) };
}

/** Thrown when every candidate model failed; `aborted` when the time budget ran out first. */
export class CallHelperError extends Error {
  override name = "CallHelperError";
  readonly aborted: boolean;
  constructor(message: string, aborted: boolean) {
    super(message);
    this.aborted = aborted;
  }
}

/** Tries each model in turn until one answers, within the signal's time. */
export async function complete(models: readonly string[], request: { system: string; prompt: string; signal: AbortSignal }, completion: CallCompletion): Promise<{ text: string; model: string }> {
  if (!models.length) throw new CallHelperError("No utility model is configured for this bot.", false);
  let last: unknown;
  for (const model of models) {
    if (request.signal.aborted) break;
    try {
      const text = (await completion(model, request)).trim();
      if (text) return { text, model };
      last = new Error("The model answered nothing.");
    } catch (error) {
      last = error;
    }
  }
  if (request.signal.aborted) throw new CallHelperError("The helper ran out of time.", true);
  throw new CallHelperError(last instanceof Error && last.message ? last.message : "The utility model failed.", false);
}

/** The record's summary prompt: what happened, in the bot's language, confirmed things only. */
export function summaryPrompt(input: { bot: Pick<BotRecord, "name" | "voice">; operator: string; record: Pick<CallRecord, "lines" | "startedAt" | "endedAt"> }): { system: string; prompt: string } {
  const name = input.bot.name;
  const minutes = callMinutes(input.record);
  const system = [
    `You write ${name}'s record of a phone call it just had with ${input.operator}. Write it in ${languageRule(input.bot)}, at most 120 words, as short Markdown sections:`,
    "**Discussed**: one or two lines; **Decisions**: only what was confirmed; **To remember**: facts the user stated; **Handed off**: tasks given to the chat.",
    "Leave out a section with nothing in it. Never add what was not said; no guesses.",
  ].join("\n");
  const prompt = `A ${minutes}-minute call. Transcript:\n<call>\n${quote(callTranscriptText(input.record.lines, name, input.operator), "call")}\n</call>`;
  return { system, prompt };
}


/** The operator as the call's prompts name them: their profile name, or "the user". */
export function operatorName(profileName: string | undefined): string {
  const name = profileName?.trim();
  return name && name !== "HUI Operator" ? name : "the user";
}

export type CallDelegateDeps = {
  /** The bot's memory view (`BotService.callContext`); a call goes on without it. */
  view(botId: string): Promise<string | undefined>;
  /** Settings' utility model and the operator's name, current at each question. */
  settings(): Promise<{ utility: string; operator: string }>;
  completion: CallCompletion;
  /** Puts a task in the bot's own chat as a message and resolves with the run that answers it. */
  handOff(botId: string, text: string): Promise<BotReply>;
  now?: () => number;
  /** The helper's time per question; `CALL_LIMITS.helperSeconds` unless a test changes it. */
  budgetMs?: number;
  report?: (summary: string, detail?: string) => void;
};

/**
 * The delegation seam's implementation: the bot's quick helper answers within `CALL_LIMITS.helperSeconds`, from its
 * utility model, or hands the request to the bot's chat. It never waits for or queues behind the bot's own turn.
 * Past `CALL_LIMITS.helperQuestions` questions, every request is handed off; past `CALL_LIMITS.handoffs`, none is.
 */
export function createCallDelegate(deps: CallDelegateDeps) {
  const now = () => (deps.now ?? Date.now)();
  const handOff = (bot: BotRecord, call: ActiveCall, task: string): CallDelegationResult => {
    if (call.tasks.size >= CALL_LIMITS.handoffs) {
      return { status: "limit", speak: `This call already gave ${bot.name} ${CALL_LIMITS.handoffs} tasks, so ask for more in ${bot.name}'s chat.` };
    }
    const id = randomUUID();
    const reply = deps.handOff(bot.id, `${CALL_TASK_PREFIX}${task}`);
    reply.catch(() => {});
    call.tasks.set(id, reply);
    call.lines.push({ role: "handoff", text: task, at: now() });
    // GPT-Live hears this on the commentary channel: the task's result is the delegation's speakable answer, later.
    return {
      status: "handed-off", task: id,
      speak: boundText(`Handed to ${bot.name}'s chat: ${task}. It is being done there now; its result comes on the speakable channel when it is ready. Until then, tell the user ${bot.name} is on it.`, CALL_LIMITS.result),
    };
  };
  return async (input: { bot: BotRecord; call: ActiveCall; request: string }, signal?: AbortSignal): Promise<CallDelegationResult> => {
    const { bot, call, request } = input;
    if (call.questions >= CALL_LIMITS.helperQuestions) return handOff(bot, call, request);
    call.questions += 1;
    const [view, settings] = await Promise.all([deps.view(bot.id).catch(() => undefined), deps.settings()]);
    const { system, prompt } = helperPrompt({ bot, operator: settings.operator, ...(view ? { view } : {}), lines: call.lines, request });
    const budget = AbortSignal.timeout(deps.budgetMs ?? CALL_LIMITS.helperSeconds * 1000);
    try {
      const { text } = await complete(utilityCandidates(bot, settings.utility), { system, prompt, signal: signal ? AbortSignal.any([signal, budget]) : budget }, deps.completion);
      const reply = parseHelperReply(text);
      if (reply.kind === "handoff") return handOff(bot, call, reply.task);
      call.lines.push({ role: "helper", request, text: reply.text, at: now() });
      return { status: "answered", speak: reply.text };
    } catch (error) {
      if (signal?.aborted) throw new DOMException("The wait was cancelled.", "AbortError");
      const message = error instanceof Error ? error.message : String(error);
      deps.report?.("A call's helper did not answer", message);
      if (error instanceof CallHelperError && error.aborted) {
        return { status: "timeout", speak: `That is taking ${bot.name} a while to answer. I can hand it to ${bot.name}'s chat to work on, if you like.` };
      }
      return { status: "failed", speak: boundText(`${bot.name} could not answer that quickly (${message}). I can hand it to ${bot.name}'s chat instead, if you like.`, CALL_LIMITS.result) };
    }
  };
}

/**
 * The call's record at its end: the summary the utility model writes (in the bot's language; unavailable when it
 * fails), with the whole transcript. Undefined for a call where nothing was said.
 */
export async function buildCallRecord(input: {
  bot: Pick<BotRecord, "name" | "voice" | "memoryModel" | "model">;
  call: Pick<ActiveCall, "id" | "startedAt" | "lines">;
  endedAt: number;
  settings: { utility: string; operator: string };
  completion: CallCompletion;
  /** The summary's time; 90 s unless a test changes it. */
  budgetMs?: number;
  report?: (summary: string, detail?: string) => void;
}): Promise<CallRecord | undefined> {
  if (!input.call.lines.length) return undefined;
  // The browser writes what was said as each turn ends and the gateway adds the helper's answers as they come: the
  // record reads in the order things happened.
  const lines = [...input.call.lines].sort((a, b) => a.at - b.at);
  const record: CallRecord = { call: input.call.id, bot: input.bot.name, startedAt: input.call.startedAt, endedAt: input.endedAt, lines };
  try {
    const { system, prompt } = summaryPrompt({ bot: input.bot, operator: input.settings.operator, record });
    const { text } = await complete(utilityCandidates(input.bot, input.settings.utility), { system, prompt, signal: AbortSignal.timeout(input.budgetMs ?? 90_000) }, input.completion);
    record.summary = boundText(text, 2_000);
  } catch (error) {
    record.summaryUnavailable = true;
    input.report?.("A call's summary could not be written", error instanceof Error ? error.message : String(error));
  }
  return record;
}
