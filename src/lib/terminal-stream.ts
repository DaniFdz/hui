/**
 * Browser side of the terminal socket's wire format (shared/terminal-stream.ts): turns the socket's text and
 * binary messages into snapshot, output, state and error callbacks, pairing each snapshot with the replay bytes
 * that follow it. Output stays as bytes; Ghostty decodes UTF-8 itself, including code points split across
 * messages.
 */
import { parseTerminalControlFrame, type TerminalSnapshotFrame } from "../../shared/terminal-stream.ts";
import type { TerminalView } from "./terminal-types.ts";

export type TerminalStreamHandlers = {
  snapshot(frame: TerminalSnapshotFrame, replay: Uint8Array): void;
  output(bytes: Uint8Array): void;
  state(terminal: TerminalView): void;
  error(message: string): void;
};

const empty = new Uint8Array(0);

/** Returns the socket message handler; set `binaryType = "arraybuffer"` on the socket. */
export function createTerminalStreamReader(handlers: TerminalStreamHandlers): (data: unknown) => void {
  let awaitingReplay: TerminalSnapshotFrame | undefined;
  return (data) => {
    if (typeof data !== "string") {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : undefined;
      if (!bytes) { handlers.error("Unsupported terminal message."); return; }
      const snapshot = awaitingReplay;
      awaitingReplay = undefined;
      if (snapshot) handlers.snapshot(snapshot, bytes);
      else if (bytes.length) handlers.output(bytes);
      return;
    }
    const frame = parseTerminalControlFrame(data);
    if (!frame) { handlers.error("Malformed terminal message."); return; }
    if (awaitingReplay) {
      // The replay must directly follow its snapshot; anything else means the stream cannot be trusted.
      awaitingReplay = undefined;
      handlers.error("Terminal replay was interrupted.");
    }
    if (frame.type === "snapshot") {
      if (frame.replayBytes > 0) awaitingReplay = frame;
      else handlers.snapshot(frame, empty);
    } else if (frame.type === "state") handlers.state(frame.terminal);
    else handlers.error(frame.error);
  };
}
