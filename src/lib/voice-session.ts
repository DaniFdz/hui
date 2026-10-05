/**
 * A call's capabilities in the browser (HUI-18): the microphone through an
 * AudioWorklet, VoiceStudio through the gateway, the bot's chat through the
 * session API and its live stream. `VoiceCall` (voice-call.ts) holds the logic.
 */
import type { CallMessage, CallPlatform } from "./voice-call.ts";
import { microphoneContext, openCallMicrophone, utteranceWav, voicePlayer } from "./voice-audio.ts";
import { microphoneErrorMessage, sendBotMessage, synthesizeSpeech, transcribeRecording } from "./voice.ts";
import { steerSession, subscribeSession, type SessionStatus, type TranscriptEntry } from "./sessions-store.ts";

/** A chat that is running, waiting on a question or starting cannot take a prompt: what is said steers it. */
export function chatBusy(status: SessionStatus): boolean {
  return status === "running" || status === "waiting" || status === "starting";
}

/** A chat's messages, for a call that missed the live text of a reply (voice-call.ts). */
export function callMessages(transcript: readonly TranscriptEntry[]): CallMessage[] {
  return transcript.flatMap((entry) => entry.kind === "message" && !entry.pending && !entry.failed ? [{ role: entry.role, text: entry.text }] : []);
}

export function botCallPlatform(bot: { id: string; sessionId: string }): CallPlatform {
  return {
    openMicrophone: async (onFrame) => {
      try {
        return await openCallMicrophone(onFrame);
      } catch (error) {
        throw new Error(microphoneErrorMessage(error, microphoneContext()));
      }
    },
    transcribe: (audio, sampleRate) => transcribeRecording(utteranceWav(audio, sampleRate)),
    send: async (text, mode) => {
      if (mode === "steer") {
        try {
          await steerSession(bot.sessionId, text);
          return "steered";
        } catch {
          // The turn ended meanwhile: the bot route makes it a prompt (or queues it behind a new turn).
        }
      }
      return sendBotMessage(bot.id, text);
    },
    watch: (handlers) => subscribeSession(bot.sessionId, {
      onSnapshot: (snapshot) => {
        handlers.onBusy(chatBusy(snapshot.status));
        handlers.onMessages(callMessages(snapshot.transcript));
      },
      onStatus: (status) => handlers.onBusy(chatBusy(status)),
      onEvent: (event) => handlers.onEvent(event),
      onTranscript: (transcript) => handlers.onMessages(callMessages(transcript)),
      onModel: () => undefined,
      onThinking: () => undefined,
      onConnection: () => undefined,
    }),
    synthesize: (text, signal) => synthesizeSpeech({ text, botId: bot.id }, signal),
    play: (audio, signal) => voicePlayer().play(audio, signal),
    setTimer: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    now: () => Date.now(),
  };
}
