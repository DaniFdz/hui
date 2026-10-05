import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { LiveSessions, type SessionStreamMessage } from "./live-sessions.ts";
import type { SessionRecord } from "./sessions.ts";
import { SubagentService } from "./subagents.ts";
import { workers, type RemoteSessionSink } from "./workers.ts";
import type {
  AgentRuntime,
  RuntimeUnreachable,
  RuntimeEvent,
  RuntimeModel,
  RuntimeSession,
  StartOptions,
  TranscriptEntry,
} from "./runtimes/types.ts";

const timestamp = "2026-09-24T10:00:00.000Z";

function record(id: string, patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    title: id,
    group: "Work",
    cwd: "/tmp",
    tool: "pi",
    createdAt: timestamp,
    updatedAt: timestamp,
    source: "hui",
    ...patch,
  };
}

class CoordinatedSession implements RuntimeSession {
  readonly sessionId: string;
  readonly sessionFile = undefined;
  readonly prompts: string[] = [];
  readonly followedUp: string[] = [];
  readonly steered: string[] = [];
  readonly history: TranscriptEntry[];
  aborts = 0;
  disposed = false;
  models: RuntimeModel[] = [];
  readonly disposedPromise: Promise<void>;
  #resolveDisposed!: () => void;
  #streaming = false;
  #listeners = new Set<(event: RuntimeEvent) => void>();
  #promptListeners = new Set<(prompt: string) => void>();
  readonly huiId: string;
  private readonly autoSettle: boolean;

  constructor(
    huiId: string,
    autoSettle: boolean,
    history: TranscriptEntry[],
  ) {
    this.huiId = huiId;
    this.autoSettle = autoSettle;
    this.history = history;
    this.sessionId = `pi-${huiId}`;
    this.disposedPromise = new Promise((resolve) => {
      this.#resolveDisposed = resolve;
    });
  }

  get isStreaming(): boolean {
    return this.#streaming;
  }

  async prompt(value: string): Promise<void> {
    this.prompts.push(value);
    this.history.push({ kind: "message", role: "user", text: value });
    this.#streaming = true;
    for (const listener of this.#promptListeners) listener(value);
    if (this.autoSettle) queueMicrotask(() => this.finish(`Reply from ${this.huiId}`));
  }

  async followUp(value: string): Promise<void> {
    this.followedUp.push(value);
    await this.prompt(value);
  }

  async steer(value: string): Promise<void> {
    this.steered.push(value);
  }

  async abort(): Promise<void> {
    this.aborts += 1;
    this.#streaming = false;
    this.emit({ type: "settled" });
  }

  async listModels(): Promise<readonly RuntimeModel[]> {
    return this.models;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  transcript(): TranscriptEntry[] {
    return this.history.map((entry) => ({ ...entry }));
  }

  dispose(): void {
    this.#streaming = false;
    this.disposed = true;
    this.#resolveDisposed();
  }

  finish(reply: string): void {
    this.history.push({ kind: "message", role: "assistant", text: reply });
    this.emit({ type: "text", delta: reply });
    this.#streaming = false;
    this.emit({ type: "settled" });
  }

  waitForPrompt(predicate: (prompt: string) => boolean): Promise<string> {
    const existing = this.prompts.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const listener = (prompt: string) => {
        if (!predicate(prompt)) return;
        this.#promptListeners.delete(listener);
        resolve(prompt);
      };
      this.#promptListeners.add(listener);
    });
  }

