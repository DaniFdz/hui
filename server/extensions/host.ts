/**
 * The supervisor of one out-of-process extension: it spawns `host-main` beside this module, performs the ready
 * handshake, forwards calls and streams, and restarts a crashed host with backoff. Crash isolation only: the child runs
 * as the same user with the same file access, and a restart failure after three crashes in five minutes leaves the
 * extension `failed` until a reload.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ExtensionRouteInfo } from "../api/extensions.ts";
import {
  CALL_TIMEOUT_MS, CRASH_LIMIT, CRASH_WINDOW_MS, EXTENSION_PROTOCOL_VERSION, HANDSHAKE_TIMEOUT_MS, RESTART_BACKOFF_MS,
  decodeFrame, encodeFrame, type HostFrame, type ParentFrame,
} from "./protocol.ts";
import type { ExtensionGatewayContext, ExtensionPromptSection } from "./registry.ts";

const STDERR_LIMIT = 4_096;
const STOP_GRACE_MS = 2_000;

export class HostUnavailableError extends Error {
  constructor(message = "the extension process is restarting") {
    super(message);
    this.name = "HostUnavailableError";
  }
}

export type HostStart = { ok: true } | { ok: false; error: string };

type Pending = {
  resolve: (value: { status: number; body: unknown }) => void;
  reject: (error: Error) => void;
  push?: (event: unknown) => void;
  end?: () => void;
  timer?: ReturnType<typeof setTimeout>;
};

export type ExtensionHostOptions = {
  id: string;
  directory: string;
  callTimeoutMs?: number;
  record?: (event: { area: "gateway"; level: "info" | "warning"; action: string; summary: string; detail?: string }) => void;
  /** The read-only gateway data a process-mode route may ask for; resolved at call time. */
  context?: () => ExtensionGatewayContext | undefined;
};

/** A queue an async iterable reads while the child's `event` frames arrive. */
class EventQueue implements AsyncIterable<unknown> {
  #items: unknown[] = [];
  #waiter?: () => void;
  #done = false;
  #error?: Error;

  push(event: unknown): void {
    this.#items.push(event);
    this.#waiter?.();
    this.#waiter = undefined;
  }

  end(): void {
    this.#done = true;
    this.#waiter?.();
    this.#waiter = undefined;
  }

