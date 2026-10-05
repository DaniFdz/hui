import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import type {
  AgentRuntime,
  PromptAttachment,
  RuntimeEvent,
  RuntimeCommand,
  RuntimeModel,
  RuntimeQuestion,
  RuntimeQuestionResponse,
  RuntimeQueue,
  RuntimeRewindTarget,
  RuntimeSession,
  StartOptions,
  TranscriptEntry,
} from "./runtimes/types.ts";
import { DEFAULT_SETTINGS } from "../src/lib/settings.ts";
import { RuntimeOutputError, RuntimeUnreachableError, type RuntimeUnreachable } from "./runtimes/types.ts";

// The registry path is read once, at import time, so the throwaway home has to
// be in place before the module is loaded.
process.env["XDG_CONFIG_HOME"] = await mkdtemp(join(tmpdir(), "hui-live-"));

const { LiveSessions, SessionBusyError } = await import("./live-sessions.ts");
const { deleteSession } = await import("./hui.ts");
const { readRegistry, SessionRegistryError } = await import("./sessions.ts");
const { readObservability } = await import("./observability.ts");
const { workers } = await import("./workers.ts");
type SessionRecord = import("./sessions.ts").SessionRecord;
type SessionStreamMessage = import("./live-sessions.ts").SessionStreamMessage;
type SessionSnapshot = import("./live-sessions.ts").SessionSnapshot;

/** Stands in for a pi subprocess, so the state machine can be driven event by
 * event instead of waiting five seconds for a real boot. */
class FakeSession implements RuntimeSession {
  readonly processId = 4242;
  sessionId = "pi-1";
  sessionFile: string | undefined = "/tmp/hui-live.jsonl";
  prompts: string[] = [];
  attachments: (readonly PromptAttachment[] | undefined)[] = [];
  aborts = 0;
  switched: string[] = [];
  steered: string[] = [];
  followedUp: string[] = [];
  thinking = "medium";
  questionResponses: Array<{ id: string; response?: RuntimeQuestionResponse; cancelled?: true }> = [];
  queue: RuntimeQueue = { steering: [], followUp: [] };
  questions: RuntimeQuestion[] = [];
  history: TranscriptEntry[] = [{ kind: "message", role: "user", text: "hello" }];
  disposed = false;
  rewoundTo: Array<{ target: RuntimeRewindTarget; excludeUserMessage?: boolean }> = [];
  continuations = 0;
  clears = 0;
  clearGate: Promise<void> | undefined;
  reloads = 0;
  reloadGate: Promise<void> | undefined;

  #streaming = false;
  #listeners = new Set<(event: RuntimeEvent) => void>();
  #exitListeners = new Set<() => void>();
  #model: RuntimeModel | undefined = { provider: "anthropic", id: "sonnet", name: "Sonnet" };

  get isStreaming(): boolean {
    return this.#streaming;
  }

  /** PiSession stays busy from a compaction's end until its own settle. */
  compactionEnded(event: Extract<RuntimeEvent, { type: "compaction_end" }>): void {
    this.#streaming = true;
    this.emit(event);
  }

  async prompt(text: string, attachments?: readonly PromptAttachment[]): Promise<void> {
    this.prompts.push(text);
    this.attachments.push(attachments);
    this.#streaming = true;
  }

  async steer(text: string): Promise<void> {
    this.steered.push(text);
  }

  compactions: (string | undefined)[] = [];
  async compact(instructions?: string): Promise<void> {
    this.compactions.push(instructions);
  }

  compactionCancels = 0;
  async cancelCompaction(): Promise<void> {
    this.compactionCancels += 1;
  }

  async followUp(text: string): Promise<void> {
    this.followedUp.push(text);
  }

  currentModel(): RuntimeModel | undefined {
    return this.#model;
  }

  async listModels(): Promise<readonly RuntimeModel[]> {
    return [
      { provider: "anthropic", id: "sonnet", name: "Sonnet" },
      { provider: "openai", id: "gpt", name: "GPT" },
    ];
  }

  async setModel(provider: string, id: string): Promise<void> {
    this.switched.push(`${provider}/${id}`);
    this.#model = { provider, id, name: id };
  }

  currentThinking(): string | undefined {
    return this.thinking;
  }

  async setThinking(level: string): Promise<void> {
    this.thinking = level;
  }

  pendingQueue(): RuntimeQueue {
    return this.queue;
  }

  pendingQuestions(): readonly RuntimeQuestion[] {
    return this.questions;
  }

  async respondQuestion(id: string, response: RuntimeQuestionResponse): Promise<void> {
    this.questionResponses.push({ id, response });
  }

  async cancelQuestion(id: string): Promise<void> {
    this.questionResponses.push({ id, cancelled: true });
  }

  async abort(): Promise<void> {
    this.aborts += 1;
    this.#streaming = false;
  }

  async reload(): Promise<void> {
    await this.reloadGate;
    this.reloads += 1;
  }

  async clear(): Promise<void> {
    await this.clearGate;
    this.clears += 1;
    this.sessionId = `pi-${this.clears + 1}`;
    this.sessionFile = `/tmp/hui-cleared-${this.clears}.jsonl`;
    this.history = [];
    this.queue = { steering: [], followUp: [] };
    this.questions = [];
  }

  async rewind(target: RuntimeRewindTarget, options?: { excludeUserMessage?: boolean }): Promise<void> {
    this.rewoundTo.push({ target, excludeUserMessage: options?.excludeUserMessage });
    this.history = [{ kind: "message", role: "user", text: `rewound:${JSON.stringify(target)}` }];
  }

  async continueRun(): Promise<void> {
    this.continuations += 1;
    this.#streaming = true;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  onExit(listener: () => void): () => void {
    this.#exitListeners.add(listener);
    return () => {
      this.#exitListeners.delete(listener);
    };
  }

  transcript(): TranscriptEntry[] {
    return this.history.map((entry) => ({ ...entry }));
  }

  dispose(): void {
    this.disposed = true;
  }

  get listenerCount(): number {
    return this.#listeners.size + this.#exitListeners.size;
  }

  emit(event: RuntimeEvent): void {
    // The real adapter clears its streaming flag when a turn ends; the fake has
    // to do the same, because the reported status is derived from that flag.
    if (event.type === "turn_end" || event.type === "settled") {
      this.#streaming = false;
    }
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  exit(): void {
    this.#streaming = false;
    for (const listener of this.#exitListeners) {
      listener();
    }
  }
}

function factory(started: FakeSession[], options: StartOptions[] = []): AgentRuntime {
  return {
    id: "pi",
    start: async (startOptions) => {
      const session = new FakeSession();
      started.push(session);
      options.push(startOptions);
      return session;
    },
  };
}

/**
 * Waits for a session to finish booting instead of sleeping a fixed 10ms. Under
 * load the fake boot can take longer than the delay, which made this file flaky
 * (roughly one full-suite run in three).
 */
async function waitForBoot(
  manager: {
    status(id: string): string;
    subscribe(id: string, subscriber: (message: SessionStreamMessage) => void): () => void;
  },
  id: string,
): Promise<void> {
  if (manager.status(id) === "idle") return;
  await new Promise<void>((resolve, reject) => {
    const unsubscribe = manager.subscribe(id, (message) => {
      const status = message.kind === "status" ? message.status : message.kind === "snapshot" ? message.snapshot.status : undefined;
      if (status === "idle") {
        unsubscribe();
        resolve();
      } else if (status === "error") {
        unsubscribe();
        reject(new Error(`session ${id} failed to boot`));
      }
    });
  });
}

async function waitForStatus(
  manager: InstanceType<typeof LiveSessions>,
  id: string,
  expected: string,
): Promise<void> {
  if (manager.status(id) === expected) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = manager.subscribe(id, (message) => {
      const status = message.kind === "status" ? message.status : message.kind === "snapshot" ? message.snapshot.status : undefined;
      if (status === expected) {
        unsubscribe();
        resolve();
      }
    });
  });
}

function recordFor(id: string): SessionRecord {
  const now = new Date().toISOString();
  return { id, title: id, group: "", cwd: tmpdir(), tool: "pi", createdAt: now, updatedAt: now };
}

test("tool inspection never boots cold sessions and marks unsupported runtimes honestly", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  assert.deepEqual(await manager.inspect("cold"), { status: "cold" });
  assert.equal(started.length, 0);
  manager.ensure(recordFor("inspect"));
  await waitForBoot(manager, "inspect");
  assert.deepEqual(await manager.inspect("inspect"), { status: "unsupported" });
  const runtime = started[0]! as FakeSession & Pick<RuntimeSession, "inspect">;
  runtime.inspect = async () => ({ status: "live", backend: "sdk", version: "fixture", revision: "1", tools: [], prompt: "fixture", promptPhase: "initialized", promptSource: "fixture", diagnostics: [] });
  assert.equal((await manager.inspect("inspect")).status, "live");
  runtime.inspect = async () => { throw new Error("worker failed"); };
  await assert.rejects(manager.inspect("inspect"), /worker failed/u);
  manager.disposeAll();
});

test("a session reports starting at once and becomes idle when pi is up", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("boot");
  const seen: SessionStreamMessage[] = [];

  assert.equal(manager.isLive("boot"), false);
  manager.ensure(record);
  assert.equal(manager.isLive("boot"), true);
  assert.equal(manager.status("boot"), "starting", "the reply must not wait for the boot");

  manager.subscribe("boot", (message) => seen.push(message));
  // A second open must reuse the runtime rather than spawn another pi.
  manager.ensure(record);
  await waitForBoot(manager, "boot");

  assert.equal(started.length, 1);
  assert.equal(manager.status("boot"), "idle");
  assert.equal(manager.hasRuntime("boot"), true);
  assert.equal(manager.runtimeTelemetry().get("boot")?.pid, 4242);
  assert.ok((manager.runtimeTelemetry().get("boot")?.bootDurationMs ?? -1) >= 0);
  assert.deepEqual(manager.transcript("boot"), [{ kind: "message", role: "user", text: "hello" }]);
  assert.deepEqual(
    seen.map((message) => message.kind),
    ["snapshot"],
  );
  assert.equal(seen[0]?.kind === "snapshot" ? seen[0].snapshot.status : undefined, "idle");

  const stored = (await readRegistry()).find((session) => session.id === "boot");
  assert.equal(stored?.piSessionFile, "/tmp/hui-live.jsonl");
});

test("runtime telemetry is ephemeral and disappears when the runtime closes", async () => {
  const manager = new LiveSessions(factory([]));
  manager.ensure(recordFor("metrics"));
  assert.deepEqual(manager.runtimeTelemetry().get("metrics"), { active: true });
  await waitForBoot(manager, "metrics");
  assert.equal(manager.runtimeTelemetry().get("metrics")?.pid, 4242);
  manager.close("metrics");
  assert.equal(manager.runtimeTelemetry().has("metrics"), false);
});

