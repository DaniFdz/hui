/**
 * A call with a bot (HUI-18), the Dots-style experience: hands-free turns over
 * a cascaded pipeline, since VoiceStudio has no speech-to-speech API.
 *
 *   listening → hearing → transcribing → thinking → speaking → listening
 *
 * The browser's voice-activity detection cuts utterances; each is transcribed
 * by VoiceStudio and sent to the bot's forever chat as an ordinary message
 * marked `[voice] `, so its memory knows it was spoken. The reply is spoken
 * sentence by sentence as it streams. Speaking over the bot stops its voice
 * and, while its turn still runs, steers it with what was said. Hanging up
 * deletes nothing: a turn in flight finishes in the chat, and an utterance
 * still being transcribed is still sent.
 *
 * `reduceCall` is the pure state machine; `VoiceCall` wires it to injected
 * capabilities (microphone, VoiceStudio, the chat), so both run under test.
 */
import { VOICE_MESSAGE_PREFIX } from "../../shared/voice.ts";
import type { RuntimeEvent } from "./sessions-store.ts";
import { VoiceActivityDetector, type VadOptions } from "./voice-activity.ts";
import { frameLevel } from "./voice-level.ts";
import { SpeechQueue } from "./voice-queue.ts";
import { SpeechChunker, speakableText } from "./voice-speech.ts";

export type CallPhase = "connecting" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking" | "ended" | "failed";

export type CallState = {
  phase: CallPhase;
  startedAt: number;
  endedAt?: number;
  micReady: boolean;
  micMuted: boolean;
  speakerMuted: boolean;
  /** The operator is speaking now. */
  userSpeaking: boolean;
  /** Utterances VoiceStudio is transcribing. */
  transcribing: number;
  /** The bot's chat runs a turn (running, waiting or starting). */
  botBusy: boolean;
  /** Something said was sent and its reply has not finished. */
  awaitingReply: boolean;
  /** That reply's turn has begun. */
  replyStarted: boolean;
  /** The bot's voice is playing (or about to). */
  speaking: boolean;
  /** A tool the bot's turn is using. */
  tool?: string;
  /** Captions: the last thing the operator said, and the bot's reply so far. */
  you: string;
  bot: string;
  /** The latest problem the call survived. */
  notice?: string;
  /** Why the call could not go on. */
  error?: string;
};

export type CallDelivery = "sent" | "queued" | "steered";

export type CallEvent =
  | { type: "mic-ready" }
  | { type: "mic-failed"; message: string }
  | { type: "speech-start" }
  | { type: "speech-end" }
  | { type: "speech-cancel" }
  | { type: "transcribed"; text: string }
  | { type: "transcription-failed"; message: string }
  | { type: "delivered"; delivery: CallDelivery }
  | { type: "send-failed"; message: string }
  | { type: "bot-busy"; busy: boolean }
  | { type: "turn-start" }
  | { type: "settled" }
  | { type: "reply-timeout" }
  | { type: "bot-text"; text: string }
  | { type: "tool"; name?: string }
  | { type: "speaking"; speaking: boolean }
  | { type: "speech-failed"; message: string }
  | { type: "mute-mic"; muted: boolean }
  | { type: "mute-speaker"; muted: boolean }
  | { type: "hang-up" };

export type CallEffect =
  /** Send what was said: a prompt (or a message queued behind a busy turn), or a steer into the running turn. */
  | { type: "send"; text: string; mode: "prompt" | "steer" }
  | { type: "stop-speech" }
  /** Barge-in: the rest of the reply being spoken is dropped. */
  | { type: "interrupt" }
  /** The reply's turn settled: speak what is left of it. */
  | { type: "flush-reply" }
  | { type: "set-mic"; enabled: boolean }
  | { type: "discard-utterance" }
  /** Hang up: release the microphone and stop watching the chat. */
  | { type: "release" };

export function initialCallState(now: number): CallState {
  return {
    phase: "connecting", startedAt: now, micReady: false, micMuted: false, speakerMuted: false, userSpeaking: false,
    transcribing: 0, botBusy: false, awaitingReply: false, replyStarted: false, speaking: false, you: "", bot: "",
  };
}

