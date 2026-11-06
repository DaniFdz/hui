/**
 * Server-sent events: writing one event, the heartbeat interval that keeps an idle stream alive, and forwarding a live
 * session's messages as named events (the SSE routes and the session WebSocket both use it).
 */
import type { ServerResponse } from "node:http";
import { liveSessions, type SessionSnapshot, type SessionStreamMessage } from "../sessions/live-sessions.ts";

/** How long an event stream may sit idle before a comment proves it is alive. */
export const HEARTBEAT_MS = 15_000;
export const MAX_STREAM_DURATION_MS = 600_000;
export const MAX_STREAM_EVENTS = 5_000;
export const MAX_STREAM_EVENT_BYTES = 256 * 1024;
export const MAX_STREAM_TOTAL_BYTES = 5 * 1024 * 1024;

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
  sessions: Pick<typeof liveSessions, "watch" | "replaySince"> = liveSessions,
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
  const replay = slim && heldRevision !== undefined ? sessions.replaySince(id, heldRevision) : undefined;
  if (!replay) send("snapshot", watched.snapshot);
  else if (!replay.length) send("snapshot", withoutTranscript(watched.snapshot));
  else replay.forEach(forward);
  return watched.unsubscribe;
}

function withoutTranscript({ transcript: _transcript, ...snapshot }: SessionSnapshot): Omit<SessionSnapshot, "transcript"> {
  return snapshot;
}

/** What the caller supplies for one extension event stream. */
export type EventStreamOptions = {
  heartbeatMs?: number;
  /** Called once when a throw or a cap ends the stream (not when the client leaves). */
  onError?: (message: string) => void;
};

/**
 * Writes an extension's events as server-sent events: one unnamed `data:` event per object, a heartbeat comment while
 * it waits, and the shared caps. A throw ends it with an \`error\` event; a client that leaves stops the loop and clears
 * the heartbeat. The handler's own \`signal\` is what makes a waiting generator stop.
 */
export function sendEventStream(response: ServerResponse, events: AsyncIterable<unknown>, options: EventStreamOptions = {}): void {
  if (response.writableEnded) return;
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  });
  response.flushHeaders();
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(": heartbeat\n\n");
  }, options.heartbeatMs ?? HEARTBEAT_MS);
  heartbeat.unref();
  let closed = false;
  const finish = (error?: string) => {
    clearInterval(heartbeat);
    if (response.writableEnded) return;
    if (error) writeEvent(response, "error", { error });
    response.end();
  };
  response.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
  });
  void (async () => {
    const started = Date.now();
    let count = 0;
    let total = 0;
    try {
      for await (const event of events) {
        if (closed || response.writableEnded) break;
        if (Date.now() - started > MAX_STREAM_DURATION_MS) {
          options.onError?.("stream timed out");
          finish("stream timed out");
          return;
        }
        if (++count > MAX_STREAM_EVENTS) {
          options.onError?.("too many events");
          finish("too many events");
          return;
        }
        const data = JSON.stringify(event);
        const bytes = Buffer.byteLength(data, "utf8");
        if (bytes > MAX_STREAM_EVENT_BYTES) {
          options.onError?.("event too large");
          finish("event too large");
          return;
        }
        total += bytes;
        if (total > MAX_STREAM_TOTAL_BYTES) {
          options.onError?.("stream too large");
          finish("stream too large");
          return;
        }
        response.write(`data: ${data}\n\n`);
      }
      finish();
    } catch (error) {
      if (closed) {
        finish();
        return;
      }
      options.onError?.(error instanceof Error ? error.message : String(error));
      finish("extension failed");
    }
  })();
}