test("clearing replaces PI context in place, persists its new identity, and rejects active work", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const seen: SessionStreamMessage[] = [];
  manager.ensure(recordFor("clear"));
  manager.subscribe("clear", (message) => seen.push(message));
  await waitForBoot(manager, "clear");

  await manager.prompt("clear", "still working");
  await assert.rejects(() => manager.clear("clear"), SessionBusyError);
  started[0]!.emit({ type: "settled" });

  let releaseClear!: () => void;
  started[0]!.clearGate = new Promise<void>((resolve) => { releaseClear = resolve; });
  const clearing = manager.clear("clear");
  await assert.rejects(() => manager.prompt("clear", "racing prompt"), SessionBusyError);
  releaseClear();
  const snapshot = await clearing;
  assert.equal(started[0]!.clears, 1);
  assert.deepEqual(snapshot.transcript, []);
  assert.equal(snapshot.status, "idle");
  assert.deepEqual(manager.transcript("clear"), []);
  assert.equal(
    seen.filter((message) => message.kind === "snapshot").at(-1)?.kind,
    "snapshot",
  );
  const stored = (await readRegistry()).find((session) => session.id === "clear");
  assert.equal(stored?.piSessionFile, "/tmp/hui-cleared-1.jsonl");
  assert.equal(stored?.id, "clear", "HUI keeps the same registry row");
  manager.disposeAll();
});

test("reloading keeps the PI session, holds off prompts meanwhile, and rejects active work", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure(recordFor("reload"));
  await waitForBoot(manager, "reload");

  await manager.prompt("reload", "still working");
  await assert.rejects(() => manager.reload("reload"), SessionBusyError);
  started[0]!.emit({ type: "settled" });

  let release!: () => void;
  started[0]!.reloadGate = new Promise<void>((resolve) => { release = resolve; });
  const reloading = manager.reload("reload");
  await assert.rejects(() => manager.prompt("reload", "racing prompt"), SessionBusyError);
  release();
  await reloading;
  assert.equal(started[0]!.reloads, 1);
  assert.equal(started.length, 1, "no new runtime is spawned");
  assert.equal(manager.snapshot("reload").status, "idle");
  manager.disposeAll();
});

test("one lifecycle subscriber receives tagged status for concurrent sessions", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const updates: Array<{ id: string; status: string }> = [];
  const watched = manager.watchStatuses((update) => updates.push(update));

  assert.deepEqual(watched.statuses, []);
  manager.ensure(recordFor("parallel-a"));
  manager.ensure(recordFor("parallel-b"));
  await Promise.all([
    waitForBoot(manager, "parallel-a"),
    waitForBoot(manager, "parallel-b"),
  ]);

  assert.deepEqual(
    updates.slice(0, 4),
    [
      { id: "parallel-a", status: "starting" },
      { id: "parallel-b", status: "starting" },
      { id: "parallel-a", status: "idle" },
      { id: "parallel-b", status: "idle" },
    ],
  );

  await manager.prompt("parallel-a", "first task");
  await manager.prompt("parallel-b", "second task");
  assert.equal(manager.status("parallel-a"), "running");
  assert.equal(manager.status("parallel-b"), "running");
  assert.deepEqual(updates.slice(-2), [
    { id: "parallel-a", status: "running" },
    { id: "parallel-b", status: "running" },
  ]);

  started[0]?.emit({ type: "settled" });
  assert.deepEqual(updates.at(-1), { id: "parallel-a", status: "idle" });
  assert.equal(manager.status("parallel-b"), "running");
  const current = manager.watchStatuses(() => {});
  assert.deepEqual(
    current.statuses,
    [
      { id: "parallel-a", status: "idle" },
      { id: "parallel-b", status: "running" },
    ],
  );
  current.unsubscribe();
  watched.unsubscribe();
  manager.disposeAll();
});

test("a prompt flips running and idle, and a second one while streaming is refused", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("prompt");
  manager.ensure(record);
  await waitForBoot(manager, "prompt");

  await manager.prompt("prompt", "do the thing");
  assert.equal(started[0]?.prompts.at(-1), "do the thing");
  assert.ok((await readRegistry()).find((session) => session.id === "prompt")?.runStartedAt);
  assert.equal((await readRegistry()).find((session) => session.id === "prompt")?.runPrompt, "do the thing");

  started[0]?.emit({ type: "turn_start" });
  assert.equal(manager.status("prompt"), "running");
  await assert.rejects(() => manager.prompt("prompt", "again"), SessionBusyError);

  started[0]?.emit({ type: "settled" });
  assert.equal(manager.status("prompt"), "idle");
  await new Promise<void>((resolve) => {
    const inspect = async () => {
      if (!(await readRegistry()).find((session) => session.id === "prompt")?.runStartedAt) resolve();
      else setImmediate(() => void inspect());
    };
    void inspect();
  });
});

test("a gateway restart automatically continues the journaled request", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure(recordFor("interrupted"));
  await waitForBoot(manager, "interrupted");

  await manager.prompt("interrupted", "long task");
  manager.disposeAll();

  const durable = (await readRegistry()).find((session) => session.id === "interrupted");
  assert.ok(durable?.runStartedAt, "the unfinished marker survives gateway shutdown");
  assert.equal(durable?.runPrompt, "long task");
  const resumed: FakeSession[] = [];
  const replacement = new LiveSessions(factory(resumed));
  replacement.ensure(durable!);
  await waitForStatus(replacement, "interrupted", "running");
  await new Promise<void>((resolve) => {
    const inspect = () => {
      if (resumed[0]?.prompts.length) resolve();
      else setImmediate(inspect);
    };
    inspect();
  });
  assert.match(resumed[0]?.prompts.at(-1) ?? "", /long task/u);
  assert.equal((await readRegistry()).find((session) => session.id === "interrupted")?.runRecoveryAttempts, 1);
});

test("a runtime that resumes its own runs is never replayed after a restart", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions({
    id: "durable",
    start: async () => {
      const session = Object.assign(new FakeSession(), { resumesInterruptedRuns: true });
      started.push(session);
      return session;
    },
  });
  manager.ensure({
    ...recordFor("self-resuming"),
    tool: "durable",
    runStartedAt: "2026-09-24T12:00:00.000Z",
    runPrompt: "the original task",
  });
  await waitForBoot(manager, "self-resuming");
  await new Promise<void>((resolve) => {
    const inspect = async () => {
      if (!(await readRegistry()).find((session) => session.id === "self-resuming")?.runStartedAt) resolve();
      else setImmediate(() => void inspect());
    };
    void inspect();
  });
  assert.deepEqual(started[0]?.prompts, [], "no recovery prompt is sent");
  const record = (await readRegistry()).find((session) => session.id === "self-resuming");
  assert.equal(record?.runPrompt, undefined);
  assert.equal(record?.runRecoveryAttempts, undefined);
});

test("only work a restart would lose blocks an ordinary gateway stop", async () => {
  const counts = (manager: InstanceType<typeof LiveSessions>) =>
    [manager.activeWorkCount, manager.resumableWorkCount, manager.blockingWorkCount];
  const resuming: FakeSession[] = [];
  const durable = new LiveSessions({
    id: "durable",
    start: async () => {
      const session = Object.assign(new FakeSession(), { resumesInterruptedRuns: true });
      resuming.push(session);
      return session;
    },
  });
  durable.ensure({ ...recordFor("resumable-run"), tool: "durable" });
  assert.deepEqual(counts(durable), [1, 0, 1], "a booting runtime holds nothing it could resume yet");
  await waitForBoot(durable, "resumable-run");
  assert.deepEqual(counts(durable), [0, 0, 0]);
  const submitted = durable.prompt("resumable-run", "long task");
  assert.deepEqual(counts(durable), [1, 0, 1], "a prompt the runtime has not accepted yet exists only here");
  await submitted;
  resuming[0]?.emit({ type: "turn_start" });
  assert.equal(durable.status("resumable-run"), "running");
  assert.deepEqual(counts(durable), [1, 1, 0], "the runtime continues this run after a restart");
  await durable.followUp("resumable-run", "then summarize");
  assert.deepEqual(counts(durable), [1, 0, 1], "a follow-up held only in this process blocks");
  durable.disposeAll();

  const started: FakeSession[] = [];
  const pi = new LiveSessions(factory(started));
  pi.ensure(recordFor("interruptible-run"));
  await waitForBoot(pi, "interruptible-run");
  await pi.prompt("interruptible-run", "long task");
  started[0]?.emit({ type: "turn_start" });
  assert.deepEqual(counts(pi), [1, 0, 1], "a runtime that cannot resume its run blocks");
  pi.disposeAll();
});

test("manual continuation remains available after automatic recovery is exhausted", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure({
    ...recordFor("continue-interrupted"),
    runStartedAt: "2026-09-24T12:00:00.000Z",
    runPrompt: "finish the original task",
    runRecoveryAttempts: 3,
  });
  await waitForBoot(manager, "continue-interrupted");
  assert.deepEqual(started[0]?.prompts, []);

  await manager.continueInterrupted("continue-interrupted");
  assert.match(started[0]?.prompts.at(-1) ?? "", /finish the original task/);
  const durable = (await readRegistry()).find((session) => session.id === "continue-interrupted");
  assert.equal(durable?.runPrompt, "finish the original task");
  assert.equal(durable?.runRecoveryAttempts, undefined);
});

test("settled background activity becomes unread and a reader clears it", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const updates: import("./live-sessions.ts").SessionStatusUpdate[] = [];
  manager.watchStatuses((update) => updates.push(update));
  manager.ensure(recordFor("unread"));
  await waitForBoot(manager, "unread");

  await manager.prompt("unread", "finish in background");
  started[0]?.emit({ type: "settled" });
  await new Promise<void>((resolve) => {
    const inspect = async () => {
      if ((await readRegistry()).find((session) => session.id === "unread")?.unread) resolve();
      else setImmediate(() => void inspect());
    };
    void inspect();
  });
  assert.equal(updates.at(-1)?.unread, true);

  const reader = manager.watch("unread", () => {}, { reader: true });
  await new Promise<void>((resolve) => {
    const inspect = async () => {
      if (!(await readRegistry()).find((session) => session.id === "unread")?.unread) resolve();
      else setImmediate(() => void inspect());
    };
    void inspect();
  });
  assert.equal(updates.at(-1)?.unread, false);

  await manager.prompt("unread", "finish while visible");
  started[0]?.emit({ type: "settled" });
  assert.equal((await readRegistry()).find((session) => session.id === "unread")?.unread, undefined);
  reader.unsubscribe();
});

