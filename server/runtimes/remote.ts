/**
 * A session running on a remote worker host, driven through the generic
 * RuntimeSession contract. The host runs the same adapter a local session
 * would (Durable or PI) and sends its state with every reply and with each
 * event that changed it, so the synchronous reads below are never behind the
 * event being handled. Every snapshot carries a sequence: a reply resumes
 * after the events that followed it in the stream, and must not overwrite
 * them with its older state. Losing the connection reads as the runtime
 * exiting; the host keeps the session running and a later start reattaches.
 */
import { readFile } from "node:fs/promises";
import { workers, type RemoteSessionLink, type RemoteSnapshot } from "../workers.ts";
import type { RemoteState } from "../worker/host.ts";
import type { RuntimeInspection } from "../../src/lib/tools-types.ts";
import type { AgentRuntime, PromptAttachment, RuntimeCommand, RuntimeEvent, RuntimeModel, RuntimeSession, StartOptions, TranscriptEntry } from "./types.ts";

type Frame = RemoteSnapshot & { event?: RuntimeEvent };

class RemoteRuntimeSession implements RuntimeSession {
  #state: RemoteState;
  #stateSeq: number;
  #transcript: TranscriptEntry[] = [];
  #transcriptSeq = 0;
  #link: RemoteSessionLink;
  #worker: string;
  #listeners = new Set<(event: RuntimeEvent) => void>();
  /** Events before the first subscriber, such as a question asked at once. */
  #early: RuntimeEvent[] | undefined = [];
  /** Frames wait here behind a transcript being read in pages, in order. */
  #delivery: Promise<void> | undefined;
  /** One paged read at a time: each restarts the host's snapshot. */
  #reading: Promise<unknown> = Promise.resolve();
  #exitListeners = new Set<() => void>();
  #ended = false;
  #lost = false;

  constructor(worker: string, link: RemoteSessionLink, transcript: { transcript: TranscriptEntry[]; seq: number }) {
    this.#worker = worker;
    this.#link = link;
    this.#state = link.started.state;
    this.#stateSeq = link.started.seq;
    this.#applyTranscript(transcript.transcript, transcript.seq);
    const state = this.#state;
    // Only what the remote runtime offers is exposed, so the gateway never
    // shows a control that would fail.
    const self = this as unknown as Record<string, unknown>;
    for (const name of ["steer", "followUp", "abort", "setModel", "setThinking", "respondQuestion", "cancelQuestion", "compact", "cancelCompaction", "rewind", "continueRun", "listModels", "listCommands", "inspect", "attachmentImage", "clear", "reload"]) {
      if (!state.methods.includes(name)) self[name] = undefined;
    }
  }

  get processId(): undefined { return undefined; }
  get sessionId(): string { return this.#state.sessionId; }
  get sessionFile(): string | undefined { return this.#state.sessionFile; }
  get isStreaming(): boolean { return this.#state.isStreaming; }
  get resumesInterruptedRuns(): boolean { return this.#state.resumesInterruptedRuns; }

  /** A frame from the host for this session. */
  receive(frame: Frame): void {
    if (!this.#delivery && !frame.transcriptPaged) {
      this.#apply(frame);
      return;
    }
    const delivery: Promise<void> = (this.#delivery ?? Promise.resolve()).then(async () => {
      this.#apply(frame.transcriptPaged ? { ...frame, ...await this.#readTranscript().catch(() => ({})) } : frame);
    }).catch((error: unknown) => console.error(error));
    this.#delivery = delivery;
    void delivery.finally(() => { if (this.#delivery === delivery) this.#delivery = undefined; });
  }

  #apply(frame: Frame): void {
    if (frame.state && frame.seq !== undefined && frame.seq > this.#stateSeq) {
      this.#state = frame.state;
      this.#stateSeq = frame.seq;
    }
    if (frame.transcript && frame.seq !== undefined) this.#applyTranscript(frame.transcript, frame.seq);
    if (!frame.event) return;
    if (this.#early) this.#early.push(frame.event);
    else for (const listener of [...this.#listeners]) listener(frame.event);
  }

  #applyTranscript(transcript: TranscriptEntry[], seq: number): void {
    if (seq <= this.#transcriptSeq) return;
    this.#transcript = transcript;
    this.#transcriptSeq = seq;
  }

  #readTranscript(): Promise<{ transcript: TranscriptEntry[]; seq: number }> {
    const read = this.#reading.catch(() => undefined).then(() => this.#link.transcript());
    this.#reading = read;
    return read;
  }

  /** The connection or the remote runtime is gone. */
  lost(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#lost = true;
    for (const listener of [...this.#exitListeners]) listener();
  }

  async #call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (this.#ended) throw new Error("The remote worker connection is closed.");
    const reply = await this.#link.call(method, args) as Frame & { result?: T };
    this.#apply(reply.transcriptPaged ? { ...reply, ...await this.#readTranscript() } : reply);
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
    // Delivered once the caller has finished subscribing, before anything newer.
    if (this.#early) {
      queueMicrotask(() => {
        const early = this.#early ?? [];
        this.#early = undefined;
        for (const event of early) for (const each of [...this.#listeners]) each(event);
      });
    }
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
    // Lost before anyone listened: still reported, after the caller's setup.
    if (this.#lost) queueMicrotask(() => { if (this.#exitListeners.has(listener)) listener(); });
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
      const early: Frame[] = [];
      let lostEarly = false;
      const link = await workers.startSession(worker, options.huiSessionId ?? "", tool, options, {
        receive: (frame) => { if (session) session.receive(frame); else early.push(frame); },
        lost: () => { if (session) session.lost(); else lostEarly = true; },
      });
      const { started } = link;
      const transcript = started.transcript ? { transcript: started.transcript, seq: started.seq } : await link.transcript();
      session = new RemoteRuntimeSession(worker, link, transcript);
      for (const frame of early) session.receive(frame);
      if (lostEarly) session.lost();
      return session;
    },
  };
}
