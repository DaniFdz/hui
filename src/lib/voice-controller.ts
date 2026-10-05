/**
 * The app's voice (HUI-18): whether VoiceStudio is connected, the one
 * read-aloud and the one call. The top-level app owns it and renders slices
 * of it; a call outlives navigating away from its bot (its bar stays in
 * sight). Browser capabilities are injected, so the rules run under test.
 */
import type { SpeechRequest, VoiceConnection } from "../../shared/voice.ts";
import { VoiceCall, type CallPlatform, type CallState } from "./voice-call.ts";
import { ReadAloud, type ReadAloudState } from "./voice-reader.ts";

export type CallBot = { id: string; sessionId: string; name: string };
export type ActiveCall = { bot: CallBot; state: CallState; minimized: boolean };

export type VoiceControllerDeps = {
  loadConnection(): Promise<VoiceConnection>;
  synthesize(request: SpeechRequest, signal: AbortSignal): Promise<Blob>;
  play(audio: Blob, signal: AbortSignal): Promise<void>;
  platform(bot: CallBot): CallPlatform;
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
  #session: VoiceCall | undefined;
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

  /** Calls a bot, or brings its call back. Another bot's call must be hung up first (false). */
  startCall(bot: CallBot): boolean {
    if (this.call) {
      if (this.call.bot.id !== bot.id) return false;
      this.call = { ...this.call, minimized: false };
      this.#host.requestUpdate();
      return true;
    }
    this.#reader.stop();
    const session = new VoiceCall(this.#deps.platform(bot));
    this.#session = session;
    this.call = { bot, state: session.state, minimized: false };
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
    this.#session?.hangUp();
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
