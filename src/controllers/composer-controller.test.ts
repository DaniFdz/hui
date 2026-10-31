import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { QueueSnapshot, SessionConnection, SessionSnapshot, SessionView } from "../api/sessions.ts";
import type { ComposerDraft } from "../lib/composer/drafts.ts";
import { NEW_SESSION_DRAFT_KEY, sessionDraftKey } from "../lib/composer/drafts.ts";
import { ComposerController } from "./composer-controller.ts";
import type { ConversationController } from "./conversation-controller.ts";

const fake = vi.hoisted(() => ({
  mutations: [] as { id: string; mutation: unknown; resolve: () => void; reject: (error: Error) => void }[],
  goals: [] as { id: string; action: string; objective?: string; resolve: () => void; reject: (error: Error) => void }[],
  drafts: new Map<string, ComposerDraft>(),
  pathRequests: [] as { cwd: string; input: string }[],
  prompts: [] as { id: string; text: string; resolve: () => void; reject: (error: Error) => void }[],
  rewinds: [] as unknown[][],
  aborts: [] as string[],
}));
vi.mock("../api/sessions.ts", () => ({
  mutateQueuedMessage: (id: string, mutation: unknown) => new Promise<void>((resolve, reject) => fake.mutations.push({ id, mutation, resolve, reject })),
  sendPrompt: (id: string, text: string) => new Promise((resolve, reject) => fake.prompts.push({ id, text, resolve: () => resolve({ duplicate: false }), reject })),
  rewindSession: async (...args: unknown[]) => { fake.rewinds.push(args); },
  abortSession: async (id: string) => { fake.aborts.push(id); },
  setSessionGoal: (id: string, action: string, objective?: string) => new Promise((resolve, reject) => {
    fake.goals.push({ id, action, objective, resolve: () => resolve({ id } as SessionView), reject });
  }),
}));
vi.mock("../api/attachments.ts", () => ({
  readTranscriptAttachments: async (sent: readonly string[]) => sent.map((name) => ({ name, kind: "file", mimeType: "text/plain", data: "" })),
}));
vi.mock("../api/local-paths.ts", () => ({
  loadLocalPathSuggestions: async (cwd: string, input: string) => {
    fake.pathRequests.push({ cwd, input });
    return [{ path: "src/", kind: "directory" }, { path: "src/app.ts", kind: "file" }];
  },
}));
vi.mock("../lib/composer/drafts.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/composer/drafts.ts")>(),
  readComposerDraft: async (key: string) => fake.drafts.get(key) ?? { text: "", attachments: [] },
  writeComposerDraft: async (key: string, draft: ComposerDraft) => { fake.drafts.set(key, draft); return "persisted"; },
  listComposerDraftSessionIds: async () => [],
}));

