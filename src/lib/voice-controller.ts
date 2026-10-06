/**
 * The app's voice (HUI-18): whether VoiceStudio is connected, the one
 * read-aloud and the one call, run by GPT-Live (live-call.ts) or by
 * VoiceStudio's speech chain (voice-call.ts) as Settings → Models → Calls
 * says. The top-level app owns it and renders slices of it; a call outlives
 * navigating away from its bot (its bar stays in sight). Browser capabilities
 * are injected, so the rules run under test.
 */
import type { CallEngine } from "../../shared/calls.ts";
import type { SpeechRequest, VoiceConnection } from "../../shared/voice.ts";
import { LiveCall, type LiveCallPlatform } from "./live-call.ts";
import { VoiceCall, type CallPlatform, type CallView } from "./voice-call.ts";
import { ReadAloud, type ReadAloudState } from "./voice-reader.ts";

export type CallBot = { id: string; sessionId: string; name: string };
export type ActiveCall = { bot: CallBot; state: CallView; minimized: boolean; engine: CallEngine };

/** What a call engine offers the controller. */
export type CallSession = {
  readonly state: CallView;
  /** The microphone's level (0–1), read every frame by the bot's face. */
  readonly micLevel: number;
  /** The bot's voice's level, when the engine measures it itself (GPT-Live). */
  readonly voiceLevel?: number;
  onChange(listener: (state: CallView) => void): () => void;
  start(): Promise<void>;
  /** `leaving`: the page is going away. */
  hangUp(leaving?: boolean): void;
  setMicMuted(muted: boolean): void;
  setSpeakerMuted(muted: boolean): void;
};

export type VoiceControllerDeps = {
  loadConnection(): Promise<VoiceConnection>;
  synthesize(request: SpeechRequest, signal: AbortSignal): Promise<Blob>;
  play(audio: Blob, signal: AbortSignal): Promise<void>;
  /** The bot's voice's level where it plays now (0–1), undefined while unmeasured; the face of a speaking bot follows it. */
  voiceLevel?(): number | undefined;
  platform(bot: CallBot): CallPlatform;
  /** A GPT-Live call's capabilities (live-call-platform.ts). */
  livePlatform?(bot: CallBot): LiveCallPlatform;
  now(): number;
  setInterval(callback: () => void, ms: number): () => void;
};

export class VoiceController {
  connection: VoiceConnection | undefined;
  connectionError = "";
  readAloud: ReadAloudState = { id: "", status: "idle" };
  call: ActiveCall | undefined;
  /** Ticks every second during a call, for its timer. */
  now: number;
  readonly #host: { requestUpdate(): void };
  readonly #deps: VoiceControllerDeps;
  readonly #reader: ReadAloud;
  #request: Omit<SpeechRequest, "text"> = {};
  #loading: Promise<void> | undefined;
  #session: CallSession | undefined;
  #stopTicking: (() => void) | undefined;

  constructor(host: { requestUpdate(): void }, deps: VoiceControllerDeps) {
    this.#host = host;
    this.#deps = deps;
    this.now = deps.now();
    this.#reader = new ReadAloud({
      synthesize: (text, signal) => deps.synthesize({ ...this.#request, text }, signal),
      play: (audio, signal) => deps.play(audio, signal),
      onChange: (state) => {
        this.readAloud = state;
        host.requestUpdate();
      },
    });
  }

  /** VoiceStudio is connected: bot chats offer voice notes, Read aloud and Call. */
  get available(): boolean {
    return this.connection?.configured === true;
  }

  /** Reads the connection once (again with `force`); a read under way is shared. */
  loadConnection(force = false): Promise<void> {
    if (this.#loading) return this.#loading;
    if (this.connection && !force) return Promise.resolve();
    this.#loading = this.#deps.loadConnection().then(
      (connection) => {
        this.connection = connection;
        this.connectionError = "";
      },
      (error: unknown) => {
        this.connectionError = error instanceof Error ? error.message : "The VoiceStudio connection could not be read.";
      },
    ).finally(() => {
      this.#loading = undefined;
      this.#host.requestUpdate();
    });
    return this.#loading;
  }

