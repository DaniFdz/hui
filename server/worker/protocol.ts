/**
 * The remote worker protocol: one JSON object per `\n`-terminated line over any
 * duplex byte stream (a Unix socket on the remote, the stdio of a connect
 * command on the gateway). JSON.stringify never emits a raw newline, so the
 * framing needs no escaping. Requests and responses share the stream with
 * fire-and-forget frames such as process output.
 */
import type { Readable, Writable } from "node:stream";

export const PROTOCOL_VERSION = 1;
/** A frame larger than this is a protocol error, not something to buffer.
 * Large enough for a 100 MB file in base64 or a long, image-heavy history. */
export const MAX_FRAME_BYTES = 256 * 1024 * 1024;

export type Frame = { t: string } & Record<string, unknown>;
type RequestHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ProtocolError extends Error {
  override name = "ProtocolError";
}

/** Splits a UTF-8 stream on `\n` only; U+2028/U+2029 are legal inside JSON.
 * Only each new chunk is searched, so a very long line stays linear. */
export class LineSplitter {
  #parts: string[] = [];
  #size = 0;
  #max: number;

  constructor(max = MAX_FRAME_BYTES) {
    this.#max = max;
  }

  push(chunk: string): string[] {
    const lines: string[] = [];
    let start = 0;
    for (let index = chunk.indexOf("\n"); index !== -1; index = chunk.indexOf("\n", start)) {
      this.#parts.push(chunk.slice(start, index));
      const line = this.#parts.join("").replace(/\r$/u, "");
      this.#parts = [];
      this.#size = 0;
      if (line.trim()) lines.push(line);
      start = index + 1;
    }
    if (start < chunk.length) {
      this.#parts.push(chunk.slice(start));
      this.#size += chunk.length - start;
    }
    if (this.#size > this.#max) throw new ProtocolError("Remote worker frame exceeds the size limit.");
    return lines;
  }
}

export function parseFrame(line: string): Frame {
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new ProtocolError("Remote worker sent malformed JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as Frame).t !== "string") {
    throw new ProtocolError("Remote worker sent a frame without a type.");
  }
  return value as Frame;
}

/** Request/response multiplexing plus typed frame listeners over one stream. */
export class Peer {
  #write: (line: string) => void;
  #next = 0;
  #pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  #handlers = new Map<string, RequestHandler>();
  #listeners = new Set<(frame: Frame) => void>();
  #closeListeners = new Set<(reason: string) => void>();
  #closed: string | undefined;
  #seen = Date.now();

  constructor(write: (line: string) => void) {
    this.#write = write;
  }

  get closed(): boolean {
    return this.#closed !== undefined;
  }

  /** False when closed or when the frame cannot be serialized (too large). */
  send(frame: Frame): boolean {
    if (this.#closed) return false;
    let line: string;
    try { line = `${JSON.stringify(frame)}\n`; } catch { return false; }
    // The other side would reject it and drop the whole connection.
    if (line.length > MAX_FRAME_BYTES) return false;
    this.#write(line);
    return true;
  }

  /** Bytes are arriving: a long frame in transit is not silence. */
  touch(): void {
    this.#seen = Date.now();
  }

  request<T = unknown>(op: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    if (this.#closed) return Promise.reject(new Error(this.#closed));
    const id = `r${++this.#next}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Remote worker did not answer ${op} in time.`));
      }, timeoutMs);
      timer.unref?.();
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      if (!this.send({ t: "req", id, op, p: params })) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new Error(this.#closed ?? `The ${op} request is too large to send.`));
      }
    });
  }

  handle(op: string, handler: RequestHandler): void {
    this.#handlers.set(op, handler);
  }

  onFrame(listener: (frame: Frame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onClose(listener: (reason: string) => void): void {
    if (this.#closed) listener(this.#closed);
    else this.#closeListeners.add(listener);
  }

  receive(frame: Frame): void {
    this.#seen = Date.now();
    if (frame.t === "ping") return;
    if (frame.t === "res") {
      const pending = typeof frame["id"] === "string" ? this.#pending.get(frame["id"]) : undefined;
      if (!pending) return;
      this.#pending.delete(frame["id"] as string);
      clearTimeout(pending.timer);
      if (frame["ok"] === true) pending.resolve(frame["result"]);
      else pending.reject(new Error(typeof frame["error"] === "string" ? frame["error"] : "Remote worker request failed."));
      return;
    }
    if (frame.t === "req") {
      void this.#answer(frame);
      return;
    }
    for (const listener of this.#listeners) listener(frame);
  }

  async #answer(frame: Frame): Promise<void> {
    const id = frame["id"];
    const handler = typeof frame["op"] === "string" ? this.#handlers.get(frame["op"]) : undefined;
    if (typeof id !== "string") return;
    try {
      if (!handler) throw new Error(`Unsupported remote worker request: ${String(frame["op"])}`);
      const params = isRecord(frame["p"]) ? frame["p"] : {};
      if (!this.send({ t: "res", id, ok: true, result: await handler(params) })) throw new Error("The reply is too large to send.");
    } catch (error) {
      this.send({ t: "res", id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Both sides ping; a peer silent for `misses` intervals (a sleeping
   * laptop, a dead network path) is closed instead of trusted. */
  keepAlive(intervalMs = 15_000, misses = 3): void {
    const timer = setInterval(() => {
      if (Date.now() - this.#seen > intervalMs * misses) this.close("The other side stopped answering.");
      else this.send({ t: "ping" });
    }, intervalMs);
    timer.unref();
    this.onClose(() => clearInterval(timer));
  }

  close(reason: string): void {
    if (this.#closed) return;
    this.#closed = reason;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.#pending.clear();
    for (const listener of this.#closeListeners) listener(reason);
    this.#closeListeners.clear();
  }
}

/** Binds a peer to a stream pair. Malformed input closes the peer. */
export function attachPeer(input: Readable, output: Writable, onLine?: (line: string) => boolean): Peer {
  const peer = new Peer((line) => { output.write(line); });
  const splitter = new LineSplitter();
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    peer.touch();
    try {
      for (const line of splitter.push(chunk)) {
        if (onLine?.(line)) continue;
        peer.receive(parseFrame(line));
      }
    } catch (error) {
      peer.close(error instanceof Error ? error.message : "Remote worker protocol error.");
      input.destroy();
    }
  });
  input.on("close", () => peer.close("Remote worker connection closed."));
  input.on("error", (error) => peer.close(`Remote worker connection failed: ${error.message}`));
  output.on("error", (error) => peer.close(`Remote worker connection failed: ${error.message}`));
  return peer;
}
