/**
 * The terminal WebSocket's wire format, shared by the gateway transport and the browser pane. PTY output travels
 * as binary messages holding raw UTF-8 bytes, so control sequences are neither escaped nor JSON-encoded; JSON
 * text messages carry only metadata (snapshot, state, error) one way and input/resize the other. The replay of a
 * snapshot is the first binary message after it, sent only when `replayBytes` is not zero.
 */
import type { TerminalView } from "../src/lib/terminal-types.ts";

/** Starts a (re)connection: the emulator resets, then `replayBytes` of buffered output follow as one binary message. */
export type TerminalSnapshotFrame = { type: "snapshot"; terminal: TerminalView; sequence: number; truncated: boolean; replayBytes: number };
/** Server → browser JSON text messages. Every binary message is PTY output, in order. */
export type TerminalControlFrame =
  | TerminalSnapshotFrame
  | { type: "state"; terminal: TerminalView }
  | { type: "error"; error: string };
/** Browser → server JSON text messages. */
export type TerminalInput = { action: "input"; data: string } | { action: "resize"; cols: number; rows: number };

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const view = (value: unknown): value is TerminalView => record(value) && typeof value["id"] === "string" && Number.isInteger(value["cols"]) && Number.isInteger(value["rows"]) && (value["status"] === "running" || value["status"] === "exited");

/** Parses a server text message; anything else, including a malformed frame, is undefined. */
export function parseTerminalControlFrame(text: string): TerminalControlFrame | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!record(value)) return undefined;
  if (value["type"] === "snapshot") {
    const { terminal, sequence, truncated, replayBytes } = value;
    return view(terminal) && Number.isInteger(sequence) && typeof truncated === "boolean" && Number.isInteger(replayBytes) && (replayBytes as number) >= 0
      ? { type: "snapshot", terminal, sequence: sequence as number, truncated, replayBytes: replayBytes as number }
      : undefined;
  }
  if (value["type"] === "state") return view(value["terminal"]) ? { type: "state", terminal: value["terminal"] } : undefined;
  if (value["type"] === "error") return typeof value["error"] === "string" ? { type: "error", error: value["error"] } : undefined;
  return undefined;
}
