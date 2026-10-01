/**
 * The remote worker protocol: one JSON object per `\n`-terminated line over any
 * duplex byte stream (a Unix socket on the remote, the stdio of a connect
 * command on the gateway). JSON.stringify never emits a raw newline, so the
 * framing needs no escaping. Requests and responses share the stream with
 * fire-and-forget frames such as process output.
 */
import type { Readable, Writable } from "node:stream";

export const PROTOCOL_VERSION = 1;
/** A frame larger than this is a protocol error, not something to buffer. */
export const MAX_FRAME_BYTES = 32 * 1024 * 1024;

export type Frame = { t: string } & Record<string, unknown>;
type RequestHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ProtocolError extends Error {
  override name = "ProtocolError";
}

/** Splits a UTF-8 stream on `\n` only; U+2028/U+2029 are legal inside JSON. */
export class LineSplitter {
  #buffer = "";

  push(chunk: string): string[] {
    this.#buffer += chunk;
    const lines: string[] = [];
    for (let index = this.#buffer.indexOf("\n"); index !== -1; index = this.#buffer.indexOf("\n")) {
      const line = this.#buffer.slice(0, index).replace(/\r$/u, "");
      this.#buffer = this.#buffer.slice(index + 1);
      if (line.trim()) lines.push(line);
    }
    if (this.#buffer.length > MAX_FRAME_BYTES) throw new ProtocolError("Remote worker frame exceeds the size limit.");
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

  constructor(write: (line: string) => void) {
    this.#write = write;
  }

  get closed(): boolean {
    return this.#closed !== undefined;
  }

  send(frame: Frame): void {
    if (this.#closed) return;
    this.#write(`${JSON.stringify(frame)}\n`);
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
      this.send({ t: "req", id, op, p: params });
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
      this.send({ t: "res", id, ok: true, result: await handler(params) });
    } catch (error) {
      this.send({ t: "res", id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
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