  fail(error: Error): void {
    this.#error = error;
    this.#done = true;
    this.#waiter?.();
    this.#waiter = undefined;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    while (true) {
      if (this.#items.length) {
        yield this.#items.shift();
        continue;
      }
      if (this.#error) throw this.#error;
      if (this.#done) return;
      await new Promise<void>((resolve) => { this.#waiter = resolve; });
    }
  }
}

export class ExtensionHost {
  readonly id: string;
  #directory: string;
  #record: NonNullable<ExtensionHostOptions["record"]>;
  #context: NonNullable<ExtensionHostOptions["context"]>;
  #callTimeoutMs: number;
  #child?: ChildProcessWithoutNullStreams;
  #routes: readonly ExtensionRouteInfo[] = [];
  #prompt: readonly ExtensionPromptSection[] = [];
  #state: "starting" | "ready" | "restarting" | "failed" | "stopped" = "stopped";
  #error = "";
  #restarts = 0;
  #crashes: number[] = [];
  #stopping = false;
  #restartTimer?: ReturnType<typeof setTimeout>;
  #buffer = "";
  #stderr = "";
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #ready?: { resolve: () => void; reject: (error: Error) => void };

  constructor(options: ExtensionHostOptions) {
    this.id = options.id;
    this.#directory = options.directory;
    this.#record = options.record ?? (() => undefined);
    this.#context = options.context ?? (() => undefined);
    this.#callTimeoutMs = options.callTimeoutMs ?? CALL_TIMEOUT_MS;
  }

  get mode(): "process" {
    return "process";
  }

  get info(): { state: string; routes: readonly ExtensionRouteInfo[]; prompt: readonly ExtensionPromptSection[]; restarts: number; error?: string } {
    return {
      state: this.#state,
      routes: this.#routes,
      prompt: this.#prompt,
      restarts: this.#restarts,
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  /** Confirms the child imported the extension and sent its routes within the handshake timeout. */
  async start(): Promise<HostStart> {
    if (this.#state === "ready") return { ok: true };
    this.#stopping = false;
    this.#state = "starting";
    this.#error = "";
    const entry = ["host-main.ts", "host-main.js"].map((name) => new URL(name, import.meta.url)).find((url) => existsSync(fileURLToPath(url)));
    if (!entry) return { ok: false, error: "the extension host entry is missing" };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(process.execPath, [fileURLToPath(entry), this.#directory], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (error) {
      this.#state = "failed";
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    this.#child = child;
    this.#buffer = "";
    this.#stderr = "";
    const ready = new Promise<HostStart>((resolve) => {
      const timer = setTimeout(() => {
        this.#ready = undefined;
        resolve({ ok: false, error: "the extension process did not start in time" });
        void this.stop();
      }, HANDSHAKE_TIMEOUT_MS);
      this.#ready = {
        resolve: () => { clearTimeout(timer); this.#ready = undefined; resolve({ ok: true }); },
        reject: (error) => { clearTimeout(timer); this.#ready = undefined; resolve({ ok: false, error: error.message }); },
      };
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#onData(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { this.#stderr = (this.#stderr + chunk).slice(-STDERR_LIMIT); });
    child.on("exit", (code, signal) => this.#onExit(code, signal));
    child.on("error", (error) => this.#ready?.reject(error));
    const started = await ready;
    if (!started.ok) {
      this.#state = "failed";
      this.#error = started.error;
      await this.stop();
      return started;
    }
    this.#state = "ready";
    return { ok: true };
  }

  async call(method: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    if (this.#state !== "ready") throw new HostUnavailableError();
    return await this.#request({ t: "call", id: this.#nextId++, method, path, ...(body === undefined ? {} : { body }) });
  }

  stream(method: string, path: string, body: unknown, signal: AbortSignal): AsyncIterable<unknown> {
    if (this.#state !== "ready") throw new HostUnavailableError();
    const id = this.#nextId++;
    const queue = new EventQueue();
    const pending: Pending = {
      resolve: () => undefined,
      reject: (error) => queue.fail(error),
      push: (event) => queue.push(event),
      end: () => queue.end(),
      timer: setTimeout(() => {
        this.#pending.delete(id);
        queue.fail(new Error("the extension process did not answer in time"));
        this.#write({ t: "cancel", id });
      }, this.#callTimeoutMs),
    };
    this.#pending.set(id, pending);
    const abort = () => {
      this.#write({ t: "cancel", id });
      queue.end();
    };
    signal.addEventListener("abort", abort, { once: true });
    this.#write({ t: "stream", id, method, path, ...(body === undefined ? {} : { body }) });
    return (async function* () {
      try {
        yield* queue;
      } finally {
        signal.removeEventListener("abort", abort);
      }
    })();
  }

  /** Sends the stream frames and resolves when the child says it is done or fails. */
  async #request(frame: ParentFrame): Promise<{ status: number; body: unknown }> {
    const id = (frame as { id: number }).id;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        this.#write({ t: "cancel", id });
        reject(new Error("the extension process did not answer in time"));
      }, this.#callTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#write(frame);
    });
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#restartTimer = undefined;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new HostUnavailableError());
      this.#pending.delete(id);
    }
    const child = this.#child;
    this.#child = undefined;
    this.#state = "stopped";
    if (!child || child.exitCode !== null) return;
    this.#write({ t: "stop" });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, STOP_GRACE_MS);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    }).catch(() => undefined);
  }

  #write(frame: ParentFrame): void {
    try {
      this.#child?.stdin.write(encodeFrame(frame));
    } catch {
      // A child that has gone away is handled by its exit.
    }
  }

  #onData(chunk: string): void {
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      const frame = decodeFrame(line);
      if (frame) this.#onFrame(frame as HostFrame);
      newline = this.#buffer.indexOf("\n");
    }
    if (this.#buffer.length > 2 * 1024 * 1024) {
      this.#buffer = "";
      this.#onExit(1, null);
    }
  }

  #onFrame(frame: HostFrame): void {
    switch (frame.t) {
      case "ready":
        if (frame.protocol !== EXTENSION_PROTOCOL_VERSION) {
          this.#ready?.reject(new Error(`unsupported extension protocol: ${String(frame.protocol)}`));
          return;
        }
        this.#routes = Object.freeze(frame.routes.map((route) => ({ ...route })));
        this.#prompt = Object.freeze(frame.prompt ? frame.prompt.map((section) => ({ ...section })) : []);
        this.#ready?.resolve();
        return;
      case "failed":
        this.#ready?.reject(new Error(frame.error));
        return;
      case "result": {
        const pending = this.#pending.get(frame.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(frame.id);
        pending.resolve({ status: frame.status, body: frame.body });
        return;
      }
      case "event":
        this.#pending.get(frame.id)?.push?.(frame.event);
        return;
      case "context":
        void this.#answerContext(frame);
        return;
      case "end": {
        const pending = this.#pending.get(frame.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(frame.id);
        pending.end?.();
        pending.resolve({ status: 200, body: undefined });
        return;
      }
      case "error": {
        const pending = this.#pending.get(frame.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(frame.id);
        pending.reject(new Error(frame.error));
        pending.end?.();
        return;
      }
      default:
        return;
    }
  }

  async #answerContext(frame: Extract<HostFrame, { t: "context" }>): Promise<void> {
    const context = this.#context();
    try {
      if (!context) throw new Error("The HUI gateway context is not available.");
      if (frame.capability === "github.contributions") {
        const args = frame.args && typeof frame.args === "object" ? frame.args as { year?: unknown } : {};
        const year = typeof args.year === "number" ? args.year : undefined;
        this.#write({ t: "context-result", id: frame.id, value: await context.github.contributions(year) });
        return;
      }
      throw new Error(`unknown gateway context capability: ${frame.capability}`);
    } catch (error) {
      this.#write({ t: "context-result", id: frame.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  #onExit(code: number | null, signal: NodeJS.Signals | null): void {
    const wasReady = this.#state === "ready";
    this.#ready?.reject(new Error(`the extension process exited (${code ?? signal ?? "unknown"})`));
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new HostUnavailableError());
      pending.end?.();
      this.#pending.delete(id);
    }
    this.#child = undefined;
    if (this.#stopping) {
      this.#state = "stopped";
      return;
    }
    const now = Date.now();
    this.#crashes = [...this.#crashes.filter((at) => now - at < CRASH_WINDOW_MS), now];
    this.#record({
      area: "gateway",
      level: "warning",
      action: "extension_process_crashed",
      summary: `extension ${this.id} process exited (${code ?? signal ?? "unknown"})${wasReady ? "" : " before it was ready"}`,
      ...(this.#stderr.trim() ? { detail: this.#stderr.trim() } : {}),
    });
    if (this.#crashes.length >= CRASH_LIMIT) {
      this.#state = "failed";
      this.#error = `the extension process crashed ${this.#crashes.length} times in five minutes`;
      return;
    }
    this.#state = "restarting";
    this.#restarts += 1;
    const delay = RESTART_BACKOFF_MS[Math.min(this.#crashes.length - 1, RESTART_BACKOFF_MS.length - 1)]!;
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = undefined;
      void this.start().then((result) => {
        if (!result.ok) {
          this.#state = "failed";
          this.#error = result.error;
        } else {
          this.#record({ area: "gateway", level: "info", action: "extension_process_restarted", summary: `extension ${this.id} process restarted` });
        }
      });
    }, delay);
    this.#restartTimer.unref();
  }
}