const terminal = (phase: CallPhase) => phase === "ended" || phase === "failed";

function phaseOf(state: CallState): CallPhase {
  if (terminal(state.phase)) return state.phase;
  if (!state.micReady) return "connecting";
  if (state.userSpeaking) return "hearing";
  if (state.transcribing > 0) return "transcribing";
  if (state.speaking) return "speaking";
  if (state.awaitingReply) return "thinking";
  return "listening";
}

/** What something said becomes in the chat, and how it is delivered. */
function sendSaid(state: CallState, text: string): CallEffect {
  return { type: "send", text: `${VOICE_MESSAGE_PREFIX}${text}`, mode: state.botBusy ? "steer" : "prompt" };
}

export function reduceCall(state: CallState, event: CallEvent, now: number): { state: CallState; effects: CallEffect[] } {
  if (terminal(state.phase)) {
    // Hung up: what was already said and is still being transcribed still lands in the chat.
    if (event.type === "transcribed" || event.type === "transcription-failed") {
      const next = { ...state, transcribing: Math.max(0, state.transcribing - 1) };
      const text = event.type === "transcribed" ? event.text.trim() : "";
      return { state: text ? { ...next, you: text } : next, effects: text ? [sendSaid(state, text)] : [] };
    }
    return { state, effects: [] };
  }
  const next: CallState = { ...state };
  const effects: CallEffect[] = [];
  switch (event.type) {
    case "mic-ready":
      next.micReady = true;
      break;
    case "mic-failed":
      return { state: { ...next, phase: "failed", error: event.message, endedAt: now, speaking: false, userSpeaking: false }, effects: [{ type: "stop-speech" }, { type: "release" }] };
    case "speech-start":
      if (next.micMuted) break;
      next.userSpeaking = true;
      if (next.speaking) {
        next.speaking = false;
        effects.push({ type: "stop-speech" }, { type: "interrupt" });
      }
      break;
    case "speech-end":
      next.userSpeaking = false;
      next.transcribing += 1;
      break;
    case "speech-cancel":
      next.userSpeaking = false;
      break;
    case "transcribed": {
      next.transcribing = Math.max(0, next.transcribing - 1);
      const text = event.text.trim();
      if (!text) {
        next.notice = "Didn't catch that.";
        break;
      }
      delete next.notice;
      next.you = text;
      next.bot = "";
      next.awaitingReply = true;
      // Steering the running turn makes it the reply; a prompt waits for the turn it starts.
      next.replyStarted = next.botBusy;
      effects.push(sendSaid(next, text));
      break;
    }
    case "transcription-failed":
      next.transcribing = Math.max(0, next.transcribing - 1);
      next.notice = event.message;
      break;
    case "delivered":
      // Queued behind a turn that is not ours: the reply is the turn that comes after it.
      if (event.delivery === "queued") next.replyStarted = false;
      break;
    case "send-failed":
      next.awaitingReply = false;
      next.replyStarted = false;
      next.notice = event.message;
      break;
    case "bot-busy":
      next.botBusy = event.busy;
      if (event.busy && next.awaitingReply) next.replyStarted = true;
      if (!event.busy) delete next.tool;
      break;
    case "turn-start":
      if (next.awaitingReply) next.replyStarted = true;
      break;
    case "settled":
      delete next.tool;
      if (next.awaitingReply && next.replyStarted) {
        next.awaitingReply = false;
        next.replyStarted = false;
        effects.push({ type: "flush-reply" });
      }
      break;
    case "reply-timeout":
      next.awaitingReply = false;
      next.replyStarted = false;
      break;
    case "bot-text":
      if (next.awaitingReply) {
        next.replyStarted = true;
        next.bot = event.text;
      }
      break;
    case "tool":
      if (event.name) next.tool = event.name;
      else delete next.tool;
      break;
    case "speaking":
      next.speaking = event.speaking && !next.speakerMuted;
      break;
    case "speech-failed":
      next.notice = event.message;
      break;
    case "mute-mic":
      next.micMuted = event.muted;
      effects.push({ type: "set-mic", enabled: !event.muted });
      if (event.muted && next.userSpeaking) {
        next.userSpeaking = false;
        effects.push({ type: "discard-utterance" });
      }
      break;
    case "mute-speaker":
      next.speakerMuted = event.muted;
      if (event.muted && next.speaking) {
        next.speaking = false;
        effects.push({ type: "stop-speech" });
      }
      break;
    case "hang-up":
      return { state: { ...next, phase: "ended", endedAt: now, speaking: false, userSpeaking: false }, effects: [{ type: "stop-speech" }, { type: "release" }] };
  }
  next.phase = phaseOf(next);
  return { state: next, effects };
}