test("a primary failure before output retries once on the configured fallback", async () => {
  const started: FakeSession[] = [];
  let retried!: () => void;
  const retryAccepted = new Promise<void>((resolve) => { retried = resolve; });
  const runtime = factory(started);
  const manager = new LiveSessions(runtime, undefined, async () => ({
    ...DEFAULT_SETTINGS,
    models: { primary: "openai/gpt", fallback: "anthropic/sonnet", utility: "openai/tiny" },
  }));
  manager.ensure(recordFor("fallback"));
  await waitForBoot(manager, "fallback");
  const session = started[0]!;
  await session.setModel("openai", "gpt");
  session.switched = [];
  const originalPrompt = session.prompt.bind(session);
  session.prompt = async (text, attachments) => {
    await originalPrompt(text, attachments);
    if (session.prompts.length === 2) retried();
  };

  await manager.prompt("fallback", "keep working");
  session.history = [
    { kind: "message", role: "user", text: "keep working" },
    { kind: "error", message: "provider unavailable" },
  ];
  session.emit({ type: "settled" });
  await retryAccepted;

  assert.deepEqual(session.switched, ["anthropic/sonnet"]);
  assert.deepEqual(session.prompts, ["keep working", "keep working"]);
  session.history.push({ kind: "error", message: "fallback unavailable" });
  session.emit({ type: "settled" });
  assert.deepEqual(session.prompts, ["keep working", "keep working"], "fallback is attempted only once");
});

test("the manager closes the prompt race before a runtime reports streaming", async () => {
  let accept!: () => void;
  const accepted = new Promise<void>((resolve) => {
    accept = resolve;
  });
  const listeners = new Set<(event: RuntimeEvent) => void>();
  const session: RuntimeSession = {
    sessionId: "pi-concurrent",
    sessionFile: "/tmp/pi-concurrent.jsonl",
    get isStreaming() {
      // Models the real race: the RPC prompt response can arrive before PI's
      // later `agent_start` event changes the adapter's streaming state.
      return false;
    },
    async prompt() {
      await accepted;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    transcript: () => [],
    dispose: () => {},
  };
  const manager = new LiveSessions({ id: "pi", start: async () => session });
  manager.ensure(recordFor("concurrent"));
  await waitForBoot(manager, "concurrent");

  const first = manager.prompt("concurrent", "first");
  await assert.rejects(() => manager.prompt("concurrent", "second"), SessionBusyError);
  accept();
  await first;
  // Acceptance alone must not reopen the gate: agent_start may still be queued
  // behind the RPC response.
  await assert.rejects(() => manager.prompt("concurrent", "third"), SessionBusyError);

  for (const listener of listeners) {
    listener({ type: "settled" });
  }
  await manager.prompt("concurrent", "after settlement");
});

test("a prompt during boot is refused rather than queued", async () => {
  const manager = new LiveSessions(factory([]));
  manager.ensure(recordFor("early"));
  await assert.rejects(() => manager.prompt("early", "too soon"), SessionBusyError);
});

test("a refused runtime prompt releases the manager-owned busy guard", async () => {
  let attempts = 0;
  const session: RuntimeSession = {
    sessionId: "pi-refused",
    sessionFile: "/tmp/pi-refused.jsonl",
    isStreaming: false,
    async prompt() {
      attempts += 1;
      throw new Error("runtime refused");
    },
    subscribe: () => () => {},
    transcript: () => [],
    dispose: () => {},
  };
  const manager = new LiveSessions({ id: "pi", start: async () => session });
  manager.ensure(recordFor("refused"));
  await waitForBoot(manager, "refused");

  await assert.rejects(() => manager.prompt("refused", "first"), /runtime refused/);
  assert.equal(manager.status("refused"), "idle");
  await assert.rejects(() => manager.prompt("refused", "retry"), /runtime refused/);
  assert.equal(attempts, 2, "the retry reached the runtime instead of being rejected as busy");
});

test("a runtime that dies marks the session error, then gets replaced on reopen", async () => {
  const started: FakeSession[] = [];
  const options: StartOptions[] = [];
  const manager = new LiveSessions(factory(started, options));
  const record = recordFor("dead");
  const seen: SessionStreamMessage[] = [];
  manager.ensure(record);
  manager.subscribe("dead", (message) => seen.push(message));
  await waitForBoot(manager, "dead");

  started[0]?.exit();
  assert.equal(manager.status("dead"), "error");
  assert.equal(manager.hasRuntime("dead"), false);
  assert.equal(seen.at(-1)?.kind, "closed");

  const durable = (await readRegistry()).find((session) => session.id === "dead");
  assert.equal(durable?.piSessionFile, "/tmp/hui-live.jsonl");
  manager.ensure(durable ?? record);
  await waitForBoot(manager, "dead");
  assert.equal(started.length, 2, "a dead runtime must not block a fresh one");
  assert.equal(options[1]?.sessionFile, "/tmp/hui-live.jsonl", "reopen must resume pi's file");
  assert.deepEqual(manager.transcript("dead"), [{ kind: "message", role: "user", text: "hello" }]);
});

test("exit retry hides the dead runtime while replacement boot is pending", async () => {
  const dead = new FakeSession();
  const recovered = new FakeSession();
  let exitDead!: () => void;
  // Keep the callback callable after unsubscribe to model an exit notification
  // that was already queued before retry attached the replacement runtime.
  dead.onExit = (listener) => {
    exitDead = listener;
    return () => {};
  };
  let releaseReplacement!: () => void;
  const replacementBoot = new Promise<RuntimeSession>((resolve) => {
    releaseReplacement = () => resolve(recovered);
  });
  let starts = 0;
  const manager = new LiveSessions({
    id: "pi",
    start: async () => {
      starts += 1;
      return starts === 1 ? dead : replacementBoot;
    },
  });
  const record = recordFor("exit-retry-boundary");
  manager.ensure(record);
  await waitForBoot(manager, record.id);

  exitDead();
  assert.equal(manager.status(record.id), "error");
  manager.ensure(record);
  assert.equal(manager.status(record.id), "starting");
  await assert.rejects(() => manager.prompt(record.id, "must wait"), SessionBusyError);
  await assert.rejects(() => manager.models(record.id), SessionBusyError);
  await assert.rejects(() => manager.setModel(record.id, "openai", "gpt"), SessionBusyError);
  await assert.rejects(() => manager.abort(record.id), SessionBusyError);
  assert.deepEqual(dead.prompts, [], "the exited runtime was never called during retry");

  releaseReplacement();
  await waitForBoot(manager, record.id);
  exitDead();
  assert.equal(manager.status(record.id), "idle", "a stale exit cannot clear the replacement");
  await manager.prompt(record.id, "replacement is live");
  assert.deepEqual(recovered.prompts, ["replacement is live"]);
});

test("closing during a slow boot disposes the child and does not resurrect the record", async () => {
  let release!: (session: FakeSession) => void;
  const boot = new Promise<FakeSession>((resolve) => {
    release = resolve;
  });
  const manager = new LiveSessions({ id: "pi", start: () => boot });
  const record = recordFor("closed-during-boot");
  manager.ensure(record);
  manager.close(record.id);

  const session = new FakeSession();
  let markDisposed!: () => void;
  const disposed = new Promise<void>((resolve) => {
    markDisposed = resolve;
  });
  session.dispose = () => {
    session.disposed = true;
    markDisposed();
  };
  release(session);
  await disposed;

  assert.equal(session.disposed, true);
  assert.equal((await readRegistry()).some((item) => item.id === record.id), false);
});

test("release defers runtime cleanup until the last browser reader leaves", async () => {
  const session = new FakeSession();
  const manager = new LiveSessions({ id: "pi", start: async () => session });
  const record = recordFor("release-after-reader");
  manager.ensure(record);
  await waitForBoot(manager, record.id);

  const watched = manager.watch(record.id, () => {}, { reader: true });
  manager.release(record.id);
  assert.equal(manager.isLive(record.id), true);
  assert.equal(session.disposed, false);

  watched.unsubscribe();
  assert.equal(manager.isLive(record.id), false);
  assert.equal(session.disposed, true);
});

test("a reopened terminal subagent stays cold after reading or another turn", async () => {
  const terminal = recordFor("cold-subagent");
  terminal.parentId = "parent";
  terminal.subagent = {
    taskId: "task-cold",
    task: "Finished work",
    status: "completed",
    startedAt: terminal.createdAt,
    updatedAt: terminal.updatedAt,
    endedAt: terminal.updatedAt,
  };
  const session = new FakeSession();
  const manager = new LiveSessions({ id: "pi", start: async () => session });
  manager.ensure(terminal);
  await waitForBoot(manager, terminal.id);

  const reader = manager.watch(terminal.id, () => {}, { reader: true });
  reader.unsubscribe();
  assert.equal(manager.isLive(terminal.id), false);
  assert.equal(session.disposed, true);

  const resumed = new FakeSession();
  let markDisposed!: () => void;
  const disposed = new Promise<void>((resolve) => { markDisposed = resolve; });
  resumed.dispose = () => {
    resumed.disposed = true;
    markDisposed();
  };
  const resumedManager = new LiveSessions({ id: "pi", start: async () => resumed });
  resumedManager.ensure(terminal);
  await waitForBoot(resumedManager, terminal.id);
  const resumedReader = resumedManager.watch(terminal.id, () => {}, { reader: true });
  await resumedManager.prompt(terminal.id, "One more question");
  resumedReader.unsubscribe();
  assert.equal(resumedManager.isLive(terminal.id), true, "leaving mid-turn does not abort the child");
  resumed.emit({ type: "settled" });
  await disposed;
  assert.equal(resumedManager.isLive(terminal.id), false);
});

test("a persistence failure cleans up the runtime and leaves boot in error", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started), async () => {
    throw new Error("registry unavailable");
  });
  const seen: SessionStreamMessage[] = [];
  manager.ensure(recordFor("save-failed"));
  manager.subscribe("save-failed", (message) => seen.push(message));

  await waitForStatus(manager, "save-failed", "error");

  assert.equal(manager.status("save-failed"), "error");
  assert.equal(started[0]?.disposed, true);
  assert.equal(started[0]?.listenerCount, 0);
  assert.equal(seen.some((message) => message.kind === "status" && message.status === "idle"), false);
});

