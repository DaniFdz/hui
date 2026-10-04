/**
 * A session running on a remote worker host, driven through the generic
 * RuntimeSession contract. The host runs the same adapter a local session
 * would (Durable or PI) and sends its state with every event and reply, so
 * the synchronous reads below are never behind the event being handled.
 * Losing the connection reads as the runtime exiting; the host keeps the
 * session running and a later start reattaches to it.
 */
import { readFile } from "node:fs/promises";
import { workers, type RemoteSessionLink } from "../workers.ts";
import type { RemoteState } from "../worker/host.ts";
import type { RuntimeInspection } from "../../src/lib/tools-types.ts";
import type { AgentRuntime, PromptAttachment, RuntimeCommand, RuntimeEvent, RuntimeModel, RuntimeSession, StartOptions, TranscriptEntry } from "./types.ts";

class RemoteRuntimeSession implements RuntimeSession {
  #state: RemoteState;
  #transcript: TranscriptEntry[];
  #link!: RemoteSessionLink;
  #worker: string;
  #listeners = new Set<(event: RuntimeEvent) => void>();
  #exitListeners = new Set<() => void>();
  #ended = false;

  constructor(worker: string, state: RemoteState, transcript: TranscriptEntry[]) {
    this.#worker = worker;
    this.#state = state;
    this.#transcript = transcript;
    // Only what the remote runtime offers is exposed, so the gateway never
    // shows a control that would fail.
    const self = this as unknown as Record<string, unknown>;
    for (const name of ["steer", "followUp", "abort", "setModel", "setThinking", "respondQuestion", "cancelQuestion", "compact", "cancelCompaction", "rewind", "continueRun", "listModels", "listCommands", "inspect", "attachmentImage", "clear", "reload"]) {
      if (!state.methods.includes(name)) self[name] = undefined;
    }
  }

  bind(link: RemoteSessionLink): void {
    this.#link = link;
  }

  get processId(): undefined { return undefined; }
  get sessionId(): string { return this.#state.sessionId; }
  get sessionFile(): string | undefined { return this.#state.sessionFile; }
  get isStreaming(): boolean { return this.#state.isStreaming; }
  get resumesInterruptedRuns(): boolean { return this.#state.resumesInterruptedRuns; }

  /** A frame from the host for this session. */
  receive(frame: { state?: RemoteState; transcript?: TranscriptEntry[]; event?: RuntimeEvent }): void {
    if (frame.state) this.#state = frame.state;
    if (frame.transcript) this.#transcript = frame.transcript;
    if (frame.event) for (const listener of [...this.#listeners]) listener(frame.event);
  }

  /** The connection or the remote runtime is gone. */
  lost(): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const listener of [...this.#exitListeners]) listener();
  }

  async #call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (this.#ended) throw new Error("The remote worker connection is closed.");
    const reply = await this.#link.call(method, args) as { result?: T; state: RemoteState; transcript?: TranscriptEntry[] };
    this.receive(reply);
    return reply.result as T;
  }

  /** Files are copied to the worker, where the remote agent can read them. */
  async #stage(attachments: readonly PromptAttachment[] = []): Promise<PromptAttachment[]> {
    return Promise.all(attachments.map(async (item) => item.kind === "file"
      ? { ...item, path: await workers.putFile(this.#worker, item.name, await readFile(item.path)) }
      : item));
  }

  async prompt(text: string, attachments?: readonly PromptAttachment[]): Promise<void> { await this.#call("prompt", text, await this.#stage(attachments)); }
  async steer(text: string, attachments?: readonly PromptAttachment[]): Promise<void> { await this.#call("steer", text, await this.#stage(attachments)); }
  async followUp(text: string, attachments?: readonly PromptAttachment[]): Promise<void> { await this.#call("followUp", text, await this.#stage(attachments)); }
  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  currentModel() { return this.#state.model; }
  currentUsage() { return this.#state.usage; }
  currentThinking() { return this.#state.thinking; }
  pendingQueue() { return this.#state.queue ?? { steering: [], followUp: [] }; }
  pendingQuestions() { return this.#state.questions ?? []; }
  listModels(): Promise<readonly RuntimeModel[]> { return this.#call("listModels"); }
  listCommands(): Promise<readonly RuntimeCommand[]> { return this.#call("listCommands"); }
  inspect(): Promise<RuntimeInspection> { return this.#call("inspect"); }
  async setModel(provider: string, id: string): Promise<void> { await this.#call("setModel", provider, id); }
  async setThinking(level: string): Promise<void> { await this.#call("setThinking", level); }
  async respondQuestion(id: string, response: unknown): Promise<void> { await this.#call("respondQuestion", id, response); }
  async cancelQuestion(id: string): Promise<void> { await this.#call("cancelQuestion", id); }
  async abort(): Promise<void> { await this.#call("abort"); }
  async clear(): Promise<void> { await this.#call("clear"); }
  /** The mirror is refreshed first, so the reload sees what just changed here. */
  async reload(): Promise<void> {
    await workers.sync(this.#worker);
    await this.#call("reload");
  }
  async compact(instructions?: string): Promise<void> { await this.#call("compact", ...(instructions === undefined ? [] : [instructions])); }
  async cancelCompaction(): Promise<void> { await this.#call("cancelCompaction"); }
  async rewind(target: unknown, options?: unknown): Promise<void> { await this.#call("rewind", target, ...(options === undefined ? [] : [options])); }
  async continueRun(): Promise<void> { await this.#call("continueRun"); }
  onExit(listener: () => void): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }
  async attachmentImage(message: number, image: number): Promise<{ mimeType: string; data: Buffer } | undefined> {
    const result = await this.#call<{ mimeType: string; data: string } | undefined>("attachmentImage", message, image);
    return result ? { mimeType: result.mimeType, data: Buffer.from(result.data, "base64") } : undefined;
  }
  transcript(): TranscriptEntry[] { return this.#transcript; }
  /** Closing a session stops it on the worker; a lost connection does not. */
  dispose(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#link.dispose();
  }
}

/** The adapter a record with `worker` uses: `tool` names the runtime the host runs. */
export function remoteRuntime(tool: string): AgentRuntime {
  return {
    id: tool,
    async start(options: StartOptions): Promise<RuntimeSession> {
      if (!options.worker) throw new Error("A remote session needs a worker.");
      const worker = options.worker;
      let session: RemoteRuntimeSession | undefined;
      // Frames that arrive with the reply, before the session exists, are replayed.
      const early: Parameters<RemoteRuntimeSession["receive"]>[0][] = [];
      let lostEarly = false;
      const link = await workers.startSession(worker, options.huiSessionId ?? "", tool, options, {
        receive: (frame) => { if (session) session.receive(frame); else early.push(frame); },
        lost: () => { if (session) session.lost(); else lostEarly = true; },
      });
      session = new RemoteRuntimeSession(worker, link.state, link.transcript);
      session.bind(link);
      for (const frame of early) session.receive(frame);
      if (lostEarly) session.lost();
      return session;
    },
  };
}
