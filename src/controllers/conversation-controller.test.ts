import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { OutdatedBuildError } from "../api/offline.ts";
import { GatewayHttpError } from "../api/request.ts";
import type { SessionSnapshot, SessionStatus, SessionStreamHandlers, SessionStreamSnapshot, SessionView, SubagentTaskView } from "../api/sessions.ts";
import type { SavedConversation } from "../lib/session/offline-store.ts";
import { progressCardFromTranscript } from "../lib/progress-card.ts";
import { ConversationController } from "./conversation-controller.ts";

const fake = vi.hoisted(() => ({
  modelRequests: [] as string[],
  modelsFail: false,
  thinking: [] as { id: string; level: string; resolve: (level: string) => void }[],
  opens: [] as { id: string; signal?: AbortSignal; resolve: (status: SessionStatus, snapshot?: Partial<SessionSnapshot>) => void; reject: (error: unknown) => void }[],
  prompts: [] as { id: string; text: string; mode: string }[],
  streams: [] as { id: string; handlers: SessionStreamHandlers; heldRevision?: number; stopped: boolean }[],
  saved: new Map<string, SavedConversation>(),
  savedHeld: undefined as Promise<void> | undefined,
}));
vi.mock("../api/sessions.ts", () => ({
  loadModels: async (id: string) => {
    fake.modelRequests.push(id);
    if (fake.modelsFail) throw new Error("not booted");
    return [{ provider: "gw", id: "opus", name: "Opus" }];
  },
  setSessionThinking: (id: string, level: string) => new Promise((resolve) => fake.thinking.push({ id, level, resolve })),
  sendPrompt: async (id: string, text: string) => { fake.prompts.push({ id, text, mode: "prompt" }); return { duplicate: false }; },
  followUpSession: async (id: string, text: string) => { fake.prompts.push({ id, text, mode: "follow-up" }); return { duplicate: false }; },
  openSession: (id: string, signal?: AbortSignal) => new Promise((resolve, reject) => fake.opens.push({
    id,
    signal,
    reject,
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
vi.mock("../lib/session/offline-store.ts", () => ({
  readSavedConversation: async (id: string) => { await fake.savedHeld; return fake.saved.get(id); },
  saveConversation: async () => {},
  forgetConversation: async () => { fake.saved.clear(); },
}));

beforeEach(() => {
  fake.modelRequests = [];
  fake.modelsFail = false;
  fake.thinking = [];
  fake.opens = [];
  fake.prompts = [];
  fake.streams = [];
  fake.saved = new Map();
  fake.savedHeld = undefined;
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function conversation(state: { selected?: SessionView; streaming?: boolean } = {}) {
  const errors: string[] = [];
  const adopts: SessionStreamSnapshot[] = [];
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
    adoptSnapshot: (snapshot) => { adopts.push(snapshot); },
    adoptEvent: () => {},
    statusChanged: () => {},
    flushLaunchPrompt: () => {},
  });
  controller.selected = state.selected;
  controller.streaming = state.streaming ?? false;
  return { controller, errors, adopts, updates: () => updates, refreshes: () => refreshes };
}

const savedCopy = (text = "asked before"): SavedConversation => ({
  session: { id: "s1", title: "Saved", status: "disconnected" } as SessionView,
  savedAt: 1_700_000_000_000,
  truncated: true,
  transcript: [{ kind: "message", role: "user", text }],
});

const texts = (controller: ConversationController) =>
  controller.transcript.flatMap((item) => item.kind === "message" ? [item.text] : []);

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
  assert.equal(fake.opens[0]?.signal?.aborted, true, "the discarded opening releases its transfer");
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

test("a refresh reads the open session again, asks the agent, and stays busy until that turn ends", async () => {
  const stale = { kind: "tool" as const, id: "p", name: "progress_card", args: { plan: [{ step: "Old step", status: "in_progress" }] } };
  const { controller } = conversation({ selected: { id: "s1" } as SessionView });
  void controller.open("s1");
  await settle();
  fake.opens[0]?.resolve("idle");
  await settle();
  controller.transcript = [stale];
  assert.equal(progressCardFromTranscript(controller.transcript)?.steps[0]?.step, "Old step");

  const refreshed = controller.refresh();
  assert.equal(controller.refreshing, true, "the click is busy at once, so a second one is refused");
  void controller.refresh();
  await settle();
  assert.equal(fake.opens.length, 2, "a second click while busy asks the gateway nothing");
  fake.opens[1]?.resolve("idle", {
    transcript: [
      { kind: "message", role: "user", text: "go" },
      { kind: "tool", id: "p", name: "progress_card", args: { plan: [{ step: "New step", status: "in_progress" }] } },
    ],
  });
  await refreshed;

  assert.equal(progressCardFromTranscript(controller.transcript)?.steps[0]?.step, "New step");
  assert.deepEqual(fake.prompts.map(({ id }) => id), ["s1"], "the card is the agent's, so the refresh asks it for a current one");
  assert.match(fake.prompts[0]?.text ?? "", /^Refresh the task progress card/u);
  assert.equal(fake.prompts[0]?.mode, "prompt", "an idle session starts the turn at once");
  assert.equal(controller.refreshing, true, "the agent is still working on the card");

  fake.streams[0]?.handlers.onStatus("idle");
  assert.equal(controller.refreshing, false);
});

test("a refresh on a running session queues the request rather than being refused", async () => {
  const { controller } = conversation({ selected: { id: "s1" } as SessionView, streaming: true });
  const refreshed = controller.refresh();
  await settle();
  fake.opens[0]?.resolve("running");
  await refreshed;

  assert.equal(fake.prompts[0]?.mode, "follow-up");
  assert.equal(controller.refreshing, true);
});

test("a refresh never asks the agent while the connection is not live", async () => {
  for (const connection of ["saved", "reconnecting", "stopped", "outdated"] as const) {
    const { controller } = conversation({ selected: { id: "s1" } as SessionView });
    controller.connection = connection;
    await controller.refresh();
    assert.equal(fake.opens.length, 0);
    assert.equal(fake.prompts.length, 0);
  }

  const { controller } = conversation({ selected: { id: "s1" } as SessionView });
  const refreshed = controller.refresh();
  controller.connection = "outdated";
  fake.opens[0]?.resolve("idle");
  await refreshed;
  assert.equal(fake.prompts.length, 0);
  assert.equal(controller.refreshing, false);
});

for (const outcome of ["resolve", "reject"] as const) {
  test(`a cancelled refresh that later ${outcome}s cannot clear the replacement session's refresh`, async () => {
    const { controller, errors } = conversation({ selected: { id: "s1" } as SessionView });
    const oldRefresh = controller.refresh();
    controller.select({ id: "s2" } as SessionView);
    const opening = controller.open("s2");
    assert.equal(fake.opens[0]?.signal?.aborted, true);
    await controller.refresh();
    assert.equal(fake.opens.length, 2, "refresh does not compete with the initial open");
    fake.opens[1]?.resolve("idle");
    await opening;
    const refresh = controller.refresh();
    fake.opens[2]?.resolve("idle", { transcript: [{ kind: "message", role: "user", text: "Current session" }] });
    await refresh;
    assert.equal(controller.refreshing, true, "the replacement agent is still working");
    if (outcome === "resolve") fake.opens[0]?.resolve("idle", { transcript: [{ kind: "message", role: "user", text: "Old session" }] });
    else fake.opens[0]?.reject(new Error("Late network failure"));
    await oldRefresh;
    assert.equal(controller.refreshing, true, "the old read does not own this loading state");
    assert.equal(controller.selected?.id, "s2");
    assert.deepEqual(controller.transcript.map((item) => item.kind === "message" ? item.text : item.kind), ["Current session"]);
    assert.deepEqual(fake.prompts.map(({ id }) => id), ["s2"]);
    assert.deepEqual(errors, []);
    fake.streams[0]?.handlers.onStatus("idle");
    assert.equal(controller.refreshing, false);
  });
}

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
    assert.equal(fake.opens[0]?.signal?.aborted, true, "an evicted pane releases its unfinished transfer");
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

test("a saved copy opens while the gateway is away, and only the live snapshot takes its place", async () => {
  const saved = savedCopy();
  fake.saved.set("s1", saved);
  const { controller, adopts } = conversation({ selected: { id: "s1" } as SessionView });
  const opening = controller.open("s1");
  await settle();
  assert.equal(controller.connection, "saved");
  assert.equal(controller.savedCopy?.truncated, true);
  assert.deepEqual(texts(controller), ["asked before"]);
  assert.deepEqual(adopts, [], "a saved copy never adopts a snapshot of its own");
  assert.deepEqual(fake.modelRequests, [], "nor asks for the models a live session needs");

  fake.opens.at(-1)?.reject(new TypeError("Failed to fetch"));
  await opening;
  assert.equal(controller.connection, "saved");
  assert.deepEqual(fake.streams.map(({ id }) => id), ["s1"], "it reconnects for the live transcript");
  assert.deepEqual(texts(controller), ["asked before"]);

  fake.streams[0]?.handlers.onSnapshot({ status: "idle", transcript: [{ kind: "message", role: "user", text: "asked now" }], queue: { steering: [], followUp: [] }, questions: [], subagents: [] });
  fake.streams[0]?.handlers.onConnection("live", "");
  assert.equal(controller.connection, "live");
  assert.equal(controller.savedCopy, undefined);
  assert.equal(adopts.length, 1, "only the gateway's snapshot reaches the shell");
  assert.deepEqual(texts(controller), ["asked now"]);
});

test("a refused open keeps its own error instead of the saved copy", async () => {
  for (const status of [403, 404, 500]) {
    fake.saved.set("s1", savedCopy());
    const { controller } = conversation({ selected: { id: "s1" } as SessionView });
    const opening = controller.open("s1");
    await settle();
    fake.opens.at(-1)?.reject(new GatewayHttpError(status, `refused ${status}`));
    await opening;
    assert.equal(controller.connection, "stopped", `${status} is a refusal, not an outage`);
    assert.equal(controller.openError, `refused ${status}`);
    assert.deepEqual(texts(controller), [], "a refused open shows no saved copy");
    assert.equal(controller.savedCopy, undefined);
    assert.equal(fake.streams.length, 0);
  }
});

test("an unreachable gateway or another build keeps the saved copy, and only the outage reconnects", async () => {
  const cases = [
    { error: new GatewayHttpError(502, "bad gateway"), connection: "saved", streams: 1 },
    { error: new OutdatedBuildError(), connection: "outdated", streams: 0 },
  ];
  for (const expected of cases) {
    fake.saved.set("s1", savedCopy());
    const streamsBefore = fake.streams.length;
    const { controller } = conversation({ selected: { id: "s1" } as SessionView });
    const opening = controller.open("s1");
    await settle();
    fake.opens.at(-1)?.reject(expected.error);
    await opening;
    assert.equal(controller.connection, expected.connection);
    assert.deepEqual(texts(controller), ["asked before"]);
    assert.ok(controller.connectionNote.length > 0);
    assert.equal(fake.streams.length - streamsBefore, expected.streams, "an outdated page waits for a reload instead of streaming");
  }
});

test("a saved copy that arrives after another session is chosen shows nothing", async () => {
  fake.saved.set("s1", savedCopy());
  let release!: () => void;
  fake.savedHeld = new Promise<void>((resolve) => { release = resolve; });
  const { controller, updates } = conversation({ selected: { id: "s1" } as SessionView });
  void controller.open("s1");
  await settle();
  controller.select({ id: "s2" } as SessionView);
  const before = updates();
  release();
  await settle();
  assert.equal(controller.connection, "reconnecting", "a late saved read never takes the screen");
  assert.deepEqual(texts(controller), []);
  assert.equal(controller.savedCopy, undefined);
  assert.equal(updates(), before, "nothing redraws for it");
});

test("forgetting the saved conversations while an open is pending never restores them", async () => {
  fake.saved.set("s1", savedCopy());
  const { controller } = conversation({ selected: { id: "s1" } as SessionView });
  const opening = controller.open("s1");
  await controller.forgetSaved();
  assert.equal(controller.savedCopy, undefined);
  fake.opens.at(-1)?.reject(new TypeError("Failed to fetch"));
  await opening;
  assert.deepEqual(texts(controller), [], "the copy removed from this device stays removed");
  assert.equal(controller.savedCopy, undefined);
  assert.equal(controller.connection, "stopped");
  assert.equal(controller.openError, "Failed to fetch");
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