  emit(event: RuntimeEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

function harness(
  initial: SessionRecord[],
  options: { manualSessionId?: string; ids?: string[] } = {},
) {
  let records = [...initial];
  const sessions = new Map<string, CoordinatedSession>();
  const histories = new Map<string, TranscriptEntry[]>();
  const starts: StartOptions[] = [];
  const runtime: AgentRuntime = {
    id: "pi",
    start: async (startOptions) => {
      starts.push(startOptions);
      const id = startOptions.huiSessionId ?? `unknown-${starts.length}`;
      const history = histories.get(id) ?? [];
      histories.set(id, history);
      const session = new CoordinatedSession(id, id !== options.manualSessionId, history);
      sessions.set(id, session);
      return session;
    },
  };
  const update = async (
    mutate: (current: readonly SessionRecord[]) => readonly SessionRecord[],
  ) => {
    records = [...mutate(records)];
    return records;
  };
  const manager = new LiveSessions(runtime, update);
  const ids = [...(options.ids ?? ["task-1", "child-1"])];
  const service = new SubagentService(
    manager,
    async () => records,
    update,
    () => new Date(timestamp),
    () => ids.shift() ?? `generated-${ids.length}`,
  );
  return { manager, service, sessions, starts, update, records: () => records };
}

function waitForStatus(manager: LiveSessions, id: string, expected: string): Promise<void> {
  if (manager.status(id) === expected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const watched = manager.watch(id, (message) => {
      if (message.kind === "status" && message.status === expected) finish();
      if (message.kind === "snapshot" && message.snapshot.status === expected) finish();
      if (message.kind === "status" && message.status === "error") {
        finish(new Error(`${id} entered error state.`));
      }
    });
    const finish = (error?: Error) => {
      watched.unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    if (watched.snapshot.status === expected) finish();
  });
}

function waitForTask(
  manager: LiveSessions,
  parentId: string,
  status: string,
): Promise<void> {
  if (manager.snapshot(parentId).subagents.some((task) => task.status === status)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const watched = manager.watch(parentId, (message: SessionStreamMessage) => {
      if (
        message.kind === "snapshot" &&
        message.snapshot.subagents.some((task) => task.status === status)
      ) {
        watched.unsubscribe();
        resolve();
      }
    });
  });
}

test("a spawned child runs independently and announces its result to the parent", async () => {
  const parent = record("parent", { title: "Parent" });
  const unrelated = record("other");
  const state = harness([parent, unrelated]);
  state.manager.ensure(parent);
  await waitForStatus(state.manager, parent.id, "idle");
  await state.service.initialize();
  const parentRuntime = state.sessions.get(parent.id)!;
  const announcement = parentRuntime.waitForPrompt((prompt) => prompt.startsWith("[HUI subagent completion event]"));

  const receipt = await state.service.handle(parent.id, "sessions_spawn", {
    task: "Inspect the implementation",
    label: "Inspector",
  }) as { status: string; taskId: string; childSessionKey: string };

  assert.equal(receipt.status, "accepted");
  await waitForTask(state.manager, parent.id, "completed");
  assert.match(await announcement, /Reply from child-1/);
  await state.sessions.get("child-1")?.disposedPromise;
  const child = state.records().find((item) => item.id === receipt.childSessionKey);
  assert.equal(child?.parentId, parent.id);
  assert.equal(child?.subagent?.status, "completed");
  assert.equal(state.sessions.get("child-1")?.prompts[0], "[Subagent Task]\nInspect the implementation");
  assert.equal(state.manager.snapshot(parent.id).subagents[0]?.title, "Inspector");
  assert.equal(state.manager.isLive("child-1"), false);

  state.service.dispose();
  state.manager.disposeAll();
});

test("spawn rejects a model missing from the caller's catalog before creating a child", async () => {
  const parent = record("parent");
  const state = harness([parent]);
  state.manager.ensure(parent);
  await waitForStatus(state.manager, parent.id, "idle");
  await state.service.initialize();
  const spawn = (model: string) => state.service.handle(parent.id, "sessions_spawn", { task: "Work", model });

  // An empty catalog cannot prove a model is missing, so it does not block.
  assert.equal((await spawn("gateway/unlisted") as { status: string }).status, "accepted");
  state.sessions.get(parent.id)!.models = [
    { provider: "gateway", id: "anthropic/claude-opus", name: "Opus" },
    { provider: "openai", id: "gpt-5", name: "GPT-5" },
  ];
  await assert.rejects(() => spawn("gateway/claude-opus"), /Unknown model: gateway\/claude-opus\. Did you mean gateway\/anthropic\/claude-opus\?/);
  await assert.rejects(() => spawn("gateway/nope"), /Available models include gateway\/anthropic\/claude-opus, openai\/gpt-5\./);
  await assert.rejects(() => spawn("other/gpt-5"), /Did you mean openai\/gpt-5\?/);
  assert.equal(state.records().filter((item) => item.parentId === parent.id).length, 1);
  assert.equal((await spawn("gateway/anthropic/claude-opus") as { status: string }).status, "accepted");

  state.service.dispose();
  state.manager.disposeAll();
});

for (const scenario of ["accepted", "accepted while waiting", "rejected", "unsupported", "settled during rejection"] as const) {
  test(`child completion steering: ${scenario}`, async (t) => {
    const parent = record("parent");
    const state = harness([parent], { manualSessionId: parent.id });
    t.after(() => {
      state.service.dispose();
      state.manager.disposeAll();
    });
    state.manager.ensure(parent);
    await waitForStatus(state.manager, parent.id, "idle");
    await state.service.initialize();
    await state.manager.prompt(parent.id, "Keep working on the parent task");
    const runtime = state.sessions.get(parent.id)!;
    const acceptsSteering = scenario === "accepted" || scenario === "accepted while waiting";
    if (scenario === "accepted while waiting") {
      runtime.emit({ type: "question", question: { id: "parent-question", method: "input", title: "More context?" } });
      assert.equal(state.manager.status(parent.id), "waiting");
    }
    let resolveDelivery!: () => void;
    const delivered = new Promise<void>((resolve) => { resolveDelivery = resolve; });
    const queued: string[] = [];
    t.mock.method(state.manager, "followUp", async (id: string, message: string) => {
      assert.equal(id, parent.id);
      queued.push(message);
      resolveDelivery();
    });
    if (scenario === "unsupported") {
      Object.defineProperty(runtime, "steer", { value: undefined });
    } else {
      t.mock.method(runtime, "steer", async (message: string) => {
        if (scenario === "settled during rejection") runtime.finish("Parent finished");
        if (!acceptsSteering) throw new Error("Steering refused");
        runtime.steered.push(message);
        resolveDelivery();
      });
    }
    const announcement = runtime.waitForPrompt((message) => message.startsWith("[HUI subagent completion event]"));

    await state.service.handle(parent.id, "sessions_spawn", { task: "Return a result" });
    if (scenario === "settled during rejection") await announcement;
    else await delivered;

    assert.equal(runtime.aborts, 0);
    if (acceptsSteering) {
      assert.equal(state.manager.status(parent.id), scenario === "accepted while waiting" ? "waiting" : "running");
      assert.equal(runtime.steered.length, 1);
      assert.match(runtime.steered[0]!, /Reply from child-1/);
      assert.deepEqual(queued, []);
      if (scenario === "accepted while waiting") {
        assert.equal(state.manager.snapshot(parent.id).questions[0]?.id, "parent-question");
        Object.defineProperty(runtime, "cancelQuestion", { value: async () => {} });
        await state.manager.cancelQuestion(parent.id, "parent-question");
      }
      runtime.finish("Parent incorporated the result");
      await waitForStatus(state.manager, parent.id, "idle");
      assert.equal(runtime.prompts.length, 1, "steering must not create a duplicate follow-up");
    } else {
      if (scenario !== "settled during rejection") {
        assert.equal(runtime.prompts.length, 1, "a busy parent must not receive a competing prompt");
        assert.equal(queued.length, 1);
        assert.match(queued[0]!, /Reply from child-1/);
      } else {
        assert.match(await announcement, /Reply from child-1/);
        assert.equal(runtime.prompts.length, 2);
        assert.deepEqual(queued, []);
      }
    }
  });
}

test("session tools are bounded to one tree and can read and message a child", async () => {
  const parent = record("parent", { title: "Parent" });
  const state = harness([parent, record("outside")]);
  state.manager.ensure(parent);
  await waitForStatus(state.manager, parent.id, "idle");
  await state.service.initialize();
  const receipt = await state.service.handle(parent.id, "sessions_spawn", {
    task: "Return a result",
  }) as { childSessionKey: string };
  await waitForTask(state.manager, parent.id, "completed");

  const listed = await state.service.handle(receipt.childSessionKey, "sessions_list", {}) as {
    sessions: Array<{ sessionKey: string }>;
  };
  assert.deepEqual(
    listed.sessions.map((session) => session.sessionKey).toSorted(),
    [parent.id, receipt.childSessionKey].toSorted(),
  );
  const history = await state.service.handle(parent.id, "sessions_history", {
    sessionKey: receipt.childSessionKey,
  }) as { messages: TranscriptEntry[] };
  assert.equal(history.messages.at(-1)?.kind, "message");
  assert.match(JSON.stringify(history.messages), /Reply from child-1/);

  const delivered = await state.service.handle(parent.id, "sessions_send", {
    sessionKey: receipt.childSessionKey,
    message: "Give me the short version",
    timeoutSeconds: 2,
  }) as { reply: string };
  assert.equal(delivered.reply, "Reply from child-1");
  await assert.rejects(
    () => state.service.handle(parent.id, "sessions_history", { sessionKey: "outside" }),
    /outside the current agent tree/,
  );

  state.service.dispose();
  state.manager.disposeAll();
});

test("session history enforces its byte limit for multibyte and oversized entries", async () => {
  const parent = record("parent");
  const state = harness([parent]);
  state.manager.ensure(parent);
  await waitForStatus(state.manager, parent.id, "idle");
  await state.service.initialize();
  await state.manager.prompt(parent.id, "🙂".repeat(30_000));
  await waitForStatus(state.manager, parent.id, "idle");
  await state.manager.prompt(parent.id, "recent");
  await waitForStatus(state.manager, parent.id, "idle");

  const history = await state.service.handle(parent.id, "sessions_history", {
    sessionKey: parent.id,
    limit: 100,
  }) as { messages: TranscriptEntry[] };

  assert.ok(Buffer.byteLength(JSON.stringify(history.messages), "utf8") <= 80 * 1024);
  assert.equal(history.messages[0]?.kind, "error");
  assert.match(
    history.messages[0]?.kind === "error" ? history.messages[0].message : "",
    /omitted because it exceeds/,
  );
  assert.equal(history.messages.at(-2)?.kind, "message");
  assert.equal(history.messages.at(-1)?.kind, "message");

  state.service.dispose();
  state.manager.disposeAll();
});

test("a running subagent can be listed, steered and cancelled", async () => {
  const parent = record("parent");
  const state = harness([parent], {
    manualSessionId: "child-running",
    ids: ["task-running", "child-running"],
  });
  state.manager.ensure(parent);
  await waitForStatus(state.manager, parent.id, "idle");
  await state.service.initialize();
  await state.service.handle(parent.id, "sessions_spawn", { task: "Keep working" });
  await waitForTask(state.manager, parent.id, "running");

  const listed = await state.service.handle(parent.id, "subagents", { action: "list" }) as {
    subagents: Array<{ taskId: string; status: string }>;
  };
  assert.deepEqual(listed.subagents.map((task) => [task.taskId, task.status]), [["task-running", "running"]]);
  await state.service.handle(parent.id, "subagents", {
    action: "steer",
    target: "task-running",
    message: "Focus on tests",
  });
  assert.deepEqual(state.sessions.get("child-running")?.steered, ["[Parent steering]\nFocus on tests"]);

  await state.service.handle(parent.id, "subagents", {
    action: "kill",
    target: "child-running",
  });
  await waitForTask(state.manager, parent.id, "cancelled");
  await state.sessions.get("child-running")?.disposedPromise;
  assert.equal(state.sessions.get("child-running")?.aborts, 1);
  assert.equal(state.manager.isLive("child-running"), false);

  state.service.dispose();
  state.manager.disposeAll();
});

test("a subagent timeout aborts its runtime and persists the terminal state", async () => {
  const parent = record("parent");
  const state = harness([parent], {
    manualSessionId: "child-timeout",
    ids: ["task-timeout", "child-timeout"],
  });
  state.manager.ensure(parent);
  await waitForStatus(state.manager, parent.id, "idle");
  await state.service.initialize();
  await state.service.handle(parent.id, "sessions_spawn", {
    task: "Do not finish",
    runTimeoutSeconds: 1,
  });

  await waitForTask(state.manager, parent.id, "timed_out");
  await state.sessions.get("child-timeout")?.disposedPromise;
  assert.equal(state.sessions.get("child-timeout")?.aborts, 1);
  assert.equal(state.manager.isLive("child-timeout"), false);
  assert.match(
    state.records().find((item) => item.id === "child-timeout")?.subagent?.error ?? "",
    /exceeded 1 seconds/,
  );

  state.service.dispose();
  state.manager.disposeAll();
});

test("startup marks abandoned active tasks interrupted", async () => {
  const parent = record("parent");
  const child = record("child", {
    parentId: parent.id,
    subagent: {
      taskId: "task-old",
      task: "Old task",
      status: "running",
      startedAt: timestamp,
      updatedAt: timestamp,
    },
  });
  const state = harness([parent, child]);

  await state.service.initialize();

  const recovered = state.records().find((item) => item.id === child.id)?.subagent;
  assert.equal(recovered?.status, "interrupted");
  assert.equal(recovered?.endedAt, timestamp);
  assert.match(recovered?.error ?? "", /gateway restarted/);
  assert.equal(state.manager.snapshot(parent.id).subagents[0]?.status, "interrupted");

  state.service.dispose();
  state.manager.disposeAll();
});

test("completions are batched until every active sibling finishes", async () => {
  const parent = record("parent", { title: "Parent" });
  const state = harness([parent], { manualSessionId: "child-2", ids: ["task-1", "child-1", "task-2", "child-2"] });
  state.manager.ensure(parent);
  await waitForStatus(state.manager, parent.id, "idle");
  await state.service.initialize();
  const parentRuntime = state.sessions.get(parent.id)!;
  await state.service.handle(parent.id, "sessions_spawn", { task: "Second", label: "B" });
  await state.service.handle(parent.id, "sessions_spawn", { task: "First", label: "A" });
  const firstDone = new Promise<void>((resolve) => {
    const check = () => state.records().find((r) => r.id === "child-1")?.subagent?.status === "completed" ? resolve() : setTimeout(check, 5);
    check();
  });
  await firstDone;
  assert.equal(parentRuntime.prompts.some((p) => p.startsWith("[HUI subagent completion event]")), false);
  const announcement = parentRuntime.waitForPrompt((p) => p.startsWith("[HUI subagent completion event]"));
  const second = state.sessions.get("child-2")!;
  await second.waitForPrompt(() => true);
  second.finish("Second done");
  const text = await announcement;
  assert.match(text, /count: 2/);
  assert.match(text, /Reply from child-1/);
  assert.match(text, /Second done/);
  assert.match(text, /<<<BEGIN_CHILD_RESULT>>>/);
  assert.match(text, /not a message from the user/);
  assert.equal(parentRuntime.prompts.filter((p) => p.startsWith("[HUI subagent completion event]")).length, 1);
  state.service.dispose();
  state.manager.disposeAll();
});

function pendingChild(id = "done", patch: Partial<SessionRecord> = {}): SessionRecord {
  return record(id, { parentId: "parent", subagent: {
    taskId: `task-${id}`, task: "Review", status: "completed", startedAt: timestamp,
    updatedAt: timestamp, endedAt: timestamp, summary: "Verified result", completionDelivery: "pending",
  }, ...patch });
}

test("a refused completion remains durable and retries without changing the child result", async (t) => {
  const state = harness([record("parent"), pendingChild()]);
  t.after(() => { state.service.dispose(); state.manager.disposeAll(); });
  await state.service.initialize();
  const original = state.manager.prompt.bind(state.manager);
  let reject = true;
  t.mock.method(state.manager, "prompt", async (id: string, message: string) => {
    if (reject) throw new Error("Temporary transport failure");
    await original(id, message);
  });
  await state.service.flushCompletions();
  assert.equal(state.records()[1]?.subagent?.completionDelivery, "pending");
  assert.equal(state.records()[1]?.subagent?.summary, "Verified result");
  reject = false;
  await state.service.flushCompletions();
  await waitForStatus(state.manager, "parent", "idle");
  await state.service.flushCompletions();
  assert.equal(state.records()[1]?.subagent?.completionDelivery, "delivered");
  assert.equal(state.sessions.get("parent")!.prompts.length, 1);
});

test("restart replays pending results but never legacy or acknowledged results", async (t) => {
  const legacy = pendingChild("legacy");
  delete legacy.subagent!.completionDelivery;
  const acknowledged = pendingChild("acknowledged");
  acknowledged.subagent!.completionDelivery = "delivered";
  const state = harness([record("parent"), pendingChild(), legacy, acknowledged]);
  t.after(() => { state.service.dispose(); state.manager.disposeAll(); });
  await state.service.initialize();
  await state.service.flushCompletions();
  await waitForStatus(state.manager, "parent", "idle");
  const prompts = state.sessions.get("parent")!.prompts;
  assert.equal(prompts.length, 1);
  assert.match(prompts[0]!, /delivery_ids: \["task-done"\]/);
  assert.doesNotMatch(prompts[0]!, /task-legacy|task-acknowledged/);
  // Simulate the crash window after PI persisted the event but before HUI's ack.
  assert.equal(state.records()[1]?.subagent?.completionDelivery, "pending");
  state.service.dispose();
  const restarted = new SubagentService(state.manager, async () => state.records(), state.update);
  t.after(() => restarted.dispose());
  await restarted.initialize();
  await restarted.flushCompletions();
  assert.equal(state.records()[1]?.subagent?.completionDelivery, "delivered");
  assert.equal(prompts.length, 1, "hydrated transcript suppresses replay after acknowledgement loss");
});

test("volatile steering is pending until consumed and survives a service restart", async (t) => {
  const state = harness([record("parent"), pendingChild()], { manualSessionId: "parent" });
  t.after(() => { state.service.dispose(); state.manager.disposeAll(); });
  state.manager.ensure(record("parent"));
  await waitForStatus(state.manager, "parent", "idle");
  await state.manager.prompt("parent", "Working");
  await state.service.flushCompletions();
  const runtime = state.sessions.get("parent")!;
  assert.equal(runtime.steered.length, 1);
  await Promise.all([state.service.flushCompletions(), state.service.flushCompletions()]);
  assert.equal(runtime.steered.length, 1, "admission does not repeatedly steer a busy parent");
  assert.equal(state.records()[1]?.subagent?.completionDelivery, "pending");
  state.service.dispose();
  const restarted = new SubagentService(state.manager, async () => state.records(), state.update);
  t.after(() => restarted.dispose());
  await restarted.initialize();
  // Simulate a lost volatile queue: the fake never put steering in its history.
  await restarted.flushCompletions();
  assert.equal(runtime.steered.length, 2);
  runtime.history.push({ kind: "message", role: "user", text: runtime.steered[1]! });
  runtime.finish("Consumed result");
  await waitForStatus(state.manager, "parent", "idle");
  await restarted.flushCompletions();
  assert.equal(state.records()[1]?.subagent?.completionDelivery, "delivered");
});

test("concurrent drains deliver one batch and a failed ack does not resend", async (t) => {
  const state = harness([record("parent"), pendingChild(), pendingChild("second")]);
  t.after(() => { state.service.dispose(); state.manager.disposeAll(); });
  await Promise.all([state.service.flushCompletions(), state.service.flushCompletions()]);
  await waitForStatus(state.manager, "parent", "idle");
  assert.equal(state.sessions.get("parent")!.prompts.length, 1);
  state.service.dispose();
  let refuseWrite = true;
  const restarted = new SubagentService(state.manager, async () => state.records(), async (mutate) => {
    if (refuseWrite) throw new Error("Disk temporarily unavailable");
    return state.update(mutate);
  });
  t.after(() => restarted.dispose());
  await restarted.flushCompletions();
  assert.equal(state.records()[1]?.subagent?.completionDelivery, "pending");
  refuseWrite = false;
  await restarted.flushCompletions();
  assert.equal(state.records()[1]?.subagent?.completionDelivery, "delivered");
  assert.equal(state.records()[2]?.subagent?.completionDelivery, "delivered");
  assert.equal(state.sessions.get("parent")!.prompts.length, 1);
});

test("restart groups completed and interrupted siblings into one recoverable event", async (t) => {
  const running = pendingChild("running");
  running.subagent!.status = "running";
  delete running.subagent!.completionDelivery;
  const state = harness([record("parent"), pendingChild(), running]);
  t.after(() => { state.service.dispose(); state.manager.disposeAll(); });
  await state.service.initialize();
  await state.service.flushCompletions();
  const prompts = state.sessions.get("parent")!.prompts;
  assert.equal(prompts.length, 1);
  assert.match(prompts[0]!, /count: 2/);
  assert.match(prompts[0]!, /status: interrupted/);
});

test("the retry timer recovers a transient failure without another completion", async (t) => {
  const state = harness([record("parent"), pendingChild()]);
  t.after(() => { state.service.dispose(); state.manager.disposeAll(); });
  state.manager.ensure(record("parent"));
  await waitForStatus(state.manager, "parent", "idle");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = state.manager.prompt.bind(state.manager);
  let reject = true;
  t.mock.method(state.manager, "prompt", async (id: string, text: string) => {
    if (reject) throw new Error("Temporary refusal");
    await original(id, text);
  });
  await state.service.flushCompletions();
  reject = false;
  const accepted = state.sessions.get("parent")!.waitForPrompt(() => true);
  t.mock.timers.tick(5_000);
  await accepted;
  await state.service.flushCompletions();
  assert.equal(state.sessions.get("parent")!.prompts.length, 1);
});

test("new descendants inherit the archived state of their parent", async (t) => {
  const parent = record("parent", { archived: true });
  const state = harness([parent]);
  t.after(() => { state.service.dispose(); state.manager.disposeAll(); });
  await state.service.handle(parent.id, "sessions_spawn", { task: "Return a result" });
  assert.equal(state.records().find((r) => r.id === "child-1")?.archived, true);
});

test("a child registered just before parent deletion cannot clear its deletion guard", async (t) => {
  const state = harness([record("parent")]);
  const service = new SubagentService(state.manager, async () => state.records(), async (mutate) => {
    const registered = await state.update(mutate);
    const child = registered.find((r) => r.parentId === "parent");
    if (child) {
      const token = state.manager.tombstone(child.id);
      await state.update(() => []);
      state.manager.finishDelete(child.id, token);
    }
    return registered;
  });
  t.after(() => { service.dispose(); state.service.dispose(); state.manager.disposeAll(); });
  await service.handle("parent", "sessions_spawn", { task: "Do not resurrect" });
  assert.deepEqual(state.starts, []);
  assert.deepEqual(state.records(), []);
});

test("forgetting a deleted subtree removes its background-task projections", async (t) => {
  const state = harness([record("parent"), pendingChild(), pendingChild("other")]);
  t.after(() => { state.service.dispose(); state.manager.disposeAll(); });
  await state.service.initialize();
  assert.equal(state.service.snapshot("parent").length, 2);
  state.service.forgetSessions(new Set(["done"]));
  assert.deepEqual(state.service.snapshot("parent").map((task) => task.sessionId), ["other"]);
  state.service.forgetSessions(new Set(["parent", "other"]));
  assert.deepEqual(state.service.snapshot("parent"), []);
});

/** Worker sessions scripted in memory: a prompt runs there until the test ends it. */
function scriptedWorker(t: TestContext) {
  const sinks = new Map<string, RemoteSessionSink>();
  const running = new Set<string>();
  const histories = new Map<string, TranscriptEntry[]>();
  const prompts = new Map<string, () => void>();
  let seq = 0;
  const state = (key: string) => ({ sessionId: key, isStreaming: running.has(key), resumesInterruptedRuns: true });
  t.mock.method(workers, "startSession", async (...[, key, , , sink]: Parameters<typeof workers.startSession>) => {
    sinks.set(key, sink);
    const history = histories.get(key) ?? [];
    histories.set(key, history);
    return {
      started: { state: state(key), seq: ++seq, transcript: [...history], methods: ["followUp", "abort"] },
      call: async (method: string, args: unknown[]) => {
        if (method === "prompt") {
          running.add(key);
          history.push({ kind: "message", role: "user", text: String(args[0]) });
          queueMicrotask(() => prompts.get(key)?.());
        }
        return { state: state(key), seq: ++seq };
      },
      transcript: async () => [...history],
      dispose: () => undefined,
    };
  });
  return {
    /** Resolves once a prompt for the session has reached the worker. */
    prompted(key: string): Promise<void> {
      return new Promise((resolve) => prompts.set(key, resolve));
    },
    /** The connection to a session drops and, maybe, its run finishes there meanwhile. */
    lose(key: string, unreachable: RuntimeUnreachable, reply?: string): void {
      if (reply !== undefined) {
        running.delete(key);
        histories.get(key)!.push({ kind: "message", role: "assistant", text: reply });
      }
      sinks.get(key)!.lost(unreachable);
    },
  };
}

async function spawnRemoteChild(t: TestContext) {
  const worker = scriptedWorker(t);
  const parent = record("remote-parent", { worker: "w" });
  const state = harness([parent]);
  state.manager.ensure(parent);
  await waitForStatus(state.manager, parent.id, "idle");
  await state.service.initialize();
  const prompted = worker.prompted("child-1");
  await state.service.handle(parent.id, "sessions_spawn", { task: "Inspect remotely" });
  await prompted;
  const child = () => state.records().find((item) => item.id === "child-1")!;
  assert.equal(child().worker, "w");
  const finished = (status: string) => new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 5_000;
    const check = () => child().subagent?.status === status ? resolve()
      : Date.now() > deadline ? reject(new Error(`The subagent is ${child().subagent?.status}, not ${status}.`)) : setTimeout(check, 5);
    check();
  });
  return { ...state, worker, parent, child, finished };
}

test("a remote subagent whose run finished while HUI was away completes once HUI reattaches", async (t) => {
  const state = await spawnRemoteChild(t);
  state.worker.lose("child-1", { reconnecting: true }, "Done remotely");
  await waitForStatus(state.manager, "child-1", "reconnecting");
  state.manager.ensure(state.child(), true);
  await state.finished("completed");
  assert.match(state.child().subagent?.summary ?? "", /Done remotely/u);
  state.service.dispose();
  state.manager.disposeAll();
});

test("a remote subagent fails when HUI is disconnected from its machine", async (t) => {
  const state = await spawnRemoteChild(t);
  state.worker.lose("child-1", { reconnecting: false });
  await state.finished("failed");
  assert.match(state.child().subagent?.error ?? "", /disconnected/u);
  state.service.dispose();
  state.manager.disposeAll();
});
