/**
 * The out-of-process extension protocol: newline-delimited JSON frames over the child's stdio, one protocol version,
 * a ready handshake and call/stream frames with cancel. Every frame line starts with `EXT ` so an extension's own
 * `console.log` cannot be mistaken for protocol traffic.
 */
export const EXTENSION_PROTOCOL_VERSION = 1;
export const FRAME_PREFIX = "EXT ";
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const CALL_TIMEOUT_MS = 30_000;
export const MAX_PROCESS_EXTENSIONS = 8;
export const CRASH_LIMIT = 3;
export const CRASH_WINDOW_MS = 5 * 60_000;
export const RESTART_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

export type HostRoute = {
  method: string;
  path: string;
  description: string;
  stream: boolean;
};

export type HostPromptSection = { id: string; title: string; text: string };

export type HostFrame =
  | { t: "ready"; protocol: number; apiVersion: number; routes: readonly HostRoute[]; prompt?: readonly HostPromptSection[] }
  | { t: "failed"; error: string }
  | { t: "result"; id: number; status: number; body: unknown }
  | { t: "event"; id: number; event: unknown }
  | { t: "end"; id: number }
  | { t: "error"; id: number; error: string }
  | { t: "log"; line: string }
  | { t: "context"; id: number; capability: string; args?: unknown };

export type ParentFrame =
  | { t: "call"; id: number; method: string; path: string; body?: unknown }
  | { t: "stream"; id: number; method: string; path: string; body?: unknown }
  | { t: "cancel"; id: number }
  | { t: "stop" }
  | { t: "context-result"; id: number; value?: unknown; error?: string };

export type Frame = HostFrame | ParentFrame;

/** One frame as a prefixed line; JSON.stringify never emits a raw newline. */
export function encodeFrame(frame: Frame): string {
  return `${FRAME_PREFIX}${JSON.stringify(frame)}\n`;
}

/** The frame a prefixed line carries, or undefined for an extension's own output or a malformed line. */
export function decodeFrame(line: string): Frame | undefined {
  if (!line.startsWith(FRAME_PREFIX) || Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) return undefined;
  try {
    const parsed = JSON.parse(line.slice(FRAME_PREFIX.length)) as unknown;
    return typeof parsed === "object" && parsed !== null && typeof (parsed as { t?: unknown }).t === "string" ? parsed as Frame : undefined;
  } catch {
    return undefined;
  }
}