test("retry after a boot error preserves subscribers through starting to idle", async () => {
  const recovered = new FakeSession();
  let attempts = 0;
  const manager = new LiveSessions({
    id: "pi",
    start: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("first boot failed");
      return recovered;
    },
  });
  const seen: SessionStreamMessage[] = [];
  const record = recordFor("retry-subscribers");
  manager.ensure(record);
  manager.subscribe(record.id, (message) => seen.push(message));
  await waitForStatus(manager, record.id, "error");

  assert.equal(manager.ensure(record), true);
  await waitForBoot(manager, record.id);

  assert.equal(attempts, 2);
  assert.deepEqual(
    seen.flatMap((message) =>
      message.kind === "status"
        ? [message.status]
        : message.kind === "snapshot"
          ? [message.snapshot.status]
          : [],
    ),
    ["error", "starting", "idle"],
  );
});

test("a boot failure keeps its redacted cause in diagnostics", async () => {
  const manager = new LiveSessions({
    id: "pi",
    start: async () => {
      throw new Error("400 validation failed for this model (api_key=sk-live-0123456789abcdef)");
    },
  });
  const record = recordFor("boot-cause");
  manager.ensure(record);
  await waitForStatus(manager, record.id, "error");

  const failure = (await readObservability([])).logs.find((entry) => entry.sessionId === record.id && entry.action === "boot_failed");
  assert.equal(failure?.summary, "Runtime did not start");
  assert.equal(failure?.detail, "400 validation failed for this model (api_key=[redacted])");
});

test("a start failure keeps runtime stderr in diagnostics, not in the browser event", async () => {
  const manager = new LiveSessions({
    id: "pi",
    start: async () => {
      throw new RuntimeOutputError("pi exited with code 1", "Error: boom | at start (/tmp/worker.js:1:1)");
    },
  });
  const record = recordFor("boot-output");
  const seen: SessionStreamMessage[] = [];
  manager.ensure(record);
  manager.subscribe(record.id, (message) => seen.push(message));
  await waitForStatus(manager, record.id, "error");

  const failure = (await readObservability([])).logs.find((entry) => entry.sessionId === record.id && entry.action === "boot_failed");
  assert.equal(failure?.detail, "pi exited with code 1 · stderr: Error: boom | at start (/tmp/worker.js:1:1)");
  assert.deepEqual(seen.flatMap((message) => message.kind === "event" ? [message.event] : []), [
    { type: "error", message: "pi exited with code 1" },
  ]);
});

test("a runtime error's process output reaches diagnostics but never the browser", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("error-output");
  const seen: SessionStreamMessage[] = [];
  manager.ensure(record);
  manager.subscribe(record.id, (message) => seen.push(message));
  await waitForBoot(manager, record.id);

  started[0]!.emit({ type: "error", message: "pi exited with code 1", output: "Error: boom" });
  const diagnostic = (await readObservability([])).logs.find((entry) => entry.sessionId === record.id && entry.action === "error");
  assert.equal(diagnostic?.detail, "pi exited with code 1 · stderr: Error: boom");
  assert.deepEqual(seen.flatMap((message) => message.kind === "event" ? [message.event] : []), [
    { type: "error", message: "pi exited with code 1" },
  ]);
  assert.deepEqual(manager.transcript(record.id).at(-1), { kind: "error", message: "pi exited with code 1" });
});

test("a turn that settles on a provider error is logged once with its cause", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("run-failure");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  const session = started[0]!;
  const logged = async (action: string) =>
    (await readObservability([])).logs.filter((entry) => entry.sessionId === record.id && entry.action === action);
  const providerError = '400 {"type":"error","error":{"message":"validation failed"}}';

  await manager.prompt(record.id, "hi");
  session.emit({ type: "turn_start" });
  session.history = [
    { kind: "message", role: "user", text: "hi" },
    { kind: "error", message: providerError },
  ];
  session.emit({ type: "settled" });
  assert.deepEqual((await logged("run_failed")).map((entry) => [entry.level, entry.detail]), [["error", providerError]]);

  // A command settles without a model turn; the older failure is not new.
  session.emit({ type: "settled" });
  assert.equal((await logged("run_failed")).length, 1);

  // A failure the runtime already reported as an error event is not repeated.
  await waitForStatus(manager, record.id, "idle");
  await manager.prompt(record.id, "again");
  session.emit({ type: "turn_start" });
  session.emit({ type: "error", message: "Claude Code could not reach the API." });
  session.history.push({ kind: "error", message: "Claude Code could not reach the API." });
  session.emit({ type: "settled" });
  assert.equal((await logged("run_failed")).length, 1);
  assert.deepEqual((await logged("error")).map((entry) => entry.detail), ["Claude Code could not reach the API."]);
});

test("an exit while runtime identity is saving is never overwritten with idle", async () => {
  let saveStarted!: () => void;
  const saving = new Promise<void>((resolve) => {
    saveStarted = resolve;
  });
  let releaseSave!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started), async (mutate) => {
    saveStarted();
    await release;
    return [...mutate([])];
  });
  const seen: SessionStreamMessage[] = [];
  manager.ensure(recordFor("exit-during-save"));
  manager.subscribe("exit-during-save", (message) => seen.push(message));
  await saving;

  started[0]?.exit();
  releaseSave();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(manager.status("exit-during-save"), "error");
  const statuses = seen.filter((message) => message.kind === "status").map((message) => message.status);
  assert.deepEqual(statuses, ["error"]);
});

test("a stale open cannot revive an id after DELETE tombstones it", () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const staleRecord = recordFor("deleted-before-open");

  manager.tombstone(staleRecord.id);
  assert.equal(manager.ensure(staleRecord), false);
  assert.equal(started.length, 0);
});

test("DELETE keeps runtime and subscribers alive until persistence commits", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("delete-commit-order");
  const seen: SessionStreamMessage[] = [];
  manager.ensure(record);
  manager.subscribe(record.id, (message) => seen.push(message));
  await waitForBoot(manager, record.id);

  let persistenceStarted!: () => void;
  const startedPersisting = new Promise<void>((resolve) => {
    persistenceStarted = resolve;
  });
  let commit!: () => void;
  const mayCommit = new Promise<void>((resolve) => {
    commit = resolve;
  });
  const deleting = deleteSession(record.id, manager, async (mutate) => {
    persistenceStarted();
    await mayCommit;
    return [...mutate([record])];
  });
  await startedPersisting;

  assert.equal(manager.ensure(record), false, "the tombstone blocks new opens during commit");
  assert.equal(started[0]?.disposed, false);
  started[0]?.emit({ type: "text", delta: "still live" });
  assert.deepEqual(seen.at(-1), { kind: "event", event: { type: "text", delta: "still live" } });

  commit();
  await deleting;
  assert.equal(started[0]?.disposed, true);
  assert.equal(started[0]?.listenerCount, 0);
  assert.equal(seen.at(-1)?.kind, "closed");
});

test("failed DELETE rolls back the tombstone without closing runtime or subscribers", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("delete-rollback-live");
  const seen: SessionStreamMessage[] = [];
  manager.ensure(record);
  manager.subscribe(record.id, (message) => seen.push(message));
  await waitForBoot(manager, record.id);

  await assert.rejects(
    () =>
      deleteSession(record.id, manager, async () => {
        throw new SessionRegistryError("disk full");
      }),
    SessionRegistryError,
  );

  assert.equal(manager.ensure(record), true, "the existing runtime is openable again");
  assert.equal(started.length, 1, "rollback reuses rather than respawns the runtime");
  assert.equal(started[0]?.disposed, false);
  assert.equal(seen.some((message) => message.kind === "closed"), false);
  started[0]?.emit({ type: "text", delta: "survived" });
  assert.deepEqual(seen.at(-1), { kind: "event", event: { type: "text", delta: "survived" } });
});

test("overlapping DELETE rollback cannot clear another pending or committed tombstone", async () => {
  const manager = new LiveSessions(factory([]));
  const record = recordFor("overlapping-delete");
  const first = manager.tombstone(record.id);
  const second = manager.tombstone(record.id);

  manager.rollbackDelete(record.id, first);
  assert.equal(manager.ensure(record), false, "the second pending delete still protects the id");

  manager.finishDelete(record.id, second);
  assert.equal(manager.ensure(record), false, "the successful delete remains committed");
  manager.rollbackDelete(record.id, first);
  assert.equal(manager.ensure(record), false, "a stale rollback token is inert");

  manager.accept(record.id);
  assert.equal(manager.ensure(record), true, "only explicit durable reimport clears protection");
});

test("a new manager resumes the PI file persisted by the previous gateway", async () => {
  const firstStarted: FakeSession[] = [];
  const id = "gateway-restart";
  const managerA = new LiveSessions(factory(firstStarted));
  managerA.ensure(recordFor(id));
  await waitForBoot(managerA, id);
  managerA.disposeAll();

  const durable = (await readRegistry()).find((session) => session.id === id);
  assert.equal(durable?.piSessionFile, "/tmp/hui-live.jsonl");

  const secondStarted: FakeSession[] = [];
  const options: StartOptions[] = [];
  const managerB = new LiveSessions(factory(secondStarted, options));
  assert.ok(durable);
  managerB.ensure(durable);
  await waitForBoot(managerB, id);

  assert.equal(secondStarted.length, 1);
  assert.equal(options[0]?.sessionFile, "/tmp/hui-live.jsonl");
  assert.deepEqual(managerB.transcript(id), [{ kind: "message", role: "user", text: "hello" }]);
});

test("unsupported tools fail closed", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure({ ...recordFor("bad-tool"), tool: "gemini", source: "hui" });
  await waitForStatus(manager, "bad-tool", "error");
  assert.equal(manager.status("bad-tool"), "error");
  assert.equal(started.length, 0);
});

test("a record naming a removed runtime fails closed instead of booting PI", async () => {
  const pi: FakeSession[] = [];
  const manager = new LiveSessions(factory(pi));
  manager.ensure({ ...recordFor("removed-tool"), tool: "claude" });
  await waitForStatus(manager, "removed-tool", "error");

  assert.equal(pi.length, 0, "a Claude Code record must not be resumed as PI");
  assert.equal(manager.status("removed-tool"), "error");
});

test("a record's model and thinking are handed to the runtime on boot", async () => {
  const started: FakeSession[] = [];
  const options: StartOptions[] = [];
  const manager = new LiveSessions(factory(started, options));
  manager.ensure({ ...recordFor("modelled"), model: "anthropic/sonnet", thinking: "high" });
  await waitForBoot(manager, "modelled");

  assert.equal(options[0]?.model, "anthropic/sonnet");
  assert.equal(options[0]?.thinking, "high");
});

