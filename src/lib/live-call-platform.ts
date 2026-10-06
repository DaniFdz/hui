/**
 * A GPT-Live call's capabilities in the browser (HUI-18): the microphone with
 * echo cancellation, a native RTCPeerConnection carrying it to ChatGPT with
 * the call's data channel, the bot's voice on a hidden audio element, both
 * levels from analysers (for activity and the bot's face), and the gateway's
 * call routes. No dependencies; `LiveCall` (live-call.ts) holds the logic.
 */
import type { CallDelegationResult, CallLine, CallStarted, CallsStatus } from "../../shared/calls.ts";
import type { LiveCallPlatform, LiveConnection, LiveMicrophone } from "./live-call.ts";
import { subscribeSession } from "./sessions-store.ts";
import { CLIENT_HEADERS, fetchJson } from "./settings-store.ts";
import { trackedFetch } from "./ui-errors.ts";
import { microphoneContext } from "./voice-audio.ts";
import { frameLevel } from "./voice-level.ts";
import { microphoneErrorMessage } from "./voice.ts";

const JSON_HEADERS = { "content-type": "application/json" } as const;
const callsUrl = (botId: string, callId?: string, action?: string) =>
  `/__hui/bots/${encodeURIComponent(botId)}/calls${callId ? `/${encodeURIComponent(callId)}${action ? `/${action}` : ""}` : ""}`;

/** The ChatGPT login and the account calls use, for Settings and for offering Call. */
export function loadCallsStatus(): Promise<CallsStatus> {
  return fetchJson<CallsStatus>("/__hui/calls", { signal: AbortSignal.timeout(15_000) });
}

/** The gateway exchanges the offer with ChatGPT; the answer is all that comes back. */
export function startBotCall(botId: string, sdp: string, signal?: AbortSignal): Promise<CallStarted> {
  return fetchJson<CallStarted>(callsUrl(botId), { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sdp }), signal: signal ?? AbortSignal.timeout(45_000) });
}

/** The level (0–1) of what an analyser hears now. */
function analyserLevel(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  return frameLevel(buffer);
}

function analyse(context: AudioContext, stream: MediaStream): () => number {
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  return () => analyserLevel(analyser, buffer);
}

/** A GPT-Live call with one bot, through the gateway's call routes. */
export function liveCallPlatform(bot: { id: string; sessionId: string }): LiveCallPlatform {
  let context: AudioContext | undefined;
  let microphoneStream: MediaStream | undefined;
  const audio = () => (context ??= new AudioContext());
  return {
    async openMicrophone(): Promise<LiveMicrophone> {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (error) {
        throw new Error(microphoneErrorMessage(error, microphoneContext()));
      }
      const ctx = audio();
      await ctx.resume().catch(() => {});
      const level = analyse(ctx, stream);
      microphoneStream = stream;
      return {
        setEnabled: (enabled: boolean) => { for (const track of stream.getAudioTracks()) track.enabled = enabled; },
        level,
        close: () => { for (const track of stream.getTracks()) track.stop(); },
      };
    },

    async connect(_microphone, handlers): Promise<LiveConnection> {
      const stream = microphoneStream;
      if (!stream) throw new Error("The microphone is not open.");
      const peer = new RTCPeerConnection();
      const player = document.createElement("audio");
      player.autoplay = true;
      player.setAttribute("playsinline", "");
      player.dataset["huiCallAudio"] = "";
      player.hidden = true;
      document.body.append(player);
      let voiceLevel: () => number = () => 0;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        channel.close();
        peer.close();
        player.srcObject = null;
        player.remove();
        void context?.close().catch(() => {});
        context = undefined;
      };
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      const channel = peer.createDataChannel("oai-events");
      channel.addEventListener("open", () => handlers.onOpen());
      channel.addEventListener("message", (event) => handlers.onMessage(event.data));
      channel.addEventListener("close", () => { if (!closed) handlers.onLost("The call's connection to GPT-Live closed."); });
      peer.addEventListener("track", (event) => {
        const remote = event.streams[0] ?? new MediaStream([event.track]);
        player.srcObject = remote;
        void player.play().catch(() => {});
        // Chromium hands Web Audio a remote stream's samples only while a media element plays it too.
        voiceLevel = analyse(audio(), remote);
      });
      let lostTimer: ReturnType<typeof setTimeout> | undefined;
      peer.addEventListener("connectionstatechange", () => {
        if (closed) return;
        clearTimeout(lostTimer);
        if (peer.connectionState === "failed") handlers.onLost("The call's connection to GPT-Live failed.");
        // A brief network change can recover by itself.
        else if (peer.connectionState === "disconnected") lostTimer = setTimeout(() => { if (!closed && peer.connectionState !== "connected") handlers.onLost("The call's connection to GPT-Live was lost."); }, 5_000);
      });
      try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const started = await startBotCall(bot.id, offer.sdp ?? "");
        await peer.setRemoteDescription({ type: "answer", sdp: started.answer });
        return {
          callId: started.callId,
          voice: started.voice,
          send: (event) => {
            if (channel.readyState !== "open") return false;
            channel.send(JSON.stringify(event));
            return true;
          },
          level: () => voiceLevel(),
          setSpeakerMuted: (muted) => { player.muted = muted; },
          close,
        };
      } catch (error) {
        close();
        throw error;
      }
    },

    async delegate(callId, id, request, signal): Promise<CallDelegationResult> {
      return fetchJson<CallDelegationResult>(callsUrl(bot.id, callId, "delegations"), { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id, request }), signal });
    },

    async writeLines(callId, lines: readonly (CallLine & { at: number })[]) {
      await fetchJson(callsUrl(bot.id, callId, "lines"), { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ lines }), signal: AbortSignal.timeout(20_000) });
    },

    async heartbeat(callId) {
      await fetchJson(callsUrl(bot.id, callId, "heartbeat"), { method: "POST", signal: AbortSignal.timeout(10_000) });
    },

    async end(callId, leaving) {
      // A page going away keeps the request alive past it.
      await trackedFetch(callsUrl(bot.id, callId), { method: "DELETE", headers: CLIENT_HEADERS, cache: "no-store", ...(leaving ? { keepalive: true } : { signal: AbortSignal.timeout(10_000) }) });
    },

    watchTools(onTool) {
      return subscribeSession(bot.sessionId, {
        onSnapshot: () => undefined,
        onStatus: () => undefined,
        onEvent: (event) => {
          if (event.type === "tool_start") onTool(event.name);
          else if (event.type === "tool_end" || event.type === "settled") onTool(undefined);
        },
        onTranscript: () => undefined,
        onModel: () => undefined,
        onThinking: () => undefined,
        onConnection: () => undefined,
      });
    },

    setTimer: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    setInterval: (callback, ms) => {
      const timer = setInterval(callback, ms);
      return () => clearInterval(timer);
    },
    now: () => Date.now(),
  };
}
