/**
 * Bots' animated faces (HUI-18), the pure half: what a face shows for a bot's
 * roster entry, its open chat and its call, and the geometry and colors of
 * the face itself, ported from the prototype the owner approved on
 * 2026-10-06 (OpenAI Dots: a plush shape, two dot eyes, no mouth).
 * `<hui-bot-face>` (src/components/bot-face.ts) draws it.
 */
import type { BotFaceShape } from "../../shared/bots.ts";
import type { BotView } from "./bots.ts";
import { botActivity } from "./bot-roster.ts";
import type { CallView } from "./live-call.ts";
import type { SessionStatus, TranscriptItem } from "./sessions-store.ts";

/* ── states ───────────────────────────────────────────────────────────── */

export const BOT_FACE_STATES = ["idle", "thinking", "working", "speaking", "listening", "waiting", "memory", "error", "done", "offline"] as const;
export type BotFaceState = (typeof BOT_FACE_STATES)[number];

/** What each state means, in the prototype's words. Faces are decorative: the
 * views keep their own status text, so these name the states in tests and docs. */
export const BOT_FACE_STATE_LABELS: Readonly<Record<BotFaceState, string>> = {
  idle: "Idle",
  thinking: "Thinking…",
  working: "Using tools…",
  speaking: "Speaking",
  listening: "Listening…",
  waiting: "Needs your answer",
  memory: "Summarizing memory…",
  error: "Something went wrong",
  done: "Done",
  offline: "Offline",
};

export function isBotFaceState(value: unknown): value is BotFaceState {
  return typeof value === "string" && (BOT_FACE_STATES as readonly string[]).includes(value);
}

/** Small for roster rows and the call bar, medium for the chat header, large
 * for the empty chat, extra large for the call. */
export const BOT_FACE_SIZES = ["sm", "md", "lg", "xl"] as const;
export type BotFaceSize = (typeof BOT_FACE_SIZES)[number];

/** Only the large faces follow the pointer, morph and take an audio level. */
export function isLiveFaceSize(size: BotFaceSize): boolean {
  return size === "lg" || size === "xl";
}

/** A roster entry knows only the bot's view: a running turn reads as thinking. */
export function rosterFaceState(bot: Pick<BotView, "status" | "memory" | "archived">): BotFaceState {
  if (bot.archived) return "offline";
  switch (botActivity(bot)) {
    case "waiting": return "waiting";
    case "error": return "error";
    case "away": return "offline";
    case "summarizing": return "memory";
    case "running": return "thinking";
    case "idle": return "idle";
  }
}

export type ChatFaceInput = {
  status: SessionStatus;
  /** A turn is in flight. */
  streaming: boolean;
  /** A question waits for the operator. */
  question: boolean;
  /** The turn waits for OptChat to summarize the newest messages. */
  memoryWaiting: boolean;
  /** A tool call of the current turn is running. */
  toolRunning: boolean;
  /** The last turn ended on an error nobody dismissed. */
  failed: boolean;
};

/** A bot's open chat sees more than its roster entry: a running tool and a failed turn. */
export function chatFaceState(input: ChatFaceInput): BotFaceState {
  if (input.question || input.status === "waiting") return "waiting";
  if (input.status === "error") return "error";
  if (input.status === "reconnecting" || input.status === "disconnected") return "offline";
  if (input.memoryWaiting) return "memory";
  if (input.streaming || input.status === "running" || input.status === "starting") return input.toolRunning ? "working" : "thinking";
  if (input.failed) return "error";
  return "idle";
}

/** A tool call of the latest turn (after the last user message) that is still running. */
export function hasRunningTool(transcript: readonly TranscriptItem[]): boolean {
  for (let index = transcript.length - 1; index >= 0; index--) {
    const item = transcript[index]!;
    if (item.kind === "tool" && item.status === "running") return true;
    if (item.kind === "message" && item.role === "user") return false;
  }
  return false;
}

/** A call: the bot listens while the microphone is open and speaks while its voice plays. */
export function callFaceState(call: Pick<CallView, "phase" | "micMuted" | "tool">, summarizing = false): BotFaceState {
  switch (call.phase) {
    case "connecting": return "idle";
    case "listening": return call.micMuted ? "idle" : "listening";
    case "hearing": return "listening";
    case "thinking": return summarizing ? "memory" : call.tool ? "working" : "thinking";
    case "speaking": return "speaking";
    case "ended": return "offline";
    case "failed": return "error";
  }
}

