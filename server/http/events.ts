/**
 * Server-sent events: writing one event, the heartbeat interval that keeps an idle stream alive, and forwarding a live
 * session's messages as named events (the SSE routes and the session WebSocket both use it).
 */
import type { ServerResponse } from "node:http";
import { liveSessions, type SessionSnapshot, type SessionStreamMessage } from "../sessions/live-sessions.ts";

/** How long an event stream may sit idle before a comment proves it is alive. */
export const HEARTBEAT_MS = 15_000;

export function writeEvent(response: ServerResponse, event: string, data: unknown): void {
  if (!response.writableEnded) {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

/**
 * Paints the session once, then forwards everything that happens to it until
 * the returned unsubscribe runs. The caller has already ensured the runtime.
 */
export function watchSessionEvents(
  id: string,
  send: (event: string, data: unknown) => void,
  sessions: Pick<typeof liveSessions, "watch"> & Partial<Pick<typeof liveSessions, "replaySince">> = liveSessions,
  { slim = false, heldRevision }: { slim?: boolean; heldRevision?: number } = {},
): () => void {
  const forward = (message: SessionStreamMessage) => {
    switch (message.kind) {
      case "snapshot":
        send("snapshot", slim && message.transcriptUnchanged ? withoutTranscript(message.snapshot) : message.snapshot);
        break;
      case "transcript":
        send("transcript", message.entries);
        break;
      case "status":
        send("status", { status: message.status });
        break;
      case "event":
        send("event", message.event);
        break;
      case "model":
        send("model", message.model);
        break;
      case "thinking":
        send("thinking_level", { level: message.level });
        break;
      case "fast":
        send("fast", { fast: message.fast });
        break;
      case "closed":
        send("closed", {});
        break;
    }
  };
  const watched = sessions.watch(id, forward, { reader: true });
  const replay = slim && heldRevision !== undefined ? sessions.replaySince?.(id, heldRevision) : undefined;
  if (!replay) send("snapshot", watched.snapshot);
  else if (!replay.length) send("snapshot", withoutTranscript(watched.snapshot));
  else replay.forEach(forward);
  return watched.unsubscribe;
}

function withoutTranscript({ transcript: _transcript, ...snapshot }: SessionSnapshot): Omit<SessionSnapshot, "transcript"> {
  return snapshot;
}
