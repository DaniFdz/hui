import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { SessionSnapshot, SessionStatus, SessionStreamHandlers, SessionView, SubagentTaskView } from "../api/sessions.ts";
import { progressCardFromTranscript } from "../lib/progress-card.ts";
import { ConversationController } from "./conversation-controller.ts";

const fake = vi.hoisted(() => ({
  modelRequests: [] as string[],
  modelsFail: false,
  thinking: [] as { id: string; level: string; resolve: (level: string) => void }[],
  opens: [] as { id: string; resolve: (status: SessionStatus, snapshot?: Partial<SessionSnapshot>) => void }[],
  streams: [] as { id: string; handlers: SessionStreamHandlers; heldRevision?: number; stopped: boolean }[],
}));
vi.mock("../api/sessions.ts", () => ({
  loadModels: async (id: string) => {
    fake.modelRequests.push(id);
    if (fake.modelsFail) throw new Error("not booted");
    return [{ provider: "gw", id: "opus", name: "Opus" }];
  },
  setSessionThinking: (id: string, level: string) => new Promise((resolve) => fake.thinking.push({ id, level, resolve })),
  openSession: (id: string) => new Promise((resolve) => fake.opens.push({
    id,
    resolve: (status, snapshot = {}) => resolve({
      session: { id, status },
      snapshot: { transcript: [], status, queue: { steering: [], followUp: [] }, questions: [], subagents: [], ...snapshot },
      revision: 7,
    }),
  })),
  subscribeSession: (id: string, handlers: SessionStreamHandlers, heldRevision?: number) => {
    const stream = { id, handlers, heldRevision, stopped: false };
    fake.streams.push(stream);
    return () => { stream.stopped = true; };
  },
}));

beforeEach(() => {
  fake.modelRequests = [];
  fake.modelsFail = false;
  fake.thinking = [];
  fake.opens = [];
  fake.streams = [];
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function conversation(state: { selected?: SessionView; streaming?: boolean } = {}) {
  const errors: string[] = [];
  let updates = 0;
  let refreshes = 0;
  const host = { addController: () => {}, removeController: () => {}, requestUpdate: () => { updates += 1; }, updateComplete: Promise.resolve(true), renderRoot: { querySelector: () => null } as unknown as HTMLElement };
  const controller = new ConversationController(host, {
    showError: (message) => errors.push(message),
    refreshSessions: async () => { refreshes += 1; },
    paneCreating: () => false,
    paneCreationFailed: () => false,
    resetSession: () => {},
    connectionLost: () => {},
    adoptSnapshot: () => {},
    adoptEvent: () => {},
    statusChanged: () => {},
    flushLaunchPrompt: () => {},
  });
  controller.selected = state.selected;
  controller.streaming = state.streaming ?? false;
  return { controller, errors, updates: () => updates, refreshes: () => refreshes };
}

test("models are requested once per selection once the runtime is ready, and again after a failure", async () => {
  const selected = { id: "s1" } as SessionView;
  const { controller, updates } = conversation({ selected });
  controller.requestModelsWhenReady("s1", "starting");
  assert.deepEqual(fake.modelRequests, []);
  controller.requestModelsWhenReady("s1", "idle");
  controller.requestModelsWhenReady("s1", "idle");
  await settle();
  assert.deepEqual(fake.modelRequests, ["s1"]);
  assert.equal(controller.props().models.length, 1);
  assert.ok(updates() > 0);

  controller.resetModels();
  fake.modelsFail = true;
  controller.requestModelsWhenReady("s1", "idle");
  await settle();
  controller.requestModelsWhenReady("s1", "idle");
  await settle();
  assert.deepEqual(fake.modelRequests, ["s1", "s1", "s1"]);
  assert.deepEqual(controller.props().models, []);
});

test("thinking waits while the session runs and only follows the session still selected", async () => {
  const { controller } = conversation({ selected: { id: "s1" } as SessionView, streaming: true });
  controller.props().onSelectThinking("high");
  assert.equal(fake.thinking.length, 0);

  controller.streaming = false;
  controller.props().onSelectThinking("high");
  fake.thinking[0]?.resolve("high");
  await settle();
  assert.equal(controller.props().thinking, "high");

  controller.props().onSelectThinking("low");
  controller.select({ id: "s2" } as SessionView);
  fake.thinking[1]?.resolve("low");
  await settle();
  assert.equal(controller.props().thinking, "high");
});

test("only the session still selected opens and streams; its status frames reach the shell", async () => {
  const statuses: string[] = [];
  const host = { addController: () => {}, removeController: () => {}, requestUpdate: () => {}, updateComplete: Promise.resolve(true), renderRoot: { querySelector: () => null } as unknown as HTMLElement };
  const controller = new ConversationController(host, {
    showError: () => {},
    refreshSessions: async () => {},
    paneCreating: () => false,
    paneCreationFailed: () => false,
    resetSession: () => {},
    connectionLost: () => {},
    adoptSnapshot: () => {},
    adoptEvent: () => {},
    statusChanged: (id, status) => statuses.push(`${id}:${status}`),
    flushLaunchPrompt: () => {},
  });
  controller.select({ id: "s1" } as SessionView);
  void controller.open("s1");
  controller.select({ id: "s2" } as SessionView);
  void controller.open("s2");
  assert.equal(controller.opening, true);
  fake.opens[0]?.resolve("idle");
  await settle();
  assert.deepEqual(fake.streams.map(({ id }) => id), [], "a late answer for s1 starts nothing");

  fake.opens[1]?.resolve("running");
  await settle();
  assert.equal(controller.opening, false);
  assert.equal(controller.streaming, true);
  assert.deepEqual(fake.streams.map(({ id }) => id), ["s2"]);
  assert.equal(fake.streams[0]?.heldRevision, 7, "the stream starts from the transcript the open already brought");
  fake.streams[0]?.handlers.onStatus("idle");
  assert.equal(controller.streaming, false);
  assert.equal(controller.selected?.status, "idle");
  assert.deepEqual(statuses, ["s2:running", "s2:idle"]);

  controller.suspend();
  assert.equal(fake.streams[0]?.stopped, true);
  assert.equal(controller.streamOpen, false);
});

test("a refresh reads the open session again and shows the card the gateway has", async () => {
  const stale = { kind: "tool" as const, id: "p", name: "progress_card", args: { plan: [{ step: "Old step", status: "in_progress" }] } };
  const { controller } = conversation({ selected: { id: "s1" } as SessionView });
  controller.transcript = [stale];
  assert.equal(progressCardFromTranscript(controller.transcript)?.steps[0]?.step, "Old step");

  const refreshed = controller.refresh();
  assert.equal(controller.refreshing, true);
  await settle();
  fake.opens[0]?.resolve("running", {
    transcript: [
      { kind: "message", role: "user", text: "go" },
      { kind: "tool", id: "p", name: "progress_card", args: { plan: [{ step: "New step", status: "in_progress" }] } },
    ],
  });
  await refreshed;

  assert.equal(controller.refreshing, false);
  assert.equal(progressCardFromTranscript(controller.transcript)?.steps[0]?.step, "New step");
});

test("a conversation whose element is removed starts no stream for an open still pending, and leaves no copy timer or stale state", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { clipboard: { writeText: async () => {} } });
  try {
    const { controller, updates } = conversation({ selected: { id: "s1" } as SessionView });
    void controller.open("s1");
    assert.equal(await controller.copy("text", "m1"), true);
    let finishWrite!: () => void;
    vi.stubGlobal("navigator", { clipboard: { writeText: () => new Promise<void>((resolve) => { finishWrite = resolve; }) } });
    const late = controller.copy("text", "m2");
    controller.hostDisconnected();
    assert.equal(controller.opening, false, "a reattached pane does not stay opening");
    assert.equal(controller.copiedId, "", "nor keeps a Copied mark");
    fake.opens[0]?.resolve("idle");
    finishWrite();
    assert.equal(await late, true);
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(fake.streams, []);
    const before = updates();
    await vi.advanceTimersByTimeAsync(1_500);
    assert.equal(updates(), before, "a copy that finished after removal arms no timer");
    assert.equal(controller.copiedId, "");
  } finally {
    vi.useRealTimers();
  }
});

