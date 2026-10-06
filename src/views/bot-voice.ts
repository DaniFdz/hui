/**
 * Talking to bots (HUI-18), rendering only: the composer's voice-note controls,
 * the read-aloud and call buttons, the call view and its minimized bar. State
 * and actions come from props owned by `hui-app.ts` (src/lib/voice*.ts holds
 * the logic).
 */
import { html, nothing, svg, type SVGTemplateResult, type TemplateResult } from "lit";
import { icons } from "../lib/icons.ts";
import type { BotView } from "../lib/bots.ts";
import { callStatusLabel, type CallState } from "../lib/voice-call.ts";
import { formatCallTime, type VoiceNoteState } from "../lib/voice.ts";
import { renderBotAvatar } from "./bots.ts";
import { callFaceState } from "../lib/bot-face.ts";
import { botLook } from "../../shared/bots.ts";

// Node's focused view tests import views without a CSS loader.
if (typeof document !== "undefined") {
  await import("../styles/voice.css");
}

// Lucide geometry (ISC) for controls the pinned OpenClaw icon set lacks.
function lucide(body: SVGTemplateResult): TemplateResult {
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const voiceIcons = {
  mic: lucide(svg`<path d="M12 19v3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><rect x="9" y="2" width="6" height="13" rx="3" />`),
  micOff: lucide(svg`<path d="M2 2l20 20" /><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" /><path d="M5 10v2a7 7 0 0 0 12 5" /><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12" /><path d="M12 19v3" />`),
  phone: lucide(svg`<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />`),
  phoneOff: lucide(svg`<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" /><path d="M22 2 2 22" />`),
  volume: lucide(svg`<path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />`),
  volumeOff: lucide(svg`<path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" />`),
  minimize: lucide(svg`<path d="M4 14h6v6" /><path d="M20 10h-6V4" /><path d="m14 10 7-7" /><path d="m3 21 7-7" />`),
};

/* ── composer: voice notes ── */

/** The microphone button beside Send; it becomes Stop while a note records. */
export function renderVoiceNoteButton(note: VoiceNoteState, disabled: boolean, actions: { onStart: () => void; onStop: () => void }) {
  if (note.status === "recording" || note.status === "starting") {
    return html`<button type="button" class="chat-voice-btn chat-voice-btn--recording" aria-label="Stop and transcribe the voice note" title="Stop and transcribe"
      ?disabled=${note.status === "starting"} @click=${actions.onStop}>${icons.stop}</button>`;
  }
  if (note.status === "transcribing") {
    return html`<button type="button" class="chat-voice-btn" aria-label="Transcribing the voice note" disabled><span class="btn__spinner"></span></button>`;
  }
  return html`<button type="button" class="chat-voice-btn" aria-label="Record a voice note" title="Voice note" ?disabled=${disabled} @click=${actions.onStart}>${voiceIcons.mic}</button>`;
}

/** The note's state above the composer: recording time and Cancel, transcribing, or why it failed. */
export function renderVoiceNoteStatus(note: VoiceNoteState, now: number, actions: { onStop: () => void; onCancel: () => void; onDismiss: () => void }) {
  switch (note.status) {
    case "starting":
      return html`<div class="chat-voice-note" role="status"><span class="chat-voice-note__dot"></span><span class="chat-voice-note__label">Waiting for the microphone…</span>
        <button type="button" class="btn btn--sm btn--ghost" @click=${actions.onCancel}>Cancel</button></div>`;
    case "recording":
      return html`<div class="chat-voice-note" role="status"><span class="chat-voice-note__dot chat-voice-note__dot--live" aria-hidden="true"></span>
        <span class="chat-voice-note__label">Recording a voice note</span><time class="chat-voice-note__time">${formatCallTime(now - note.startedAt)}</time>
        <span class="chat-voice-note__actions"><button type="button" class="btn btn--sm btn--ghost" @click=${actions.onCancel}>Cancel</button>
        <button type="button" class="btn btn--sm primary" @click=${actions.onStop}>Done</button></span></div>`;
    case "transcribing":
      return html`<div class="chat-voice-note" role="status"><span class="btn__spinner" aria-hidden="true"></span><span class="chat-voice-note__label">Transcribing with VoiceStudio…</span></div>`;
    case "error":
      return html`<div class="chat-voice-note chat-voice-note--error" role="alert"><span class="chat-voice-note__label">${note.message}</span>
        <button type="button" class="btn btn--sm btn--ghost" @click=${actions.onDismiss}>Dismiss</button></div>`;
    default:
      return nothing;
  }
}

/* ── bot header ── */

export function renderCallButton(options: { botName: string; inCall: boolean; onCall: () => void }) {
  return html`<button type="button" class="btn btn--ghost btn--icon chat-icon-btn bot-call-toggle ${options.inCall ? "bot-call-toggle--active" : ""}"
    aria-label=${options.inCall ? `Return to the call with ${options.botName}` : `Call ${options.botName}`} title=${options.inCall ? "Return to the call" : "Call"}
    @click=${options.onCall}>${voiceIcons.phone}</button>`;
}

/* ── the call ── */

export type CallViewProps = {
  bot: Pick<BotView, "id" | "name" | "title" | "avatar">;
  state: CallState;
  now: number;
  /** The bot's turn waits on its memory ("Summarizing memory…"). */
  summarizing: boolean;
  /** The audio level (0–1) the face follows: the microphone while it listens, the bot's voice while it speaks. */
  level?: () => number | undefined;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onMinimize: () => void;
  onExpand: () => void;
  onHangUp: () => void;
  /** Leaves a call that failed. */
  onClose: () => void;
};

const elapsed = (props: CallViewProps) => formatCallTime((props.state.endedAt ?? props.now) - props.state.startedAt);

export function renderCallView(props: CallViewProps) {
  const { state, bot } = props;
  const failed = state.phase === "failed";
  const time = elapsed(props);
  const look = botLook(bot);
  // The call takes the bot's color, as Dots' call screen does; a face's eyes follow the pointer anywhere in it.
  return html`<section class="bot-call" data-phase=${state.phase} role="region" aria-label=${`Call with ${bot.name}`} style=${`--bot-color: ${look.color}`} data-face-stage
    @keydown=${(event: KeyboardEvent) => {
      if (event.key !== "Escape" || failed || event.defaultPrevented) return;
      event.preventDefault();
      props.onMinimize();
    }}>
    <header class="bot-call__header">
      <span class="bot-call__badge">${voiceIcons.phone}<span>Voice call</span></span>
      <time class="bot-call__timer" role="timer" aria-label=${`Call time ${time}`}>${time}</time>
      ${failed ? nothing : html`<button type="button" class="btn btn--ghost btn--icon chat-icon-btn bot-call__minimize" aria-label="Minimize the call" title="Minimize" @click=${props.onMinimize}>${voiceIcons.minimize}</button>`}
    </header>
    <div class="bot-call__stage">
      <div class="bot-call__orb ${look.kind === "face" ? "bot-call__orb--face" : ""}" data-phase=${state.phase}>${renderBotAvatar(bot, "xl", { state: callFaceState(state, props.summarizing), ...(props.level ? { level: props.level } : {}) })}</div>
      <h2 class="bot-call__name">${bot.name}</h2>
      <p class="bot-call__status" role="status" aria-live="polite">${callStatusLabel(state, props.summarizing)}</p>
    </div>
    <div class="bot-call__captions">
      <div class="bot-call__caption bot-call__caption--you"><span class="bot-call__speaker">You</span>
        <p class="bot-call__line" data-empty=${String(!state.you)}>${state.you || "Speak when you're ready; pause when you're done."}</p></div>
      <div class="bot-call__caption bot-call__caption--bot" aria-live="polite"><span class="bot-call__speaker">${bot.name}</span>
        <p class="bot-call__line" data-empty=${String(!state.bot)}>${state.bot || "…"}</p></div>
    </div>
    ${state.notice && !failed ? html`<p class="bot-call__notice" role="status">${state.notice}</p>` : nothing}
    ${failed ? html`<p class="bot-call__error" role="alert">${state.error}</p>` : nothing}
    <div class="bot-call__controls" role="toolbar" aria-label="Call controls">
      ${failed ? html`<button type="button" class="btn bot-call__close" @click=${props.onClose}>Back to the chat</button>` : html`
        <button type="button" class="bot-call__control" aria-pressed=${String(state.micMuted)} aria-label="Mute microphone" @click=${props.onToggleMic}>
          ${state.micMuted ? voiceIcons.micOff : voiceIcons.mic}<span>${state.micMuted ? "Muted" : "Mute"}</span></button>
        <button type="button" class="bot-call__control" aria-pressed=${String(state.speakerMuted)} aria-label="Mute speaker" @click=${props.onToggleSpeaker}>
          ${state.speakerMuted ? voiceIcons.volumeOff : voiceIcons.volume}<span>${state.speakerMuted ? "Speaker off" : "Speaker"}</span></button>
        <button type="button" class="bot-call__control bot-call__control--hangup" aria-label="Hang up" @click=${props.onHangUp}>${voiceIcons.phoneOff}<span>Hang up</span></button>`}
    </div>
    <p class="bot-call__privacy">Audio goes only to your VoiceStudio. What is said stays in ${bot.name}'s chat.</p>
  </section>`;
}

/** The minimized call: a bar that keeps the call in sight over the chat or anywhere else in HUI. */
export function renderCallBar(props: CallViewProps & { floating: boolean }) {
  const { state, bot } = props;
  return html`<div class="bot-call-bar ${props.floating ? "bot-call-bar--floating" : ""}" data-phase=${state.phase} role="region" aria-label=${`Call with ${bot.name}, minimized`}>
    <button type="button" class="bot-call-bar__open" aria-label=${`Return to the call with ${bot.name}`} @click=${props.onExpand}>
      ${renderBotAvatar(bot, "sm", { state: callFaceState(state, props.summarizing) })}
      <span class="bot-call-bar__pulse" aria-hidden="true"></span>
      <span class="bot-call-bar__name">${bot.name}</span>
      <span class="bot-call-bar__status">${callStatusLabel(state, props.summarizing)}</span>
      <time class="bot-call-bar__time">${elapsed(props)}</time>
    </button>
    <button type="button" class="bot-call-bar__button" aria-pressed=${String(state.micMuted)} aria-label="Mute microphone" title=${state.micMuted ? "Unmute" : "Mute"} @click=${props.onToggleMic}>
      ${state.micMuted ? voiceIcons.micOff : voiceIcons.mic}</button>
    <button type="button" class="bot-call-bar__button bot-call-bar__button--hangup" aria-label="Hang up" title="Hang up" @click=${props.onHangUp}>${voiceIcons.phoneOff}</button>
  </div>`;
}