test("switching model persists it and tells every open stream", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const seen: SessionStreamMessage[] = [];
  manager.ensure(recordFor("switch"));
  manager.subscribe("switch", (message) => seen.push(message));
  await waitForBoot(manager, "switch");

  const model = await manager.setModel("switch", "openai", "gpt");
  assert.equal(started[0]?.switched.at(-1), "openai/gpt");
  assert.equal(model?.id, "gpt");
  assert.deepEqual(
    seen.filter((message) => message.kind === "model").at(-1),
    { kind: "model", model: { provider: "openai", id: "gpt", name: "gpt" } },
  );

  // The choice has to survive a gateway restart, so it belongs in the record.
  const stored = (await readRegistry()).find((session) => session.id === "switch");
  assert.equal(stored?.model, "openai/gpt");
});

test("a thinking change rolls PI back when persistence fails", async () => {
  const runtime = new FakeSession();
  runtime.sessionFile = undefined;
  const manager = new LiveSessions({ id: "pi", start: async () => runtime }, async () => {
    throw new SessionRegistryError("registry write failed");
  });
  const seen: SessionStreamMessage[] = [];
  manager.ensure(recordFor("thinking-storage-failure"));
  manager.subscribe("thinking-storage-failure", (message) => seen.push(message));
  await waitForBoot(manager, "thinking-storage-failure");

  await assert.rejects(
    () => manager.setThinking("thinking-storage-failure", "high"),
    SessionRegistryError,
  );
  assert.equal(runtime.currentThinking(), "medium");
  assert.deepEqual(seen.filter((message) => message.kind === "thinking").at(-1), {
    kind: "thinking",
    level: "medium",
  });
});

test("a live model switch is not reported successful when persistence fails", async () => {
  // No session file means boot itself does not need the deliberately failing
  // registry writer; this isolates the persistence after PI changes model.
  const runtime = new FakeSession();
  runtime.sessionFile = undefined;
  const isolated = new LiveSessions({ id: "pi", start: async () => runtime }, async () => {
    throw new SessionRegistryError("registry write failed");
  });
  const seen: SessionStreamMessage[] = [];
  isolated.ensure(recordFor("switch-storage-failure-isolated"));
  isolated.subscribe("switch-storage-failure-isolated", (message) => seen.push(message));
  await waitForBoot(isolated, "switch-storage-failure-isolated");

  await assert.rejects(
    () => isolated.setModel("switch-storage-failure-isolated", "openai", "gpt"),
    SessionRegistryError,
  );
  assert.deepEqual(runtime.switched, ["openai/gpt", "anthropic/sonnet"]);
  assert.equal(runtime.currentModel()?.id, "sonnet", "PI was compensated back to the durable model");
  assert.deepEqual(seen.filter((message) => message.kind === "model").at(-1), {
    kind: "model",
    model: { provider: "anthropic", id: "sonnet", name: "sonnet" },
  });
  assert.equal(seen.some((message) => message.kind === "event" && message.event.type === "error"), false);
});

test("failed model compensation broadcasts the live model and an explicit error", async () => {
  let model: RuntimeModel = { provider: "anthropic", id: "sonnet", name: "Sonnet" };
  let switches = 0;
  const runtime: RuntimeSession = {
    sessionId: "pi-model-diverged",
    sessionFile: undefined,
    isStreaming: false,
    prompt: async () => {},
    subscribe: () => () => {},
    currentModel: () => model,
    async setModel(provider, id) {
      switches += 1;
      if (switches === 2) throw new Error("rollback refused");
      model = { provider, id, name: id };
    },
    transcript: () => [],
    dispose: () => {},
  };
  const manager = new LiveSessions({ id: "pi", start: async () => runtime }, async () => {
    throw new SessionRegistryError("registry write failed");
  });
  const seen: SessionStreamMessage[] = [];
  manager.ensure(recordFor("model-diverged"));
  manager.subscribe("model-diverged", (message) => seen.push(message));
  await waitForBoot(manager, "model-diverged");

  await assert.rejects(
    () => manager.setModel("model-diverged", "openai", "gpt"),
    /PI is using openai\/gpt/,
  );
  assert.deepEqual(seen.filter((message) => message.kind === "model").at(-1), {
    kind: "model",
    model: { provider: "openai", id: "gpt", name: "gpt" },
  });
  assert.match(
    seen
      .filter((message) => message.kind === "event" && message.event.type === "error")
      .map((message) => (message.kind === "event" && message.event.type === "error" ? message.event.message : ""))
      .at(-1) ?? "",
    /could not persist.*restore/i,
  );
});

test("a session with no runtime refuses model calls instead of pretending", async () => {
  // A runtime that never finishes booting keeps the session in `starting`, so
  // the refusal is deterministic rather than a race with the boot microtask.
  const stuck: AgentRuntime = { id: "pi", start: () => new Promise(() => {}) };
  const manager = new LiveSessions(stuck);
  manager.ensure(recordFor("booting-model"));
  await assert.rejects(() => manager.setModel("booting-model", "openai", "gpt"), SessionBusyError);
  await assert.rejects(() => manager.models("booting-model"), SessionBusyError);
  await assert.rejects(() => manager.abort("booting-model"), SessionBusyError);
});

test("abort stops the turn but keeps the session usable", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const aborted: string[] = [];
  manager.setAbortListener((id) => aborted.push(id));
  manager.ensure(recordFor("stop"));
  await waitForBoot(manager, "stop");

  await manager.prompt("stop", "long job");
  started[0]?.emit({ type: "turn_start" });
  assert.equal(manager.status("stop"), "running");

  await manager.abort("stop");
  assert.equal(started[0]?.aborts, 1);
  assert.deepEqual(aborted, ["stop"], "a stopped turn releases what it held, such as browser tabs");
  // The runtime is still there, so the next prompt does not have to reboot it.
  await manager.prompt("stop", "something else");
  assert.equal(started[0]?.prompts.at(-1), "something else");
  assert.equal(started.length, 1);
});

test("rewind refreshes the authoritative transcript and broadcasts a snapshot", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("rewind");
  const seen: SessionStreamMessage[] = [];
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  manager.subscribe(record.id, (message) => seen.push(message));

  await manager.rewind(record.id, "user-1", { excludeUserMessage: true });

  assert.deepEqual(started[0]?.rewoundTo, [{ target: "user-1", excludeUserMessage: true }]);
  assert.deepEqual(manager.transcript(record.id), [{ kind: "message", role: "user", text: 'rewound:"user-1"' }]);
  const snapshot = seen.findLast((message) => message.kind === "snapshot");
  assert.equal(snapshot?.kind, "snapshot");
  if (snapshot?.kind === "snapshot") assert.deepEqual(snapshot.snapshot.transcript, manager.transcript(record.id));
});

test("rewind aborts active work before changing the session tree", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("running-rewind");
  manager.ensure(record);
  await waitForBoot(manager, record.id);

  await manager.prompt(record.id, "long job");
  await manager.rewind(record.id, "user-1", { excludeUserMessage: true });

  assert.equal(started[0]?.aborts, 1);
  assert.deepEqual(started[0]?.rewoundTo, [{ target: "user-1", excludeUserMessage: true }]);
  assert.equal(manager.status(record.id), "idle");
});

test("rewind of a prompt shown without an entry id stops the run, then lets PI count from the end", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("running-tail-rewind");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  await manager.prompt(record.id, "long job");

  await manager.rewind(record.id, { userFromEnd: 0 }, { excludeUserMessage: true });

  assert.equal(started[0]?.aborts, 1);
  assert.deepEqual(started[0]?.rewoundTo, [{ target: { userFromEnd: 0 }, excludeUserMessage: true }]);
});

/** A Durable-like runtime that reports `resumed` to each new subscriber, as Durable does for a compaction it resumed
 * after a restart, and the status updates the session list received until it booted. */
async function bootWithCompaction(id: string, resumed: Extract<RuntimeEvent, { type: "compaction_start" }>) {
  const started: FakeSession[] = [];
  const manager = new LiveSessions({
    id: "durable",
    start: async () => {
      const session = new FakeSession();
      const subscribe = session.subscribe.bind(session);
      session.subscribe = (listener) => {
        const unsubscribe = subscribe(listener);
        listener(resumed);
        return unsubscribe;
      };
      started.push(session);
      return session;
    },
  });
  const updates: import("./live-sessions.ts").SessionStatusUpdate[] = [];
  manager.watchStatuses((update) => updates.push(update));
  const record = { ...recordFor(id), tool: "durable" };
  manager.ensure(record);
  await new Promise<void>((resolve) => {
    const booted = () => manager.runtimeTelemetry().get(record.id)?.bootDurationMs !== undefined;
    if (booted()) return resolve();
    const unsubscribe = manager.subscribe(record.id, () => { if (booted()) { unsubscribe(); resolve(); } });
  });
  return { manager, record, session: started[0]!, last: updates.filter((update) => update.id === record.id).at(-1)?.status };
}

test("a blocking compaction the runtime reports while subscribing keeps a booting session busy", async () => {
  const { manager, record, session, last } = await bootWithCompaction("resumed-compaction", { type: "compaction_start", reason: "manual" });
  assert.equal(manager.status(record.id), "running");
  assert.equal(last, "running", "the session list is told it is busy");
  assert.deepEqual(manager.snapshot(record.id).compaction, { status: "running", reason: "manual" });
  session.compactionEnded({ type: "compaction_end", reason: "manual", outcome: "done", willRetry: false });
  session.emit({ type: "settled" });
  await waitForStatus(manager, record.id, "idle");
  assert.equal(manager.snapshot(record.id).compaction, undefined);
});

test("a compaction the runtime resumed beside the conversation leaves a booting session idle", async () => {
  for (const resumed of [
    { type: "compaction_start", reason: "manual", blocking: false },
    { type: "compaction_start", reason: "threshold", blocking: false, background: true },
  ] as const) {
    const { manager, record, last } = await bootWithCompaction(`resumed-${resumed.reason}`, resumed);
    assert.equal(manager.status(record.id), "idle", resumed.reason);
    assert.equal(last, "idle");
    const { type: _type, ...shown } = resumed;
    assert.deepEqual(manager.snapshot(record.id).compaction, { status: "running", ...shown });
  }
});

test("a compaction the runtime runs beside the conversation never holds input", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("compacting-alongside");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  const session = started[0]!;

  // Durable's manual compaction runs beside the conversation, which stays idle and admits input.
  session.emit({ type: "compaction_start", reason: "manual", blocking: false });
  assert.equal(manager.status(record.id), "idle");
  assert.deepEqual(manager.snapshot(record.id).compaction, { status: "running", reason: "manual", blocking: false });
  // A steer with no run to steer starts one, through the prompt path.
  await manager.steer(record.id, "typed while compacting");
  assert.deepEqual(session.prompts, ["typed while compacting"]);
  assert.deepEqual(session.steered, []);
  assert.deepEqual(manager.snapshot(record.id).queue.items ?? [], [], "nothing waits in HUI's queue");
  assert(manager.snapshot(record.id).transcript.some((entry) => entry.kind === "message" && entry.role === "user" && entry.text === "typed while compacting"));
  // Inside that run a steer reaches the runtime as usual.
  await manager.steer(record.id, "steered in the run");
  assert.deepEqual(session.steered, ["steered in the run"]);
});