/** Which audio moves the face during a call: the microphone while it listens, the bot's voice while it speaks. */
export function callLevelSource(state: BotFaceState): "microphone" | "voice" | undefined {
  return state === "listening" ? "microphone" : state === "speaking" ? "voice" : undefined;
}

/** A turn that ends plays the one-shot "done" hop before the face rests again. */
export function settlesWithDone(previous: BotFaceState, next: BotFaceState): boolean {
  return next === "idle" && (previous === "thinking" || previous === "working" || previous === "memory");
}

/* ── expression ───────────────────────────────────────────────────────── */

export type FaceEyes = "open" | "squint" | "wide" | "sad" | "closed" | "happy" | "sleepy";

export const FACE_EYES: Readonly<Record<BotFaceState, FaceEyes>> = {
  idle: "open", thinking: "squint", working: "squint", speaking: "open", listening: "wide",
  waiting: "open", memory: "sleepy", error: "sad", done: "happy", offline: "closed",
};

/** Eyes drawn as dots blink; lines and arcs do not. */
export function eyesBlink(eyes: FaceEyes): boolean {
  return eyes === "open" || eyes === "squint" || eyes === "wide" || eyes === "sad";
}

/** Where the eyes sit on each shape, in the 120×120 view box. */
export const FACE_EYE_POSITION: Readonly<Record<BotFaceShape, readonly [number, number]>> = {
  blob: [60, 63], round: [60, 62], triangle: [60, 77], heart: [60, 56], cookie: [60, 63],
};

/** Where each state rests its gaze (view-box units). */
export const FACE_GAZE: Readonly<Record<BotFaceState, readonly [number, number]>> = {
  idle: [0, 0], thinking: [5, -4.2], working: [1.5, 2.6], speaking: [0, 0], listening: [0, -0.6],
  waiting: [3, -3.4], memory: [0, 1], error: [0, 1.6], done: [0, -1], offline: [0, 1],
};

/** States whose eyes follow the pointer; the others keep their own gaze. */
export const FACE_FOLLOWS_POINTER: ReadonlySet<BotFaceState> = new Set(["idle", "listening", "waiting", "speaking", "done"]);

/** The gaze and lean toward a pointer dx, dy pixels from the face's center, for a face width pixels wide. */
export function pointerGaze(dx: number, dy: number, width: number): { x: number; y: number; lean: number } {
  const length = Math.hypot(dx, dy) || 1;
  const reach = Math.min(1, length / (Math.max(1, width) * 0.9));
  return { x: round2((dx / length) * 6.5 * reach), y: round2((dy / length) * 4 * reach), lean: round2((dx / length) * reach * 3) };
}

/** The body's squash for an audio level (0–1): speaking stretches up, listening puffs out. */
export function levelSquash(state: BotFaceState, level: number): string {
  const amp = Math.max(0, Math.min(1, level));
  return state === "speaking"
    ? `scale(${round2(1 - amp * 0.05)},${round2(1 + amp * 0.09)})`
    : `scale(${round2(1.035 + amp * 0.02)},${round2(1.035 + amp * 0.035)})`;
}

/* ── geometry ─────────────────────────────────────────────────────────── */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A closed Catmull-Rom spline through the points, as cubic Béziers. */
function smoothPath(points: readonly (readonly [number, number])[]): string {
  const count = points.length;
  let d = `M${round2(points[0]![0])},${round2(points[0]![1])}`;
  for (let index = 0; index < count; index++) {
    const p0 = points[(index - 1 + count) % count]!;
    const p1 = points[index]!;
    const p2 = points[(index + 1) % count]!;
    const p3 = points[(index + 2) % count]!;
    d += `C${round2(p1[0] + (p2[0] - p0[0]) / 6)},${round2(p1[1] + (p2[1] - p0[1]) / 6)} ${round2(p2[0] - (p3[0] - p1[0]) / 6)},${round2(p2[1] - (p3[1] - p1[1]) / 6)} ${round2(p2[0])},${round2(p2[1])}`;
  }
  return `${d}Z`;
}

