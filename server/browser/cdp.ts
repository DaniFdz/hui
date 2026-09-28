/**
 * Chrome DevTools Protocol over `--remote-debugging-pipe`.
 *
 * Commands are NUL-terminated JSON written to the browser's fd 3; responses and
 * events arrive the same way on fd 4. No TCP port is opened, so neither another
 * local user nor a web page can attach to the managed browser, and the browser
 * exits as soon as the gateway's end of the pipe closes.
 */
import type { Readable, Writable } from "node:stream";

export type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string };

export class CdpError extends Error {
  readonly code: number | undefined;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

type Pending = {
  method: string;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** A full-page screenshot is the largest legitimate message. */
export const CDP_MAX_MESSAGE_BYTES = 128 * 1024 * 1024;
export const CDP_COMMAND_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class CdpConnection {
  readonly #writer: Writable;
  readonly #pending = new Map<number, Pending>();
  readonly #listeners = new Set<(event: CdpEvent) => void>();
  readonly #closeListeners = new Set<(reason: Error) => void>();
  #chunks: Buffer[] = [];
  #buffered = 0;
  #nextId = 0;
  #closed: Error | undefined;

  constructor(writer: Writable, reader: Readable) {
    this.#writer = writer;
    reader.on("data", (chunk: Buffer) => this.#receive(chunk));
    reader.once("end", () => this.#close(new CdpError("The browser connection closed.")));
    reader.once("close", () => this.#close(new CdpError("The browser connection closed.")));
    reader.once("error", (error: Error) => this.#close(new CdpError(`The browser connection failed: ${error.message}`)));
    writer.once("error", (error: Error) => this.#close(new CdpError(`The browser connection failed: ${error.message}`)));
  }

  get closed(): boolean {
    return this.#closed !== undefined;
  }

  send<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = CDP_COMMAND_TIMEOUT_MS,
  ): Promise<T> {
    if (this.#closed) return Promise.reject(this.#closed);
    const id = ++this.#nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CdpError(`The browser did not answer ${method} within ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.#pending.set(id, { method, resolve: resolve as (value: Record<string, unknown>) => void, reject, timer });
      try {
        this.#writer.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new CdpError("The browser connection is not writable."));
      }
    });
  }

  on(listener: (event: CdpEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onClose(listener: (reason: Error) => void): () => void {
    if (this.#closed) {
      listener(this.#closed);
      return () => undefined;
    }
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  close(reason = "The browser connection was closed."): void {
    this.#close(new CdpError(reason));
    try { this.#writer.end(); } catch { /* Already closed. */ }
  }

  #receive(chunk: Buffer): void {
    if (this.#closed) return;
    let start = 0;
    let end = chunk.indexOf(0, start);
    while (end !== -1) {
      this.#chunks.push(chunk.subarray(start, end));
      const text = Buffer.concat(this.#chunks).toString("utf8");
      this.#chunks = [];
      this.#buffered = 0;
      this.#dispatch(text);
      if (this.#closed) return;
      start = end + 1;
      end = chunk.indexOf(0, start);
    }
    if (start < chunk.length) {
      this.#chunks.push(chunk.subarray(start));
      this.#buffered += chunk.length - start;
      if (this.#buffered > CDP_MAX_MESSAGE_BYTES) this.#close(new CdpError("The browser sent an oversized protocol message."));
    }
  }

  #dispatch(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      this.#close(new CdpError("The browser sent malformed protocol data."));
      return;
    }
    if (!isRecord(message)) return;
    const id = message["id"];
    if (typeof id === "number") {
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      const error = message["error"];
      if (isRecord(error)) {
        const detail = typeof error["message"] === "string" ? error["message"] : `${pending.method} failed.`;
        pending.reject(new CdpError(detail, typeof error["code"] === "number" ? error["code"] : undefined));
      } else {
        pending.resolve(isRecord(message["result"]) ? message["result"] : {});
      }
      return;
    }
    const method = message["method"];
    if (typeof method !== "string") return;
    const event: CdpEvent = {
      method,
      params: isRecord(message["params"]) ? message["params"] : {},
      ...(typeof message["sessionId"] === "string" ? { sessionId: message["sessionId"] } : {}),
    };
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // One faulty observer must not stop protocol dispatch for the rest.
      }
    }
  }

  #close(reason: Error): void {
    if (this.#closed) return;
    this.#closed = reason;
    this.#chunks = [];
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
    const listeners = [...this.#closeListeners];
    this.#closeListeners.clear();
    this.#listeners.clear();
    for (const listener of listeners) {
      try { listener(reason); } catch { /* Observers cannot veto closing. */ }
    }
  }
}