/** What the call view says it is doing. "Summarizing memory…" while the bot's turn waits on its memory. */
export function callStatusLabel(state: CallState, summarizing = false): string {
  switch (state.phase) {
    case "connecting": return "Waiting for the microphone…";
    case "listening": return state.micMuted ? "Microphone muted" : "Listening";
    case "hearing": return "Hearing you…";
    case "transcribing": return "Transcribing…";
    case "thinking": return summarizing ? "Summarizing memory…" : state.tool ? `Using ${state.tool}…` : "Thinking…";
    case "speaking": return "Speaking";
    case "ended": return "Call ended";
    case "failed": return "Call failed";
  }
}

/* ── the call ──────────────────────────────────────────────────────────── */

export type CallMicrophone = { sampleRate: number; setEnabled(enabled: boolean): void; close(): void };

/** A message of the bot's chat, as its snapshot lists it. */
export type CallMessage = { role: "user" | "assistant"; text: string };

export type CallSessionHandlers = {
  /** The chat's status: running, waiting and starting are busy. */
  onBusy(busy: boolean): void;
  /** Its live events: text, turn_start, settled, tool_start, tool_end. */
  onEvent(event: RuntimeEvent): void;
  /** Its messages whenever the stream sends them whole (it attached, came back after a drop, or refreshed). */
  onMessages(messages: readonly CallMessage[]): void;
};

export type CallPlatform = {
  /** Asks for the microphone (the call was started by a click) and streams its frames. */
  openMicrophone(onFrame: (frame: Float32Array) => void): Promise<CallMicrophone>;
  transcribe(audio: Float32Array, sampleRate: number): Promise<string>;
  send(text: string, mode: "prompt" | "steer"): Promise<CallDelivery>;
  watch(handlers: CallSessionHandlers): () => void;
  synthesize(text: string, signal: AbortSignal): Promise<Blob>;
  play(audio: Blob, signal: AbortSignal): Promise<void>;
  setTimer(callback: () => void, ms: number): () => void;
  now(): number;
};