test("a conversation keeps its transcript through a snapshot without one, and reads the session list only when its subagents change", async () => {
  vi.stubGlobal("window", globalThis);
  const { controller, refreshes } = conversation({ selected: { id: "s1" } as SessionView });
  const child = (status: SubagentTaskView["status"]): SubagentTaskView =>
    ({ taskId: "t1", sessionId: "c1", parentSessionId: "s1", title: "child", status, startedAt: "2026-10-20T10:00:00.000Z", updatedAt: status === "running" ? "2026-10-20T10:00:00.000Z" : "2026-10-20T10:05:00.000Z" });
  const sideUpdate = (status: SubagentTaskView["status"]) => ({ status: "idle" as const, queue: { steering: [], followUp: [] }, questions: [], subagents: [child(status)] });
  void controller.open("s1");
  fake.opens[0]?.resolve("idle", { transcript: [{ kind: "message", role: "user", text: "hello" }], subagents: [child("running")] });
  await settle();
  assert.equal(refreshes(), 0, "the shell's status stream already lists the children");
  fake.streams[0]?.handlers.onSnapshot(sideUpdate("running"));
  assert.deepEqual(controller.transcript.map((item) => item.kind === "message" ? item.text : item.kind), ["hello"]);
  assert.equal(refreshes(), 0);
  fake.streams[0]?.handlers.onSnapshot(sideUpdate("completed"));
  assert.equal(refreshes(), 1);
  assert.equal(controller.transcript.length, 1);
});

test("streamed text, thinking and tool output redraw the conversation once per animation frame; other events at once", async () => {
  vi.stubGlobal("window", globalThis);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  const { controller, updates } = conversation({ selected: { id: "s1" } as SessionView });
  void controller.open("s1");
  fake.opens[0]?.resolve("running", { transcript: [{ kind: "message", role: "user", text: "go" }] });
  await settle();
  const stream = fake.streams[0]!.handlers;
  stream.onEvent({ type: "tool_start", id: "t1", name: "bash" });
  const before = updates();
  for (let index = 0; index < 10; index += 1) {
    stream.onEvent({ type: "thinking", delta: "hmm " });
    stream.onEvent({ type: "tool_update", id: "t1", name: "bash", output: `line ${index}` });
    stream.onEvent({ type: "text", delta: "word " });
  }
  assert.equal(updates(), before, "nothing redraws before the frame");
  assert.equal(frames.length, 1, "the burst shares one frame");
  frames.shift()!(0);
  assert.equal(updates(), before + 1);
  stream.onEvent({ type: "tool_start", id: "t2", name: "bash" });
  assert.equal(updates(), before + 2, "a new tool row redraws at once");
});
