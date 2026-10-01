/**
 * A remote PI worker presented as the ChildProcess PiSession and SdkInspector
 * already drive: stdio streams, the IPC side channel, kill and exit. Losing
 * the connection reads as the process going away; the remote process itself
 * keeps running and a later open reattaches to it.
 */
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Frame, Peer } from "./protocol.ts";

export class RemoteChild extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  /** Remote pids mean nothing to local process telemetry. */
  readonly pid = undefined;
  /** True when this attached to a process that was already running. */
  reused = false;
  connected = true;
  #peer: Peer;
  #ch: number;
  #ended = false;
  #release: () => void;

  constructor(peer: Peer, ch: number, release: () => void) {
    super();
    this.#peer = peer;
    this.#ch = ch;
    this.#release = release;
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _encoding, callback) => {
        if (this.#ended) { callback(new Error("The remote worker connection is closed.")); return; }
        peer.send({ t: "in", ch, d: chunk.toString() });
        callback();
      },
    });
  }

  /** Frames for this channel, routed by the connection. */
  receive(frame: Frame): void {
    if (frame.t === "out" && typeof frame["d"] === "string") this.stdout.write(frame["d"]);
    else if (frame.t === "err" && typeof frame["d"] === "string") this.stderr.write(frame["d"]);
    else if (frame.t === "ipc") this.emit("message", frame["m"]);
    else if (frame.t === "exit") {
      if (typeof frame["message"] === "string") this.stderr.write(`${frame["message"]}\n`);
      this.#end(typeof frame["code"] === "number" ? frame["code"] : null, typeof frame["signal"] === "string" ? frame["signal"] as NodeJS.Signals : null);
    }
  }

  /** The connection went away; the remote process may well still be running. */
  lost(reason: string): void {
    if (!this.#ended) this.emit("error", new Error(reason));
    this.#end(null, null);
  }

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    if (this.#ended) {
      callback?.(new Error("The remote worker connection is closed."));
      return false;
    }
    this.#peer.send({ t: "ipc", ch: this.#ch, m: message });
    callback?.(null);
    return true;
  }

  /** Stop relaying without stopping the remote process. */
  detach(): void {
    if (!this.#ended) this.#peer.send({ t: "detach", ch: this.#ch });
    this.lost("Detached from the remote session.");
  }

  kill(): boolean {
    if (this.#ended) return false;
    this.#peer.send({ t: "kill", ch: this.#ch });
    return true;
  }

  #end(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#ended) return;
    this.#ended = true;
    this.connected = false;
    this.#release();
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, signal);
  }

  asChild(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams;
  }
}