function polarPath(radius: (angle: number) => number, cy: number, squeeze = 1): string {
  const points: [number, number][] = [];
  for (let index = 0; index < 72; index++) {
    const angle = (index / 72) * Math.PI * 2;
    const r = radius(angle);
    points.push([60 + Math.cos(angle) * r, cy + Math.sin(angle) * r * squeeze]);
  }
  return smoothPath(points);
}

/** The body outline in the 120×120 view box. phase turns the blob's wobble (it morphs slowly on large faces). */
export function facePath(shape: BotFaceShape, phase = 0): string {
  if (shape === "blob") {
    return polarPath((a) => 37.5 * (1 + 0.038 * Math.sin(7 * a + phase) + 0.03 * Math.sin(3 * a - phase * 0.7) + 0.012 * Math.sin(11 * a + phase * 1.3)), 67);
  }
  if (shape === "round") return polarPath(() => 38.5, 66, 0.93);
  if (shape === "cookie") return polarPath((a) => 37 * (1 + 0.045 * Math.cos(10 * a)), 67);
  if (shape === "triangle") {
    // A triangle's polar radius blended with a circle (a superellipse-style cap), so the corners stay soft.
    const inradius = 27.5;
    const cap = 46.5;
    const start = -Math.PI / 2;
    const sector = (Math.PI * 2) / 3;
    return polarPath((a) => {
      const offset = (((a - start) % sector) + sector) % sector - sector / 2;
      const r = inradius / Math.cos(offset);
      return (r ** -6 + cap ** -6) ** (-1 / 6);
    }, 75);
  }
  const points: [number, number][] = [];
  for (let index = 0; index < 72; index++) {
    const t = (index / 72) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    // Pulled toward a circle, so the heart reads as plush rather than sharp.
    const r = Math.hypot(x, y) * 0.78 + 13.5 * 0.22;
    const angle = Math.atan2(y, x);
    points.push([60 + Math.cos(angle) * r * 2.55, 61 + Math.sin(angle) * r * 2.45]);
  }
  return smoothPath(points);
}

const HEX = /^#[0-9a-f]{6}$/iu;
const FALLBACK_COLOR = "#3a7bfa";

function channels(hex: string): [number, number, number] {
  const value = HEX.test(hex) ? hex : FALLBACK_COLOR;
  return [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255];
}

/** hex with its saturation and lightness scaled (HSL), as #rrggbb. */
export function faceTone(hex: string, saturation: number, lightness: number): string {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let l = (max + min) / 2;
  let s = 0;
  let h = 0;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  s *= saturation;
  l = Math.min(0.9, l * lightness);
  const hue = (p: number, q: number, t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return "#" + [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("");
}

/** The body's color in a state: muted after an error, almost grey offline. */
export function faceBodyColor(color: string, state: BotFaceState): string {
  if (state === "error") return faceTone(color, 0.55, 0.96);
  if (state === "offline") return faceTone(color, 0.12, 1.08);
  return HEX.test(color) ? color.toLowerCase() : FALLBACK_COLOR;
}

/** Relative luminance (WCAG) of #rrggbb. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Eye color: the prototype's near-black, or near-white on a body too dark for it (a custom color from the API). */
export function faceInk(color: string): string {
  return luminance(color) < 0.08 ? "#f4f4f4" : "#141414";
}

/* ── a stand-in voice ─────────────────────────────────────────────────── */

/**
 * The prototype's syllable rhythm: an audio-like level for a face that speaks
 * or listens without a measured one.
 * Quiet mode is softer and pauses more, like a room being listened to.
 */
export class SyllableLevel {
  readonly #random: () => number;
  #next = 0;
  #start = -1;
  #peak = 0;
  #length = 1;

  constructor(random: () => number = Math.random) {
    this.#random = random;
  }

  at(now: number, quiet = false): number {
    if (now >= this.#next) {
      const random = this.#random;
      this.#start = now;
      this.#peak = quiet ? 0.18 + random() * 0.35 : 0.45 + random() * 0.55;
      this.#length = quiet ? 90 + random() * 110 : 120 + random() * 150;
      this.#next = now + this.#length + (random() < (quiet ? 0.35 : 0.18) ? 380 + random() * 600 : 25 + random() * 70);
    }
    const t = now - this.#start;
    return t < 0 || t > this.#length ? 0 : this.#peak * Math.sin((Math.PI * t) / this.#length) ** 0.8;
  }
}