test("a background compaction leaves the session idle, takes prompts and lets a released session close", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("compacting-background");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  const session = started[0]!;

  session.emit({ type: "compaction_start", reason: "threshold", blocking: false, background: true });
  assert.equal(manager.status(record.id), "idle");
  assert.deepEqual(manager.snapshot(record.id).compaction, { status: "running", reason: "threshold", blocking: false, background: true });
  await manager.prompt(record.id, "sent meanwhile");
  assert.deepEqual(session.prompts, ["sent meanwhile"]);
  session.emit({ type: "settled" });
  await waitForStatus(manager, record.id, "idle");
  // The runtime keeps compacting on its own; this view need not stay open for it.
  manager.release(record.id);
  assert.equal(session.disposed, true);
});

test("only a manual compaction beside the conversation can be cancelled on its own, and only one compacts at a time", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("cancel-compaction");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  const session = started[0]!;

  await assert.rejects(() => manager.cancelCompaction(record.id), SessionBusyError, "nothing is compacting");
  session.emit({ type: "compaction_start", reason: "threshold", blocking: false, background: true });
  await assert.rejects(() => manager.cancelCompaction(record.id), SessionBusyError, "background work is the runtime's own");
  await assert.rejects(() => manager.compact(record.id), /already running/u);
  session.emit({ type: "compaction_start", reason: "manual", blocking: false });
  await manager.cancelCompaction(record.id);
  assert.equal(session.compactionCancels, 1);
  session.emit({ type: "compaction_start", reason: "threshold" });
  await assert.rejects(() => manager.cancelCompaction(record.id), SessionBusyError, "Stop cancels a blocking one");
  assert.equal(session.compactionCancels, 1);
});

test("a runtime that reports its compaction while it starts never shows the session busy", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("compact-alongside-start");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  const session = started[0]!;
  // As Durable's compact() does, before its first await.
  session.compact = async (instructions) => {
    session.emit({ type: "compaction_start", reason: "manual", blocking: false });
    session.compactions.push(instructions);
  };
  const statuses: string[] = [];
  manager.watchStatuses((update) => { if (update.id === record.id) statuses.push(update.status); });
  await manager.compact(record.id, "keep the API decisions");
  assert.deepEqual(session.compactions, ["keep the API decisions"]);
  assert.deepEqual(statuses.filter((status) => status !== "idle"), [], "no running flash for the gateway's claim");
  assert.deepEqual(manager.snapshot(record.id).compaction, { status: "running", reason: "manual", blocking: false });
});

test("a compaction that ran beside the conversation shows its summary when it ends, without a settle", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("compacted-alongside");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  const session = started[0]!;
  const snapshots: SessionSnapshot[] = [];
  manager.subscribe(record.id, (message) => { if (message.kind === "snapshot") snapshots.push(message.snapshot); });

  session.emit({ type: "compaction_start", reason: "manual", blocking: false });
  session.history = [...session.history, { kind: "compaction", summary: "Summary", tokensBefore: 1200 }];
  session.emit({ type: "compaction_end", reason: "manual", outcome: "done", willRetry: false });
  assert.equal(manager.status(record.id), "idle");
  assert.equal(manager.snapshot(record.id).compaction, undefined);
  assert.equal(manager.snapshot(record.id).transcript.at(-1)?.kind, "compaction");
  assert.equal(snapshots.at(-1)?.transcript.at(-1)?.kind, "compaction", "browsers get the refreshed history");
});

test("a compaction keeps the session busy, holds what the user sends and delivers it afterwards", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("compacting");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  const session = started[0]!;

  // PI compacts after its agent_end, when the run has already settled.
  session.emit({ type: "compaction_start", reason: "threshold" });
  assert.equal(manager.status(record.id), "running");
  assert.deepEqual(manager.snapshot(record.id).compaction, { status: "running", reason: "threshold" });
  await manager.steer(record.id, "typed while compacting");
  await manager.prompt(record.id, "sent by an automation");
  assert.deepEqual(session.steered, []);
  assert.deepEqual(session.prompts, []);
  assert.deepEqual(manager.snapshot(record.id).queue.items?.map((item) => item.text), ["typed while compacting", "sent by an automation"]);
  await assert.rejects(() => manager.compact(record.id), SessionBusyError);

  const delivered = new Promise<string>((resolve) => {
    const prompt = session.prompt.bind(session);
    session.prompt = async (text, attachments) => { await prompt(text, attachments); resolve(text); };
  });
  session.compactionEnded({ type: "compaction_end", reason: "threshold", outcome: "done", willRetry: false });
  assert.deepEqual(session.prompts, [], "nothing is sent before the refreshed history settles");
  session.emit({ type: "settled" });
  assert.equal(await delivered, "typed while compacting");
  assert.equal(manager.snapshot(record.id).compaction, undefined);
  assert.deepEqual(manager.snapshot(record.id).queue.items?.map((item) => item.text), ["sent by an automation"]);
});

test("a failed compaction stays visible until the next turn and never triggers a model fallback", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("compaction-failed");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  const session = started[0]!;

  await manager.compact(record.id, "keep the API decisions");
  assert.deepEqual(session.compactions, ["keep the API decisions"]);
  session.emit({ type: "compaction_start", reason: "manual" });
  session.compactionEnded({ type: "compaction_end", reason: "manual", outcome: "failed", willRetry: false, message: "Nothing to compact (session too small)" });
  session.emit({ type: "settled" });
  assert.equal(manager.status(record.id), "idle");
  assert.deepEqual(manager.snapshot(record.id).compaction, { status: "failed", reason: "manual", message: "Nothing to compact (session too small)" });

  session.emit({ type: "turn_start" });
  assert.equal(manager.snapshot(record.id).compaction, undefined);
});

test("a /compact PI refuses before starting releases the session and sends what was held", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("compaction-refused");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  const session = started[0]!;

  await manager.compact(record.id);
  assert.equal(manager.status(record.id), "running");
  await manager.steer(record.id, "held behind the compaction");
  const delivered = new Promise<string>((resolve) => {
    const prompt = session.prompt.bind(session);
    session.prompt = async (text, attachments) => { await prompt(text, attachments); resolve(text); };
  });
  // No compaction_start and no settle: PI answered the RPC with an error.
  session.emit({ type: "compaction_end", reason: "manual", outcome: "failed", willRetry: false, message: "pi is not running" });
  assert.equal(await delivered, "held behind the compaction");
  assert.deepEqual(manager.snapshot(record.id).compaction, { status: "failed", reason: "manual", message: "pi is not running" });
});

test("a session released while compacting closes once the compaction ends, even one PI refused", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("released-compaction");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  await manager.compact(record.id);
  manager.release(record.id);
  assert.equal(started[0]?.disposed, false, "the compaction keeps it open");
  const session = started[0]!;
  const disposed = new Promise<void>((resolve) => { session.dispose = () => { session.disposed = true; resolve(); }; });
  session.emit({ type: "compaction_end", reason: "manual", outcome: "failed", willRetry: false, message: "pi is not running" });
  await disposed;
  assert.equal(manager.isLive(record.id), false);
});

test("prompt-free continuation enters running state and rewind stops it", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const record = recordFor("continue");
  manager.ensure(record);
  await waitForBoot(manager, record.id);

  await manager.continueRun(record.id);
  assert.equal(started[0]?.continuations, 1);
  assert.equal(manager.status(record.id), "running");
  await assert.rejects(() => manager.continueRun(record.id), SessionBusyError);
  await manager.rewind(record.id, "user-1");
  assert.equal(started[0]?.aborts, 1);
  assert.deepEqual(started[0]?.rewoundTo, [{ target: "user-1", excludeUserMessage: undefined }]);
});

test("attachments reach the runtime alongside the prompt", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure(recordFor("attach"));
  await waitForBoot(manager, "attach");

  await manager.prompt("attach", "look at this", [
    { kind: "image", mimeType: "image/png", dataBase64: "AAAA", name: "shot.png" },
    { kind: "file", path: "/tmp/report.pdf", name: "report.pdf" },
  ]);

  assert.deepEqual(started[0]?.attachments.at(-1), [
    { kind: "image", mimeType: "image/png", dataBase64: "AAAA", name: "shot.png" },
    { kind: "file", path: "/tmp/report.pdf", name: "report.pdf" },
  ]);
});

test("models are listed from the runtime that owns the session", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure(recordFor("list"));
  await waitForBoot(manager, "list");

  assert.deepEqual(
    (await manager.models("list")).map((model) => model.id),
    ["sonnet", "gpt"],
  );
});

test("command catalogs come from the owning runtime and wait for boot", async () => {
  const commands: RuntimeCommand[] = [{ name: "skill:testing", description: "Test changes", source: "skill" }];
  class CommandSession extends FakeSession {
    async listCommands() { return commands; }
  }
  const manager = new LiveSessions({ id: "pi", start: async () => new CommandSession() });
  manager.ensure(recordFor("command-list"));
  await assert.rejects(() => manager.commands("command-list"), SessionBusyError);
  await waitForBoot(manager, "command-list");
  assert.deepEqual(await manager.commands("command-list"), commands);
  manager.disposeAll();
  const unsupported = new LiveSessions(factory([]));
  unsupported.ensure(recordFor("no-commands"));
  await waitForBoot(unsupported, "no-commands");
  assert.deepEqual(await unsupported.commands("no-commands"), []);
  unsupported.disposeAll();
});

test("a command settled before acknowledgement does not reappear as an invented transcript turn", async () => {
  class ImmediateCommand extends FakeSession {
    override async prompt() { this.emit({ type: "settled" }); }
  }
  const session = new ImmediateCommand();
  const manager = new LiveSessions({ id: "pi", start: async () => session });
  manager.ensure(recordFor("immediate-command"));
  await waitForBoot(manager, "immediate-command");
  await manager.prompt("immediate-command", "/check");
  assert.equal(manager.status("immediate-command"), "idle");
  assert.deepEqual(manager.transcript("immediate-command"), session.history);
  await manager.prompt("immediate-command", "/check again");
  assert.deepEqual(manager.transcript("immediate-command"), session.history);
  manager.disposeAll();
});