beforeEach(() => {
  fake.mutations = [];
  fake.goals = [];
  fake.drafts = new Map();
  fake.pathRequests = [];
  fake.prompts = [];
  fake.rewinds = [];
  fake.aborts = [];
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function composer(selected: { current: SessionView | undefined }, options: { embeddedPane?: boolean; streaming?: boolean; textarea?: HTMLTextAreaElement; connection?: SessionConnection } = {}) {
  const notes: string[] = [];
  const reported: string[] = [];
  let updates = 0;
  const host = { addController: () => {}, removeController: () => {}, requestUpdate: () => { updates += 1; }, updateComplete: Promise.resolve(true), renderRoot: { querySelector: () => null } as unknown as HTMLElement };
  const conversation = {
    get selected() { return selected.current; },
    opening: false,
    connection: options.connection ?? "live",
    stopping: false,
    streaming: options.streaming ?? false,
    transcript: [],
  } as unknown as ConversationController;
  const controller = new ComposerController(host, {
    conversation,
    showNote: (message, level) => notes.push(`${level}:${message}`),
    embeddedPane: () => options.embeddedPane ?? false,
    draftChanged: (sessionId, hasDraft) => reported.push(`${sessionId}:${hasDraft}`),
    composerSession: () => selected.current,
    draftCommands: () => [],
    defaultCwd: () => "~/default",
    mentionable: () => [],
    textarea: () => options.textarea ?? null,
    handleUpdateCommand: () => false,
    launching: () => false,
  });
  return { controller, conversation, notes, reported, updates: () => updates };
}

test("a draft follows its session's key, reports its presence and marks the session's row", async () => {
  const { controller, reported } = composer({ current: { id: "s1" } as SessionView });
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  controller.props().onDraftInput("hello");
  await settle();
  assert.deepEqual(fake.drafts.get(sessionDraftKey("s1")), { text: "hello", attachments: [] });
  assert.deepEqual(reported, ["s1:true"]);
  assert.deepEqual([...controller.draftSessionIds], ["s1"]);

  controller.switchDraft(NEW_SESSION_DRAFT_KEY);
  assert.equal(controller.draft, "");
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  assert.equal(controller.draft, "hello", "returning to the session restores its draft");

  controller.props().onDraftChange("");
  assert.deepEqual(reported, ["s1:true", "s1:true", "s1:false"]);
  assert.deepEqual([...controller.draftSessionIds], []);
});

test("an embedded pane never reads or writes the New Session draft", async () => {
  fake.drafts.set(NEW_SESSION_DRAFT_KEY, { text: "launch text", attachments: [] });
  const { controller } = composer({ current: { id: "s1" } as SessionView }, { embeddedPane: true });
  controller.switchDraft(sessionDraftKey("s1"));
  controller.switchDraft(NEW_SESSION_DRAFT_KEY);
  await settle();
  assert.equal(controller.draftKey, sessionDraftKey("s1"));
  assert.equal(controller.draft, "");
  await controller.persistDraft(NEW_SESSION_DRAFT_KEY, "", []);
  assert.deepEqual(fake.drafts.get(NEW_SESSION_DRAFT_KEY), { text: "launch text", attachments: [] });
});

test("typing renders only when the composer starts or stops holding text; a draft HUI sets is measured again", () => {
  const { controller, updates } = composer({ current: undefined });
  const typed = controller.props().onDraftInput;
  const before = updates();
  typed("h");
  assert.equal(updates(), before + 1);
  typed("hi");
  assert.equal(updates(), before + 1);
  assert.equal(controller.draftRevision, 0);
  controller.setDraft("from HUI");
  assert.equal(controller.draftRevision, 1);
});

test("an @ path query loads suggestions for the session's folder and a pick completes the draft", async () => {
  const { controller } = composer({ current: { id: "s1", cwd: "~/repo" } as SessionView });
  controller.setDraft("open @sr");
  controller.props().onLocalPathQuery({ input: "sr", start: 5, end: 8, mention: true });
  await settle();
  assert.deepEqual(fake.pathRequests, [{ cwd: "~/repo", input: "sr" }]);
  const [directory, file] = controller.props().localPathMenu.paths;
  assert.ok(directory && file);
  controller.props().localPathMenu.onSelect(file);
  assert.equal(controller.draft, "open @src/app.ts");
  assert.equal(controller.localPathQuery, null);
});

test("typing within an @ path query that has not changed does not render again", async () => {
  const { controller, updates } = composer({ current: { id: "s1", cwd: "~/repo" } as SessionView });
  controller.props().onLocalPathQuery({ input: "sr", start: 5, end: 8, mention: true });
  await settle();
  const before = updates();
  controller.props().onLocalPathQuery({ input: "sr", start: 5, end: 8, mention: true });
  assert.equal(updates(), before);
  assert.deepEqual(fake.pathRequests, [{ cwd: "~/repo", input: "sr" }]);
});

const queue = (...ids: string[]): QueueSnapshot => ({ steering: [], followUp: [], items: ids.map((id) => ({ id, text: `text ${id}`, mode: "followUp" })) });

test("editing a queued message ends when the queue drops it or the edit is saved", async () => {
  const selected = { current: { id: "s1" } as SessionView | undefined };
  const { controller, notes, updates } = composer(selected);
  controller.adoptSnapshot({ queue: queue("q1", "q2") } as SessionSnapshot);
  controller.props().onQueueEdit("q1");
  assert.equal(controller.queueEditingText, "text q1");
  assert.ok(updates() > 0);

  controller.adoptSnapshot({ queue: queue("q2") } as SessionSnapshot);
  assert.equal(controller.queueEditingId, "");

  controller.props().onQueueEdit("q2");
  controller.props().onQueueEditChange("  changed  ");
  controller.props().onQueueEditSubmit();
  assert.deepEqual(fake.mutations.map(({ id, mutation }) => [id, mutation]), [["s1", { operation: "edit", itemId: "q2", text: "changed" }]]);
  fake.mutations[0]?.resolve();
  await settle();
  assert.equal(controller.queueEditingId, "");

  controller.props().onQueueRemove("q2");
  fake.mutations[1]?.reject(new Error("gone"));
  await settle();
  assert.deepEqual(notes, ["error:gone"]);

  controller.props().onQueueSteer("q2");
  selected.current = { id: "s2" } as SessionView;
  fake.mutations[2]?.reject(new Error("late"));
  await settle();
  assert.deepEqual(notes, ["error:gone"], "a failure for a session no longer shown says nothing");
});

test("a sent prompt claims the draft at once and a refused one comes back with the error", async () => {
  const { controller, conversation, notes } = composer({ current: { id: "s1", status: "idle" } as SessionView });
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  controller.props().onDraftInput("ship it");
  controller.send("ship it");
  assert.equal(controller.sending, true);
  assert.equal(controller.draft, "");
  assert.deepEqual(conversation.transcript.map((item) => item.kind === "message" && [item.role, item.text]), [["user", "ship it"]]);
  assert.deepEqual(fake.prompts.map(({ id, text }) => [id, text]), [["s1", "ship it"]]);

  fake.prompts[0]?.reject(new Error("refused"));
  await settle();
  assert.equal(controller.sending, false);
  assert.equal(controller.draft, "ship it");
  assert.deepEqual(fake.drafts.get(sessionDraftKey("s1")), { text: "ship it", attachments: [] });
  assert.deepEqual(notes.at(-1), "error:refused");
});

test("a launched session's first prompt waits for idle and returns to the composer if the start fails", async () => {
  const selected = { current: { id: "s1", status: "starting" } as SessionView };
  const { controller } = composer(selected);
  controller.pendingLaunchPrompt = "first";
  controller.flushLaunchPrompt();
  assert.equal(fake.prompts.length, 0);
  selected.current = { id: "s1", status: "idle" } as SessionView;
  controller.followStatus("idle");
  assert.deepEqual(fake.prompts.map(({ text }) => text), ["first"]);
  assert.equal(controller.pendingLaunchPrompt, "");

  controller.pendingLaunchPrompt = "second";
  controller.followStatus("error");
  assert.equal(controller.draft, "second");
  assert.equal(controller.pendingLaunchPrompt, "");
});

test("rewinding works while the session runs and puts the message back in the composer, caret at its end", async () => {
  let caret: [number, number] | undefined;
  let focused = false;
  const textarea = { focus: () => { focused = true; }, setSelectionRange: (start: number, end: number) => { caret = [start, end]; } } as unknown as HTMLTextAreaElement;
  const { controller, notes } = composer({ current: { id: "s1" } as SessionView }, { streaming: true, textarea });
  const target = { entryId: "e1" } as unknown as Parameters<ReturnType<ComposerController["props"]>["onRewind"]>[0];
  controller.props().onRewind(target, "try again", ["notes.txt"]);
  assert.equal(controller.rewindPending, true);
  await settle();
  assert.deepEqual(fake.rewinds, [["s1", target, true]]);
  assert.equal(controller.draft, "try again");
  assert.deepEqual(controller.attachments.map(({ name }) => name), ["notes.txt"]);
  assert.ok(focused);
  assert.deepEqual(caret, [9, 9]);
  assert.equal(controller.rewindPending, false);
  assert.deepEqual(notes, ["info:", "info:Message restored to the composer. The previous branch is kept."]);
});

test("a saved, reconnecting or outdated conversation rewinds, queues and stops nothing", async () => {
  const target = { entryId: "e1" } as unknown as Parameters<ReturnType<ComposerController["props"]>["onRewind"]>[0];
  for (const connection of ["saved", "reconnecting", "outdated"] as const) {
    const { controller, conversation, notes } = composer({ current: { id: "s1" } as SessionView }, { connection });
    controller.setDraft("half typed");
    controller.props().onRewind(target, "try again");
    controller.props().onQueueRemove("q1");
    controller.abort();
    await settle();
    assert.deepEqual(fake.rewinds, [], `${connection} never rewinds`);
    assert.deepEqual(fake.mutations, [], `${connection} never changes the queue`);
    assert.deepEqual(fake.aborts, [], `${connection} never stops a turn`);
    assert.equal(controller.draft, "half typed");
    assert.equal(controller.rewindPending, false);
    assert.equal(conversation.stopping, false);
    assert.deepEqual(notes, []);
  }
});

test("the goal pill expands in place and keeps a refused objective where it was typed", async () => {
  const goal = { objective: "get CI green on PR 1", status: "active", createdAt: "2026-10-28T09:00:00.000Z", updatedAt: "2026-10-28T09:00:00.000Z", continuations: 0 };
  const { controller, notes } = composer({ current: { id: "s1", status: "idle", goal } as SessionView });
  const props = controller.props();
  assert.deepEqual({ ...props.goalPanel }, { expanded: false, editing: false, error: "" });
  props.onGoalToggle();
  assert.deepEqual({ ...controller.goalPanel }, { expanded: true, editing: false, error: "" });
  controller.props().onGoalToggle();
  assert.deepEqual({ ...controller.goalPanel }, { expanded: false, editing: false, error: "" });

  controller.props().onGoalToggle();
  controller.props().onGoalEdit();
  assert.deepEqual({ ...controller.goalPanel }, { expanded: true, editing: true, error: "" });
  controller.props().onGoalCancelEdit();
  assert.deepEqual({ ...controller.goalPanel }, { expanded: true, editing: false, error: "" }, "cancelling leaves the objective readable");

  controller.props().onGoalEdit();
  controller.props().onGoalSave("keep the release branch green");
  assert.equal(controller.sending, true);
  assert.deepEqual(fake.goals.map(({ id, action, objective }) => [id, action, objective]), [["s1", "start", "keep the release branch green"]]);
  fake.goals[0]?.reject(new Error("Finish or stop the active turn before starting a goal."));
  await settle();
  assert.equal(controller.sending, false);
  assert.deepEqual({ ...controller.goalPanel }, { expanded: true, editing: true, error: "Finish or stop the active turn before starting a goal." });
  assert.deepEqual(notes, ["info:"], "the refusal stays in the editor instead of a floating note");

  controller.props().onGoalSave("keep the release branch green");
  fake.goals[1]?.resolve();
  await settle();
  assert.deepEqual({ ...controller.goalPanel }, { expanded: false, editing: false, error: "" });
  assert.deepEqual(notes.at(-1), "info:Goal set. The agent keeps working until it is achieved or you pause it.");

  controller.props().onGoalEdit();
  controller.props().onGoalSave("   ");
  assert.equal(fake.goals.length, 2, "an empty objective never reaches the gateway");
  assert.equal(controller.goalPanel.error, "A goal needs an objective.");
});

test("switching sessions closes the goal pill's detail", () => {
  const selected = { current: { id: "s1", status: "idle", goal: { objective: "ship it", status: "active", createdAt: "2026-10-28T09:00:00.000Z", updatedAt: "2026-10-28T09:00:00.000Z", continuations: 0 } } as SessionView };
  const { controller } = composer(selected);
  controller.switchDraft(sessionDraftKey("s1"));
  controller.props().onGoalToggle();
  assert.equal(controller.goalPanel.expanded, true);
  controller.switchDraft(sessionDraftKey("s2"));
  assert.deepEqual({ ...controller.goalPanel }, { expanded: false, editing: false, error: "" });
});