  /** What Settings just saved or removed. */
  setConnection(connection: VoiceConnection): void {
    this.connection = connection;
    this.connectionError = "";
    if (!connection.configured) this.#reader.stop();
    this.#host.requestUpdate();
  }

  /** Reads a bot's message, or a voice preview, aloud: one at a time, and not over a call. */
  read(id: string, text: string, request: Omit<SpeechRequest, "text">): void {
    if (this.call) {
      this.readAloud = { id: "", status: "idle", error: "Hang up the call to hear messages read aloud." };
      this.#host.requestUpdate();
      return;
    }
    this.#request = request;
    this.#reader.read(id, text);
  }

  stopReading(): void {
    this.#reader.stop();
  }

  /** The call's microphone level (0–1): what the bot's face hears while it listens. Read every frame, never rendered. */
  micLevel(): number {
    return this.call ? this.#session?.micLevel ?? 0 : 0;
  }

  /** The bot's voice's level (0–1) while it speaks in the call; undefined while unmeasured. */
  voiceLevel(): number | undefined {
    if (!this.call) return 0;
    return this.call.engine === "gpt-live" ? this.#session?.voiceLevel : this.#deps.voiceLevel?.();
  }

  /** Calls a bot, or brings its call back. Another bot's call must be hung up first (false). */
  startCall(bot: CallBot, engine: CallEngine = "voicestudio"): boolean {
    if (this.call) {
      if (this.call.bot.id !== bot.id) return false;
      this.call = { ...this.call, minimized: false };
      this.#host.requestUpdate();
      return true;
    }
    const livePlatform = this.#deps.livePlatform;
    if (engine === "gpt-live" && !livePlatform) throw new Error("GPT-Live calls need their platform.");
    this.#reader.stop();
    const session: CallSession = engine === "gpt-live" && livePlatform
      ? new LiveCall(livePlatform(bot), { botName: bot.name })
      : new VoiceCall(this.#deps.platform(bot));
    this.#session = session;
    this.call = { bot, state: session.state, minimized: false, engine };
    session.onChange((state) => {
      if (this.#session !== session || !this.call) return;
      // Hanging up returns to the chat at once; a failure stays on screen until it is read.
      if (state.phase === "ended") this.#endCall();
      else {
        this.call = { ...this.call, state };
        this.#host.requestUpdate();
      }
    });
    this.now = this.#deps.now();
    this.#stopTicking = this.#deps.setInterval(() => {
      this.now = this.#deps.now();
      this.#host.requestUpdate();
    }, 1_000);
    void session.start();
    this.#host.requestUpdate();
    return true;
  }

  hangUp(): void {
    if (this.#session && this.call?.state.phase !== "failed") this.#session.hangUp();
    else this.#endCall();
  }

  toggleMic(): void {
    if (this.call) this.#session?.setMicMuted(!this.call.state.micMuted);
  }

  toggleSpeaker(): void {
    if (this.call) this.#session?.setSpeakerMuted(!this.call.state.speakerMuted);
  }

  minimize(): void {
    if (!this.call) return;
    this.call = { ...this.call, minimized: true };
    this.#host.requestUpdate();
  }

  expand(): void {
    if (!this.call) return;
    this.call = { ...this.call, minimized: false };
    this.#host.requestUpdate();
  }

  /** Leaves a call that failed. */
  closeCall(): void {
    this.#endCall();
  }

  dispose(): void {
    this.#session?.hangUp(true);
    this.#endCall();
    this.#reader.stop();
  }

  #endCall(): void {
    this.#session = undefined;
    this.call = undefined;
    this.#stopTicking?.();
    this.#stopTicking = undefined;
    this.#host.requestUpdate();
  }
}