test("the status never claims idle while a prompt would still be refused", async () => {
  // Models pi's real sequence: `turn_end` arrives while the agent is still
  // streaming, and only the settle ends it. Reporting idle at `turn_end` made
  // the UI offer a prompt the server answered with 409.
  class HalfDone implements RuntimeSession {
    sessionId = "pi-2";
    sessionFile: string | undefined = undefined;
    streaming = false;
    #listeners = new Set<(event: RuntimeEvent) => void>();
    get isStreaming(): boolean {
      return this.streaming;
    }
    async prompt(): Promise<void> {
      this.streaming = true;
    }
    subscribe(listener: (event: RuntimeEvent) => void): () => void {
      this.#listeners.add(listener);
      return () => this.#listeners.delete(listener);
    }
    transcript(): TranscriptEntry[] {
      return [];
    }
    dispose(): void {}
    emit(event: RuntimeEvent): void {
      for (const listener of this.#listeners) {
        listener(event);
      }
    }
  }

  const session = new HalfDone();
  const manager = new LiveSessions({ id: "pi", start: async () => session });
  manager.ensure(recordFor("half"));
  await waitForBoot(manager, "half");

  await manager.prompt("half", "go");
  session.emit({ type: "turn_start" });
  session.emit({ type: "turn_end" });

  assert.equal(manager.status("half"), "running", "still streaming, so still running");
  await assert.rejects(() => manager.prompt("half", "again"), SessionBusyError);

  session.streaming = false;
  session.emit({ type: "settled" });
  assert.equal(manager.status("half"), "idle");
  await manager.prompt("half", "now it works");
});

test("a reconnect snapshot replays the projected in-flight turn and settle replaces it with PI history", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure(recordFor("replay"));
  await waitForBoot(manager, "replay");

  await manager.prompt("replay", "stream this");
  started[0]?.emit({ type: "thinking", delta: "checking" });
  started[0]?.emit({ type: "tool_start", id: "call-1", name: "read", args: { path: "a.txt" } });
  started[0]?.emit({ type: "tool_update", id: "call-1", name: "read", output: "par" });
  started[0]?.emit({ type: "tool_end", id: "call-1", name: "read", output: "partial", failed: false });
  started[0]?.emit({ type: "text", delta: "Hello " });

  const watched = manager.watch("replay", () => {});
  assert.deepEqual(watched.snapshot.transcript.slice(-4), [
    { kind: "message", role: "user", text: "stream this" },
    { kind: "thinking", text: "checking" },
    { kind: "tool", id: "call-1", name: "read", args: { path: "a.txt" }, output: "partial", failed: false },
    { kind: "message", role: "assistant", text: "Hello " },
  ]);
  assert.equal(watched.snapshot.status, "running");
  watched.unsubscribe();

  started[0]!.history = [
    { kind: "message", role: "user", text: "stream this" },
    { kind: "message", role: "assistant", text: "Hello complete" },
  ];
  started[0]?.emit({ type: "settled" });
  assert.deepEqual(manager.snapshot("replay").transcript, started[0]!.history);
  assert.equal(manager.snapshot("replay").status, "idle");
});

test("a failed history refresh settles idle without replacing the streamed projection", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure(recordFor("stale-history"));
  await waitForBoot(manager, "stale-history");

  await manager.prompt("stale-history", "new question");
  started[0]?.emit({ type: "text", delta: "fresh streamed answer" });
  const projected = manager.snapshot("stale-history").transcript;
  assert.notDeepEqual(projected, started[0]!.history);

  started[0]?.emit({ type: "settled", historyRefreshed: false });

  assert.deepEqual(manager.snapshot("stale-history").transcript, projected);
  assert.equal(manager.snapshot("stale-history").status, "idle");
});

test("queue, thinking and questions share the reconnect snapshot and delegate commands", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure(recordFor("controls"));
  await waitForBoot(manager, "controls");

  await manager.steer("controls", "change direction");
  await manager.followUp("controls", "then summarize");
  await manager.setThinking("controls", "high");
  assert.deepEqual(started[0]?.steered, ["change direction"]);
  assert.deepEqual(started[0]?.followedUp, []);
  assert.deepEqual(started[0]?.prompts, ["then summarize"]);

  const question: RuntimeQuestion = { id: "q-1", method: "input", title: "Name", placeholder: "value" };
  started[0]?.emit({
    type: "queue_update",
    queue: { steering: ["change direction"], followUp: ["then summarize"] },
  });
  started[0]?.emit({ type: "question", question });
  assert.equal(manager.status("controls"), "waiting");
  assert.deepEqual(manager.snapshot("controls"), {
    transcript: [
      { kind: "message", role: "user", text: "hello" },
      { kind: "message", role: "user", text: "then summarize" },
    ],
    status: "waiting",
    model: { provider: "anthropic", id: "sonnet", name: "Sonnet" },
    thinking: "high",
    queue: { steering: ["change direction"], followUp: ["then summarize"] },
    questions: [question],
    subagents: [],
  });

  await manager.respondQuestion("controls", "q-1", { value: "Ada" });
  assert.deepEqual(started[0]?.questionResponses, [{ id: "q-1", response: { value: "Ada" } }]);
  assert.deepEqual(manager.snapshot("controls").questions, []);
  assert.equal(manager.status("controls"), "running");

  const confirm: RuntimeQuestion = { id: "q-2", method: "confirm", title: "Continue?", message: "Proceed" };
  started[0]?.emit({ type: "question", question: confirm });
  await manager.cancelQuestion("controls", "q-2");
  assert.deepEqual(started[0]?.questionResponses.at(-1), { id: "q-2", cancelled: true });
});

test("Stop on a waiting question leaves an idle session, not a stale question", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure(recordFor("stopped-card"));
  await waitForBoot(manager, "stopped-card");
  await manager.prompt("stopped-card", "ship it when done");
  const decision: RuntimeQuestion = { id: "d-1", method: "input", title: "Ship it?" };
  started[0]!.questions = [decision];
  started[0]!.emit({ type: "question", question: decision });
  assert.equal(manager.status("stopped-card"), "waiting");

  // Stop aborts the run; PI ends the turn and drops its UI request.
  await manager.abort("stopped-card");
  started[0]!.questions = [];
  started[0]!.emit({ type: "settled" });

  assert.equal(manager.status("stopped-card"), "idle");
  assert.deepEqual(manager.snapshot("stopped-card").questions, []);
  await manager.rewind("stopped-card", "user-1");
  assert.equal(started[0]!.rewoundTo.at(-1)?.target, "user-1");
});

test("HUI-owned follow-ups can be edited, reordered, removed and steered before delivery", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure(recordFor("editable-queue"));
  await waitForBoot(manager, "editable-queue");

  await manager.prompt("editable-queue", "active turn");
  await manager.followUp("editable-queue", "first");
  await manager.followUp("editable-queue", "second");
  await manager.followUp("editable-queue", "third");

  const [first, second, third] = manager.snapshot("editable-queue").queue.items ?? [];
  assert.ok(first && second && third);
  manager.editFollowUp("editable-queue", second.id, "second edited");
  manager.moveFollowUp("editable-queue", second.id, 0);
  manager.removeFollowUp("editable-queue", first.id);
  await manager.steerFollowUp("editable-queue", third.id);

  assert.deepEqual(started[0]?.steered, ["third"]);
  assert.deepEqual(manager.snapshot("editable-queue").queue.items, [
    { id: second.id, text: "second edited", mode: "followUp" },
  ]);

  started[0]?.emit({ type: "settled" });
  await new Promise<void>((resolve) => {
    const inspect = () => {
      if ((started[0]?.prompts.length ?? 0) >= 2) resolve();
      else setImmediate(inspect);
    };
    inspect();
  });
  assert.deepEqual(started[0]?.prompts, ["active turn", "second edited"]);
  assert.equal(manager.snapshot("editable-queue").queue.items, undefined);
});

/** A worker connection scripted in memory: a prompt streams on the worker
 * until `settle`, and `hold` keeps the next prompt on its way there. A start
 * fails with `unreachable` while it is set, as a worker HUI cannot reach. */
function scriptedWorker(t: TestContext) {
  const calls: string[] = [];
  let streaming = false;
  let seq = 1;
  let sink!: Parameters<typeof workers.startSession>[4];
  let held: Promise<void> | undefined;
  const state = () => ({ sessionId: "remote", isStreaming: streaming, resumesInterruptedRuns: true });
  const control = {
    starts: 0,
    /** The conversation as the worker holds it. */
    history: [] as TranscriptEntry[],
    unreachable: undefined as RuntimeUnreachableError | undefined,
  };
  t.mock.method(workers, "startSession", async (...args: Parameters<typeof workers.startSession>) => {
    control.starts += 1;
    if (control.unreachable) throw control.unreachable;
    sink = args[4];
    return {
      started: { state: state(), seq: ++seq, transcript: [...control.history], methods: ["followUp"] },
      call: async (method: string, callArgs: unknown[]) => {
        calls.push(`${method}:${String(callArgs[0])}`);
        if (method === "prompt") {
          await held;
          streaming = true;
        }
        return { state: state(), seq: ++seq };
      },
      transcript: async () => [],
      dispose: () => undefined,
    };
  });
  return Object.assign(control, {
    calls,
    /** The worker goes on with a run of its own. */
    stream(): void {
      streaming = true;
    },
    hold(): () => void {
      let release!: () => void;
      held = new Promise((resolve) => { release = resolve; });
      return () => { held = undefined; release(); };
    },
    settle(): void {
      streaming = false;
      sink.receive({ event: { type: "settled" }, state: state(), seq: ++seq });
    },
    /** The gateway loses the worker, where the run settles meanwhile. */
    lose(unreachable?: RuntimeUnreachable): void {
      streaming = false;
      sink.lost(unreachable);
    },
    /** Only the connection drops; the run goes on there. */
    drop(unreachable: RuntimeUnreachable): void {
      sink.lost(unreachable);
    },
  });
}