export type VoiceCallOptions = {
  vad?: Partial<Omit<VadOptions, "sampleRate">>;
  /** How long a sent utterance may wait with the chat idle and nothing started before the call listens again. */
  replyTimeoutMs?: number;
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export class VoiceCall {
  readonly #platform: CallPlatform;
  readonly #options: VoiceCallOptions;
  readonly #listeners = new Set<(state: CallState) => void>();
  readonly #queue: SpeechQueue;
  readonly #chunker = new SpeechChunker();
  #state: CallState;
  #microphone: CallMicrophone | undefined;
  #vad: VoiceActivityDetector | undefined;
  #unwatch: (() => void) | undefined;
  /** Utterances are transcribed side by side but reach the chat in the order they were said. */
  #order: Promise<void> = Promise.resolve();
  /** The reply text of the current turn, as streamed. */
  #reply = "";
  /** What the call last put in the chat, as the chat shows it (`[voice] …`): its reply follows it there. */
  #sent = "";
  /** After a barge-in the interrupted turn stays silent: until what interrupted it is sent and a new turn starts. */
  #ignoring: false | "interrupted" | "until-next-turn" = false;
  #cancelTimer: (() => void) | undefined;
  /** The microphone's latest frame level, for the bot's face; never part of the state, so it costs no render. */
  #micLevel = 0;
  #micLevelAt = Number.NEGATIVE_INFINITY;

  constructor(platform: CallPlatform, options: VoiceCallOptions = {}) {
    this.#platform = platform;
    this.#options = options;
    this.#state = initialCallState(platform.now());
    this.#queue = new SpeechQueue({
      synthesize: (text, signal) => platform.synthesize(text, signal),
      play: (audio, signal) => platform.play(audio, signal),
      onState: (queue) => this.#dispatch({ type: "speaking", speaking: queue.speaking }),
      onError: (error) => this.#dispatch({ type: "speech-failed", message: message(error, "The bot's voice could not be played.") }),
    });
  }

  get state(): CallState {
    return this.#state;
  }

  /** The microphone's level (0–1) over its latest frame: 0 while muted, after the call, or once frames stop for 250 ms. */
  get micLevel(): number {
    if (this.#state.micMuted || terminal(this.#state.phase) || this.#platform.now() - this.#micLevelAt > 250) return 0;
    return this.#micLevel;
  }

  onChange(listener: (state: CallState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<void> {
    this.#unwatch = this.#platform.watch({
      onBusy: (busy) => this.#dispatch({ type: "bot-busy", busy }),
      onEvent: (event) => this.#onSessionEvent(event),
      onMessages: (messages) => this.#onMessages(messages),
    });
    let microphone: CallMicrophone;
    try {
      microphone = await this.#platform.openMicrophone((frame) => this.#onFrame(frame));
    } catch (error) {
      this.#dispatch({ type: "mic-failed", message: message(error, "The microphone could not be opened.") });
      return;
    }
    if (terminal(this.#state.phase)) {
      microphone.close();
      return;
    }
    this.#microphone = microphone;
    this.#vad = new VoiceActivityDetector({ ...this.#options.vad, sampleRate: microphone.sampleRate });
    this.#dispatch({ type: "mic-ready" });
  }

  hangUp(): void {
    this.#dispatch({ type: "hang-up" });
  }

  setMicMuted(muted: boolean): void {
    this.#dispatch({ type: "mute-mic", muted });
  }

  setSpeakerMuted(muted: boolean): void {
    this.#dispatch({ type: "mute-speaker", muted });
  }

  #onFrame(frame: Float32Array): void {
    const vad = this.#vad;
    if (!vad || this.#state.micMuted || terminal(this.#state.phase)) return;
    this.#micLevel = frameLevel(frame);
    this.#micLevelAt = this.#platform.now();
    vad.bargeIn = this.#state.speaking;
    for (const event of vad.push(frame)) {
      if (event.type === "start") this.#dispatch({ type: "speech-start" });
      else if (event.type === "cancel") this.#dispatch({ type: "speech-cancel" });
      else this.#utterance(event.audio, this.#microphone?.sampleRate ?? vad.options.sampleRate);
    }
  }

  #utterance(audio: Float32Array, sampleRate: number): void {
    this.#dispatch({ type: "speech-end" });
    const text = this.#platform.transcribe(audio, sampleRate);
    text.catch(() => undefined);
    this.#order = this.#order.then(async () => {
      try {
        this.#dispatch({ type: "transcribed", text: await text });
      } catch (error) {
        this.#dispatch({ type: "transcription-failed", message: message(error, "VoiceStudio could not transcribe that.") });
      }
    });
  }

  #onSessionEvent(event: RuntimeEvent): void {
    if (terminal(this.#state.phase)) return;
    switch (event.type) {
      case "text": {
        if (!this.#state.awaitingReply || this.#ignoring) return;
        this.#reply += event.delta;
        this.#dispatch({ type: "bot-text", text: speakableText(this.#reply) });
        for (const chunk of this.#chunker.push(event.delta)) this.#speak(chunk);
        return;
      }
      case "turn_start":
        if (this.#ignoring === "until-next-turn") this.#ignoring = false;
        this.#dispatch({ type: "turn-start" });
        return;
      case "settled":
        this.#dispatch({ type: "settled" });
        // A turn that ended interrupted, with nothing sent after it, keeps its silence; the next one speaks.
        if (!this.#state.awaitingReply) this.#ignoring = false;
        return;
      case "tool_start":
        this.#dispatch({ type: "tool", name: event.name });
        return;
      case "tool_end":
        this.#dispatch({ type: "tool" });
        return;
      default:
        return;
    }
  }

  /**
   * The chat as a whole, when the stream attaches late or comes back after a drop: a reply to what the call sent
   * whose live text (or end) never arrived is said from the chat, after what was already said of it, and an idle
   * chat ends the wait.
   */
  #onMessages(messages: readonly CallMessage[]): void {
    if (terminal(this.#state.phase) || !this.#state.awaitingReply || this.#ignoring || !this.#sent) return;
    // Only the chat's latest user message: an older one with the same words has an older answer.
    let at = messages.length - 1;
    while (at >= 0 && messages[at]!.role !== "user") at--;
    if (at < 0 || messages[at]!.text.trim() !== this.#sent.trim()) return;
    const reply = messages.slice(at + 1).filter((message) => message.role === "assistant").map((message) => message.text).join("\n\n");
    if (!reply.trim()) return;
    if (reply.startsWith(this.#reply) && reply.length > this.#reply.length) this.#onSessionEvent({ type: "text", delta: reply.slice(this.#reply.length) });
    if (!this.#state.botBusy && this.#state.awaitingReply) this.#onSessionEvent({ type: "settled" });
  }

  #speak(chunk: string): void {
    if (!this.#state.speakerMuted && !terminal(this.#state.phase)) this.#queue.enqueue(chunk);
  }

  #dispatch(event: CallEvent): void {
    const { state, effects } = reduceCall(this.#state, event, this.#platform.now());
    const changed = state !== this.#state;
    this.#state = state;
    for (const effect of effects) this.#run(effect);
    this.#watchReply();
    if (changed) for (const listener of this.#listeners) listener(this.#state);
  }

  #run(effect: CallEffect): void {
    switch (effect.type) {
      case "send": {
        if (this.#ignoring === "interrupted") this.#ignoring = "until-next-turn";
        // The caption starts again with the new words; a sentence the turn is halfway through still gets said.
        this.#reply = "";
        this.#sent = effect.text;
        void this.#platform.send(effect.text, effect.mode).then(
          (delivery) => this.#dispatch({ type: "delivered", delivery }),
          (error: unknown) => this.#dispatch({ type: "send-failed", message: message(error, "The message could not be sent to the chat.") }),
        );
        return;
      }
      case "stop-speech":
        this.#queue.stop();
        return;
      case "interrupt":
        this.#chunker.reset();
        this.#reply = "";
        if (this.#state.botBusy) this.#ignoring = "interrupted";
        return;
      case "flush-reply": {
        const rest = this.#chunker.flush();
        if (!this.#ignoring) for (const chunk of rest) this.#speak(chunk);
        this.#ignoring = false;
        this.#reply = "";
        return;
      }
      case "set-mic":
        this.#microphone?.setEnabled(effect.enabled);
        return;
      case "discard-utterance":
        this.#vad?.reset();
        return;
      case "release":
        this.#cancelTimer?.();
        this.#cancelTimer = undefined;
        this.#unwatch?.();
        this.#unwatch = undefined;
        this.#microphone?.close();
        this.#microphone = undefined;
        this.#vad = undefined;
        return;
    }
  }

  /** A sent utterance that starts nothing (a lost race, a refused turn) must not leave the call thinking forever. */
  #watchReply(): void {
    const state = this.#state;
    const stalled = !terminal(state.phase) && state.awaitingReply && !state.replyStarted && !state.botBusy && !state.speaking && state.transcribing === 0;
    if (!stalled) {
      this.#cancelTimer?.();
      this.#cancelTimer = undefined;
      return;
    }
    this.#cancelTimer ??= this.#platform.setTimer(() => {
      this.#cancelTimer = undefined;
      const now = this.#state;
      if (now.awaitingReply && !now.replyStarted && !now.botBusy) this.#dispatch({ type: "reply-timeout" });
    }, this.#options.replyTimeoutMs ?? 8_000);
  }
}