async function until(done: () => boolean, label: string): Promise<void> {
  for (const deadline = Date.now() + 5_000; !done();) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("a worker session hands a follow-up to its runtime only while a run streams there and none waits in HUI's queue", async (t) => {
  const worker = scriptedWorker(t);
  const id = "remote-follow-up";
  const manager = new LiveSessions(factory([]));
  manager.ensure({ ...recordFor(id), worker: "w" });
  await waitForBoot(manager, id);
  // Running on the worker, it queues there and runs even if the gateway leaves.
  await manager.prompt(id, "first turn");
  await manager.followUp(id, "while running");
  assert.deepEqual(worker.calls, ["prompt:first turn", "followUp:while running"]);
  worker.settle();
  await waitForStatus(manager, id, "idle");

  const release = worker.hold();
  const prompted = manager.prompt(id, "second turn");
  // The prompt is still on its way: HUI keeps the follow-up, editable, behind it,
  await manager.followUp(id, "A");
  release();
  await prompted;
  // and keeps one sent once the run streams behind that one.
  await manager.followUp(id, "B");
  assert.deepEqual(manager.snapshot(id).queue.items?.map((item) => item.text), ["A", "B"]);
  worker.settle();
  await until(() => worker.calls.length === 4, "the first held follow-up");
  worker.settle();
  await until(() => worker.calls.length === 5, "the second held follow-up");
  assert.deepEqual(worker.calls.slice(2), ["prompt:second turn", "prompt:A", "prompt:B"]);
  manager.disposeAll();
});

test("follow-ups HUI holds for a worker session run once it reattaches to a run that settled meanwhile", async (t) => {
  const worker = scriptedWorker(t);
  const id = "remote-reattach-follow-up";
  const record = { ...recordFor(id), worker: "w" };
  const manager = new LiveSessions(factory([]));
  manager.ensure(record);
  await waitForBoot(manager, id);
  const release = worker.hold();
  const prompted = manager.prompt(id, "turn");
  await manager.followUp(id, "held here");
  release();
  await prompted;
  worker.lose({ reconnecting: true });
  await waitForStatus(manager, id, "reconnecting");
  assert.equal(manager.blockingWorkCount, 0, "a session whose worker is away never blocks a gateway restart");
  manager.ensure(record, true);
  await until(() => worker.calls.length === 2, "the held follow-up");
  assert.deepEqual(worker.calls, ["prompt:turn", "prompt:held here"]);
  manager.disposeAll();
});

/** Every message a session's streams receive. */
function messagesOf(manager: InstanceType<typeof LiveSessions>, id: string): SessionStreamMessage[] {
  const seen: SessionStreamMessage[] = [];
  manager.subscribe(id, (message) => seen.push(message));
  return seen;
}

const failures = (seen: readonly SessionStreamMessage[]) =>
  seen.filter((message) => message.kind === "closed" || (message.kind === "event" && message.event.type === "error")
    || (message.kind === "status" && message.status === "error"));

test("a worker session whose connection drops is reconnecting, not failed, and comes back caught up", async (t) => {
  const worker = scriptedWorker(t);
  const id = "remote-drop";
  const record = { ...recordFor(id), worker: "w" };
  const manager = new LiveSessions(factory([]));
  manager.ensure(record);
  await waitForBoot(manager, id);
  await manager.prompt(id, "long task");
  const seen = messagesOf(manager, id);
  worker.drop({ reconnecting: true });
  await waitForStatus(manager, id, "reconnecting");
  assert.deepEqual(failures(seen), [], "a dropped connection is neither an error nor a dead stream");
  assert.deepEqual(manager.transcript(id).map((entry) => entry.kind === "message" ? entry.text : entry.kind), ["long task"]);
  assert.equal(manager.blockingWorkCount, 0, "the run goes on there, so a gateway restart loses nothing");
  // Opening it again waits for HUI's own reconnect rather than starting one.
  manager.ensure(record);
  assert.equal(worker.starts, 1);
  await assert.rejects(manager.prompt(id, "more"), (error: unknown) =>
    error instanceof SessionBusyError && /reconnecting/u.test(error.message));
  await assert.rejects(manager.followUp(id, "more"), SessionBusyError);

  worker.history = [{ kind: "message", role: "user", text: "long task" }, { kind: "message", role: "assistant", text: "done there" }];
  worker.stream();
  manager.ensure(record, true);
  assert.equal(manager.status(id), "reconnecting", "reattaching is still reconnecting, not a fresh start");
  await waitForStatus(manager, id, "running");
  assert.equal(worker.starts, 2);
  assert.deepEqual(manager.transcript(id).map((entry) => entry.kind === "message" ? entry.text : entry.kind), ["long task", "done there"]);
  assert.deepEqual(failures(seen), []);
  manager.disposeAll();
});

test("a worker session HUI stopped reconnecting is disconnected until it is reattached explicitly", async (t) => {
  const worker = scriptedWorker(t);
  const id = "remote-disconnected";
  const record = { ...recordFor(id), worker: "w" };
  const manager = new LiveSessions(factory([]));
  manager.ensure(record);
  await waitForBoot(manager, id);
  const seen = messagesOf(manager, id);
  worker.drop({ reconnecting: true });
  await waitForStatus(manager, id, "reconnecting");
  manager.stopReconnecting(id);
  assert.equal(manager.status(id), "disconnected");
  // Opening it must not reconnect a worker the user disconnected.
  manager.ensure(record);
  assert.equal(worker.starts, 1);
  await assert.rejects(manager.prompt(id, "hello"), (error: unknown) =>
    error instanceof SessionBusyError && /Reconnect/u.test(error.message));
  assert.equal(manager.blockingWorkCount, 0);
  manager.ensure(record, true);
  await waitForBoot(manager, id);
  assert.equal(worker.starts, 2);
  assert.deepEqual(failures(seen), []);

  // A user disconnect (or removal) reports it directly.
  worker.drop({ reconnecting: false });
  await waitForStatus(manager, id, "disconnected");
  assert.deepEqual(failures(seen), []);
  manager.disposeAll();
});

test("a run that finished on the worker while HUI was away settles for what waits on it when HUI reattaches", async (t) => {
  const worker = scriptedWorker(t);
  const id = "remote-settled-away";
  let records: SessionRecord[] = [{ ...recordFor(id), worker: "w" }];
  // As the gateway reattaches: with the record the registry holds.
  const reattach = () => manager.ensure(records[0]!, true);
  const manager = new LiveSessions(factory([]), async (mutate) => (records = [...mutate(records)]));
  manager.ensure(records[0]!);
  await waitForBoot(manager, id);
  await manager.prompt(id, "long task");
  const seen = messagesOf(manager, id);
  worker.lose({ reconnecting: true });
  await waitForStatus(manager, id, "reconnecting");
  worker.history = [{ kind: "message", role: "user", text: "long task" }, { kind: "message", role: "assistant", text: "done there" }];
  reattach();
  await waitForBoot(manager, id);
  const settled = () => seen.filter((message) => message.kind === "event" && message.event.type === "settled").length;
  await until(() => settled() === 1, "the settled event");
  assert.equal(records[0]!.runStartedAt, undefined, "the run is no longer unfinished work");
  // Reattaching to a session with no run in flight settles nothing.
  worker.lose({ reconnecting: true });
  await waitForStatus(manager, id, "reconnecting");
  reattach();
  await waitForBoot(manager, id);
  assert.equal(settled(), 1);
  manager.disposeAll();
});

test("a worker HUI cannot reach leaves a session reconnecting while HUI retries, else disconnected", async (t) => {
  const worker = scriptedWorker(t);
  const manager = new LiveSessions(factory([]));
  worker.unreachable = new RuntimeUnreachableError("Connection refused", true);
  const record = { ...recordFor("remote-unreachable"), worker: "w" };
  const seen = messagesOf(manager, record.id);
  manager.ensure(record);
  await waitForStatus(manager, record.id, "reconnecting");

  worker.unreachable = new RuntimeUnreachableError("ssh: connect to host devbox: Connection refused", false);
  manager.ensure(record, true);
  await waitForStatus(manager, record.id, "disconnected");
  assert.deepEqual(failures(seen), [], "no failure banner: the session may well be running there");
  manager.ensure(record);
  assert.equal(worker.starts, 2, "an open does not retry a disconnected worker");

  worker.unreachable = undefined;
  manager.ensure(record, true);
  await waitForBoot(manager, record.id);
  assert.deepEqual(failures(seen), []);
  manager.disposeAll();
});

test("a consumed queued instruction becomes a visible user turn before settlement", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const seen: SessionStreamMessage[] = [];
  manager.ensure(recordFor("queue-delivery"));
  manager.subscribe("queue-delivery", (message) => seen.push(message));
  await waitForBoot(manager, "queue-delivery");

  started[0]?.emit({
    type: "queue_update",
    queue: { steering: ["redirect", "redirect"], followUp: ["then summarize"] },
  });
  started[0]?.emit({
    type: "queue_update",
    queue: { steering: ["redirect"], followUp: ["then summarize"] },
  });

  assert.deepEqual(manager.snapshot("queue-delivery").transcript.at(-1), {
    kind: "message",
    role: "user",
    text: "redirect",
  });
  assert.equal(
    seen.some(
      (message) => {
        if (message.kind !== "snapshot") return false;
        const last = message.snapshot.transcript.at(-1);
        return last?.kind === "message" && last.text === "redirect";
      },
    ),
    true,
    "open browsers receive the promoted user turn without waiting for settled",
  );
});

test("a pending question is claimed before awaiting PI so double-submit cannot answer twice", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  manager.ensure(recordFor("question-race"));
  await waitForBoot(manager, "question-race");
  started[0]?.emit({
    type: "question",
    question: { id: "q-race", method: "confirm", title: "Continue?", message: "Only once" },
  });

  const first = manager.respondQuestion("question-race", "q-race", { confirmed: true });
  await assert.rejects(
    () => manager.respondQuestion("question-race", "q-race", { confirmed: false }),
    /Unknown question/,
  );
  await first;
  assert.equal(started[0]?.questionResponses.length, 1);
});

test("continue after a normally completed turn sends a continuation prompt", async () => {
  class Done extends FakeSession {
    override async continueRun(): Promise<void> { throw new Error("The active branch already ends with a completed assistant response."); }
  }
  const started: FakeSession[] = [];
  const manager = new LiveSessions({ id: "pi", start: async () => { const s = new Done(); started.push(s); return s; } } as never);
  const record = recordFor("continue-done");
  manager.ensure(record);
  await waitForBoot(manager, record.id);
  await manager.continueRun(record.id);
  assert.match(started[0]!.prompts.at(-1) ?? "", /^Continue from where you left off/);
});

test("deleting a parent closes descendant runtimes and blocks stale child opens", async () => {
  const started: FakeSession[] = [];
  const manager = new LiveSessions(factory(started));
  const parent = recordFor("tree-parent");
  const child = { ...recordFor("tree-child"), parentId: parent.id };
  const grandchild = { ...recordFor("tree-grandchild"), parentId: child.id };
  const outside = recordFor("tree-outside");
  const records = [parent, child, grandchild, outside];
  for (const row of records) { manager.ensure(row); await waitForBoot(manager, row.id); }
  let stored = records;
  await deleteSession(parent.id, manager, async (mutate) => { stored = [...mutate(stored)]; return stored; });
  assert.deepEqual(stored.map((r) => r.id), [outside.id]);
  assert.deepEqual(started.map((runtime) => runtime.disposed), [true, true, true, false]);
  for (const row of [parent, child, grandchild]) assert.equal(manager.ensure(row), false);
  manager.disposeAll();
});
