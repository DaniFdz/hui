import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { Attachment, QueueSnapshot, RuntimeCommand, SessionConnection, SessionSnapshot, SessionView } from "../api/sessions.ts";
import { MAX_UPLOAD_FILE_BYTES } from "../api/files.ts";
import { MAX_ATTACHMENT_BYTES, MAX_FILES_PANE_BYTES } from "../lib/attachments.ts";
import type { ComposerDraft } from "../lib/composer/drafts.ts";
import { NEW_SESSION_DRAFT_KEY, sessionDraftKey } from "../lib/composer/drafts.ts";
import { clearSideChat, sideChatFor } from "../lib/session/side-chat-store.ts";
import type { ComposerControl, ComposerEditor } from "../lib/composer/rich/editor.ts";
import { ComposerController } from "./composer-controller.ts";
import { ConversationController } from "./conversation-controller.ts";

/**
 * A stand-in for the mounted rich editor over one plain string: the controller only ever reads and writes its control,
 * so a draft, a caret and a focus counter are the whole surface a completion needs.
 */
function fakeEditor(initial = "", onFocus?: () => void) {
  const state = { value: initial, start: initial.length, end: initial.length, focused: 0 };
  let changed: ((markdown: string) => void) | undefined;
  const control: ComposerControl = {
    markdown: () => state.value,
    text: () => state.value,
    selection: () => ({ start: state.start, end: state.end }),
    replaceRange: (from, to, insert, caret) => {
      state.value = `${state.value.slice(0, from)}${insert}${state.value.slice(to)}`;
      state.start = caret;
      state.end = caret;
      changed?.(state.value);
    },
    focus: () => {
      state.focused += 1;
      onFocus?.();
    },
    caretAtEnd: () => {
      state.start = state.value.length;
      state.end = state.value.length;
    },
    editable: () => true,
    isTarget: () => true,
  };
  const editor: ComposerEditor = {
    control,
    update: () => {},
    setMarkdown: (source) => {
      state.value = source;
      state.start = source.length;
      state.end = source.length;
    },
    focus: () => control.focus(),
    caretAtEnd: () => control.caretAtEnd(),
    destroy: () => {},
  };
  return { editor, state, onChange: (handler: (markdown: string) => void) => { changed = handler; } };
}

const fake = vi.hoisted(() => ({
  mutations: [] as { id: string; mutation: unknown; resolve: () => void; reject: (error: Error) => void }[],
  goals: [] as { id: string; action: string; objective?: string; resolve: () => void; reject: (error: Error) => void }[],
  progressRequests: [] as { id: string; resolve: () => void; reject: (error: unknown) => void }[],
  drafts: new Map<string, ComposerDraft>(),
  draftWrites: [] as { key: string; text: string }[],
  pathRequests: [] as { cwd: string; input: string }[],
  commandRequests: [] as { id: string; resolve: (commands: RuntimeCommand[]) => void; reject: (error: Error) => void }[],
  prompts: [] as { id: string; text: string; attachments: readonly Attachment[]; resolve: () => void; reject: (error: Error) => void }[],
  rewinds: [] as unknown[][],
  aborts: [] as string[],
  steerNows: [] as { id: string; resolve: () => void; reject: (error: Error) => void }[],
  sideQuestions: [] as { id: string; question: string; resolve: (result: { question: string; answer: string; model: string }) => void; reject: (error: Error) => void }[],
}));
vi.mock("../api/sessions.ts", () => ({
  recomputeSessionProgress: (id: string) => new Promise<void>((resolve, reject) => fake.progressRequests.push({ id, resolve, reject })),
  loadCommands: (id: string) => new Promise<RuntimeCommand[]>((resolve, reject) => fake.commandRequests.push({ id, resolve, reject })),
  mutateQueuedMessage: (id: string, mutation: unknown) => new Promise<void>((resolve, reject) => fake.mutations.push({ id, mutation, resolve, reject })),
  sendQueuedSteersNow: (id: string) => new Promise<void>((resolve, reject) => fake.steerNows.push({ id, resolve, reject })),
  sendPrompt: (id: string, text: string, attachments: readonly Attachment[] = []) => new Promise((resolve, reject) => fake.prompts.push({ id, text, attachments, resolve: () => resolve({ duplicate: false }), reject })),
  askSideQuestion: (id: string, question: string) => new Promise((resolve, reject) => fake.sideQuestions.push({ id, question, resolve, reject })),
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
  writeComposerDraft: async (key: string, draft: ComposerDraft) => { fake.drafts.set(key, draft); fake.draftWrites.push({ key, text: draft.text }); return "persisted"; },
  listComposerDraftSessionIds: async () => [],
}));

beforeEach(() => {
  fake.mutations = [];
  fake.goals = [];
  fake.progressRequests = [];
  fake.drafts = new Map();
  fake.draftWrites = [];
  fake.pathRequests = [];
  fake.commandRequests = [];
  fake.prompts = [];
  fake.rewinds = [];
  fake.aborts = [];
  fake.steerNows = [];
  fake.sideQuestions = [];
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A key as the rich editor hands it to the menus: the surface's own, with the preventions it recorded. */
function pressKey(key: string) {
  const prevented: string[] = [];
  const event = {
    key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, target: null,
    defaultPrevented: false,
    preventDefault: () => prevented.push("default"),
    stopPropagation: () => prevented.push("propagation"),
  } as unknown as KeyboardEvent;
  return { event, prevented };
}

function composer(selected: { current: SessionView | undefined }, options: { embeddedPane?: boolean; streaming?: boolean; editor?: ComposerEditor; connection?: SessionConnection; launching?: boolean; conversation?: ConversationController } = {}) {
  const notes: string[] = [];
  const reported: string[] = [];
  let updates = 0;
  const host = { addController: () => {}, removeController: () => {}, requestUpdate: () => { updates += 1; }, updateComplete: Promise.resolve(true), renderRoot: { querySelector: () => null } as unknown as HTMLElement };
  const stand = {
    get selected() { return selected.current; },
    opening: false,
    connection: options.connection ?? "live",
    stopping: false,
    streaming: options.streaming ?? false,
    transcript: [],
    // The lock half of the controller's port; `conversation-controller.test.ts` proves what the clock does with it.
    setStreaming(next: boolean) { stand.streaming = next; },
  };
  const conversation = options.conversation ?? stand as unknown as ConversationController;
  const controller = new ComposerController(host, {
    conversation,
    showNote: (message, level) => notes.push(`${level}:${message}`),
    embeddedPane: () => options.embeddedPane ?? false,
    draftChanged: (sessionId, hasDraft) => reported.push(`${sessionId}:${hasDraft}`),
    composerSession: () => selected.current,
    draftCommands: () => [],
    defaultCwd: () => "~/default",
    mentionable: () => [],
    editor: () => options.editor ?? null,
    handleUpdateCommand: () => false,
    launching: () => options.launching ?? false,
  });
  return { controller, conversation, notes, reported, updates: () => updates };
}

test("progress recompute is single-flight for idle and running sessions and waits for confirmed completion", async () => {
  const selected = { current: { id: "s1", status: "idle" } as SessionView };
  const { controller, notes, updates } = composer(selected);
  assert.deepEqual(controller.props().progressRefresh, { pending: false, error: undefined });
  controller.props().onRecomputeProgress();
  controller.props().onRecomputeProgress();
  assert.equal(fake.progressRequests.length, 1);
  assert.equal(fake.progressRequests[0]?.id, "s1");
  assert.deepEqual(controller.props().progressRefresh, { pending: true, error: undefined });
  assert.equal(controller.sending, false, "refresh does not send a turn or block the composer");
  const beforeCompletion = updates();
  fake.progressRequests[0]?.resolve();
  await settle();
  assert.deepEqual(controller.props().progressRefresh, { pending: false, error: undefined });
  assert.ok(updates() > beforeCompletion);
  selected.current = { ...selected.current, status: "running" };
  controller.props().onRecomputeProgress();
  assert.equal(fake.progressRequests.length, 2, "an active turn allows recompute too");
  fake.progressRequests[1]?.resolve();
  await settle();
  assert.deepEqual(notes, []);
  assert.deepEqual(fake.prompts, []);
});

test("progress recompute requires a selected live, opened idle or running session", () => {
  const selected: { current: SessionView | undefined } = { current: undefined };
  const { controller, conversation } = composer(selected);
  controller.props().onRecomputeProgress();
  selected.current = { id: "s1", status: "idle" } as SessionView;
  for (const connection of ["reconnecting", "stopped", "saved", "outdated"] as const) {
    conversation.connection = connection;
    controller.props().onRecomputeProgress();
  }
  conversation.connection = "live";
  conversation.opening = true;
  controller.props().onRecomputeProgress();
  conversation.opening = false;
  for (const status of ["waiting", "starting", "error", "reconnecting", "disconnected"] as const) {
    selected.current = { ...selected.current, status };
    controller.props().onRecomputeProgress();
  }
  assert.deepEqual(fake.progressRequests, []);
  assert.deepEqual(controller.props().progressRefresh, { pending: false, error: undefined });
});

test("progress recompute shows a failure inline, clears it on retry and on session reset", async () => {
  const { controller, notes } = composer({ current: { id: "s1", status: "idle" } as SessionView });
  controller.props().onRecomputeProgress();
  fake.progressRequests[0]?.reject(new Error("The utility model is unavailable."));
  await settle();
  assert.deepEqual(controller.props().progressRefresh, { pending: false, error: "The utility model is unavailable." });
  controller.props().onRecomputeProgress();
  assert.deepEqual(controller.props().progressRefresh, { pending: true, error: undefined });
  fake.progressRequests[1]?.reject("unexpected refusal");
  await settle();
  assert.deepEqual(controller.props().progressRefresh, { pending: false, error: "Could not recompute progress." });
  controller.resetSession();
  assert.deepEqual(controller.props().progressRefresh, { pending: false, error: undefined });
  assert.deepEqual(notes, [], "the failure belongs to the progress panel");
});

test("switching drafts clears progress state and stale completions cannot settle a newer request", async () => {
  const selected = { current: { id: "s1", status: "idle" } as SessionView };
  const { controller } = composer(selected);
  controller.switchDraft(sessionDraftKey("s1"));
  controller.props().onRecomputeProgress();
  selected.current = { id: "s2", status: "running" } as SessionView;
  controller.switchDraft(sessionDraftKey("s2"));
  assert.deepEqual(controller.props().progressRefresh, { pending: false, error: undefined });
  selected.current = { id: "s1", status: "idle" } as SessionView;
  controller.switchDraft(sessionDraftKey("s1"));
  controller.props().onRecomputeProgress();
  fake.progressRequests[0]?.reject(new Error("Old failure"));
  await settle();
  assert.deepEqual(controller.props().progressRefresh, { pending: true, error: undefined });
  controller.resetSession();
  controller.props().onRecomputeProgress();
  fake.progressRequests[1]?.resolve();
  await settle();
  assert.deepEqual(controller.props().progressRefresh, { pending: true, error: undefined });
  fake.progressRequests[2]?.reject(new Error("New failure"));
  await settle();
  assert.equal(controller.props().progressRefresh.error, "New failure");
  controller.switchDraft(NEW_SESSION_DRAFT_KEY);
  assert.deepEqual(controller.props().progressRefresh, { pending: false, error: undefined });
});

test("/btw asks the utility model and leaves the answer in the side chat, not the transcript", async () => {
  const { controller, notes } = composer({ current: { id: "s1" } as SessionView });
  controller.sending = false;
  controller.send("/btw which file are we editing?");
  assert.deepEqual(sideChatFor("s1"), {
    question: "which file are we editing?", answer: "", model: "", loading: true, error: "",
  });
  assert.deepEqual(fake.prompts, [], "the question never becomes a prompt");
  assert.equal(controller.sending, false, "the composer is free again while the answer comes");
  assert.equal(controller.draft, "");

  fake.sideQuestions[0]?.resolve({ question: "which file are we editing?", answer: "`src/views/home.ts`", model: "utility-fixture" });
  await settle();
  assert.equal(sideChatFor("s1")?.answer, "`src/views/home.ts`");
  assert.equal(sideChatFor("s1")?.loading, false);
  assert.equal(sideChatFor("s1")?.model, "utility-fixture");

  controller.send("/btw and the branch?");
  fake.sideQuestions[1]?.reject(new Error("The utility model is unavailable."));
  await settle();
  assert.equal(sideChatFor("s1")?.error, "The utility model is unavailable.");
  assert.deepEqual(notes, []);

  clearSideChat("s1");
});

test("a bare /btw or one with attachments is refused before it asks anything", () => {
  const { controller, notes } = composer({ current: { id: "s1" } as SessionView });
  controller.send("/btw");
  controller.send("/btw what is in the screenshot?", [{ name: "shot.png", kind: "image", mimeType: "image/png", dataBase64: "" }]);
  assert.deepEqual(fake.sideQuestions, []);
  assert.deepEqual(notes, [
    "error:Add a question after /btw. Example: /btw which file are we editing?",
    "error:/btw does not support attachments in this build.",
  ]);
});

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

test("a share seeds the New Session draft ahead of what was already typed, and stores it once", async () => {
  fake.drafts.set(NEW_SESSION_DRAFT_KEY, { text: "typed", attachments: [] });
  const { controller } = composer({ current: undefined });
  const seed = "Look this post in X https://x.com/danifdz/status/1987654321098765432";
  controller.switchDraft(NEW_SESSION_DRAFT_KEY, seed);
  await settle();
  assert.equal(controller.draft, `${seed}\n\ntyped`, "the share sits above the operator's own draft");
  assert.deepEqual(controller.attachments, [], "a share carries no attachments");
  assert.deepEqual(fake.drafts.get(NEW_SESSION_DRAFT_KEY), { text: `${seed}\n\ntyped`, attachments: [] });
  assert.deepEqual(fake.draftWrites, [{ key: NEW_SESSION_DRAFT_KEY, text: `${seed}\n\ntyped` }], "one write stores both sides");
  assert.deepEqual(fake.prompts, [], "a share only fills the composer; the operator still presses Start session");
});

test("a share with no stored draft is the whole New Session draft", async () => {
  const { controller } = composer({ current: undefined });
  controller.switchDraft(NEW_SESSION_DRAFT_KEY, "Remember to water the plants");
  await settle();
  assert.equal(controller.draft, "Remember to water the plants");
  assert.deepEqual(fake.drafts.get(NEW_SESSION_DRAFT_KEY), { text: "Remember to water the plants", attachments: [] });
  assert.deepEqual(fake.prompts, []);
});

test("a share never reaches the launch draft an embedded pane may not own", async () => {
  fake.drafts.set(NEW_SESSION_DRAFT_KEY, { text: "launch text", attachments: [] });
  const { controller } = composer({ current: { id: "s1" } as SessionView }, { embeddedPane: true });
  controller.switchDraft(NEW_SESSION_DRAFT_KEY, "Look this post in X https://x.com/a/status/1");
  await settle();
  assert.equal(controller.draft, "");
  assert.deepEqual(fake.draftWrites, []);
  assert.deepEqual(fake.drafts.get(NEW_SESSION_DRAFT_KEY), { text: "launch text", attachments: [] });
  assert.deepEqual(fake.prompts, []);
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

test("typing renders only when the composer starts or stops holding text; a draft HUI sets is rendered once", () => {
  const { controller, updates } = composer({ current: undefined });
  const typed = controller.props().onDraftInput;
  const before = updates();
  typed("h");
  assert.equal(updates(), before + 1);
  typed("hi");
  assert.equal(updates(), before + 1);
  controller.setDraft("from HUI");
  assert.equal(updates(), before + 2, "a code-owned draft reaches the editor through the render it schedules");
});

test("retrying a failed command catalog restores a blurred query and focuses the editor before replacing Retry", async () => {
  const focus = vi.fn(() => {
    assert.equal(controller.commandsLoading, false, "focus returns before loading replaces Retry");
    assert.equal(fake.commandRequests.length, 1, "focus returns before the retry request starts");
  });
  const { editor } = fakeEditor("/", focus);
  const { controller } = composer({ current: { id: "s1", status: "idle" } as SessionView }, { editor });
  // WebKit can blur the editor without focusing the tapped Retry button.
  vi.stubGlobal("document", { activeElement: null });
  try {
    controller.setDraft("/");
    controller.props().onCommandQuery({ text: "", start: 0 });
    fake.commandRequests[0]?.reject(new Error("Could not load commands."));
    await settle();
    assert.equal(controller.commandsError, "Could not load commands.");
    assert.equal(focus.mock.calls.length, 0, "an initial catalogue request does not move focus");

    controller.props().onCommandQuery(null);
    controller.props().commandMenu.onRetry();
    assert.equal(focus.mock.calls.length, 1, "focus returns before loading removes the Retry button");
    assert.deepEqual(controller.slashQuery, { text: "", start: 0 });
    assert.equal(controller.props().commandMenu.open, true);
    assert.equal(controller.commandsLoading, true);
    assert.equal(fake.commandRequests.length, 2);

    fake.commandRequests[1]?.resolve([{ name: "check-status", description: "Check status", source: "extension" }]);
    await settle();
    assert.equal(controller.commandsLoading, false);
    assert.equal(controller.commandsError, "");
    assert.equal(controller.props().commandMenu.open, true);
    assert.ok(controller.props().commandMenu.commands.some(({ name }) => name === "check-status"));
    assert.equal(controller.draft, "/");
    assert.equal(focus.mock.calls.length, 1, "the reply never steals focus back after the operator moves away");
    assert.deepEqual(fake.prompts, []);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("enter takes nothing from the command menu while its catalog loads, and completes one once it arrives", async () => {
  const { editor, state, onChange } = fakeEditor("/");
  const { controller } = composer({ current: { id: "s1", status: "idle" } as SessionView }, { editor });
  onChange(controller.props().onDraftInput);
  // The menus ask whether the key's target is a Node; the node test env has none.
  vi.stubGlobal("Node", class Node {});
  try {
    controller.setDraft("/");
    controller.props().onCommandQuery({ text: "", start: 0 });
    assert.equal(controller.props().commandMenu.open, true);
    assert.equal(controller.props().commandMenu.loading, true);
    assert.deepEqual(controller.props().commandMenu.commands, [], "the menu lists no command before the catalog answers");

    const loading = pressKey("Enter");
    controller.props().onCommandKeydown(loading.event);
    assert.deepEqual(loading.prevented, ["default"], "Enter is answered here, so the editor never inserts a line break");
    assert.equal(state.value, "/", "and no command HUI knows without the catalog completes the draft");
    assert.equal(controller.draft, "/");
    assert.deepEqual(fake.prompts, [], "nothing is sent");

    fake.commandRequests[0]?.resolve([{ name: "check-status", description: "Check status", source: "extension" }]);
    await settle();

    const loaded = pressKey("Enter");
    controller.props().onCommandKeydown(loaded.event);
    assert.deepEqual(loaded.prevented, ["default"]);
    assert.equal(state.value, "/btw ", "the same Enter completes the first command of the answered catalog");
    assert.equal(controller.draft, "/btw ");
    assert.deepEqual(fake.prompts, []);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("an @ path query loads suggestions for the session's folder and a pick completes the draft", async () => {
  const { editor, onChange } = fakeEditor("open @sr");
  const { controller } = composer({ current: { id: "s1", cwd: "~/repo" } as SessionView }, { editor });
  onChange(controller.props().onDraftInput);
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

test("sending the queued steers now sends once and reports a refusal", async () => {
  const { controller, notes } = composer({ current: { id: "s1" } as SessionView });
  controller.props().onQueueSteerNow();
  assert.equal(controller.sending, true);
  controller.props().onQueueSteerNow();
  assert.deepEqual(fake.steerNows.map(({ id }) => id), ["s1"], "a second click sends nothing while the first is in flight");

  fake.steerNows[0]?.reject(new Error("nothing is steered"));
  await settle();
  assert.equal(controller.sending, false);
  assert.equal(notes.at(-1), "error:nothing is steered");
});

test("a send from the composer stamps the trail's clock, and a refused one clears it", async () => {
  // The real controller, so the clock the send stamps is the one the trail reads, not a stand-in's copy of the rule.
  const host = { addController: () => {}, removeController: () => {}, requestUpdate: () => {}, updateComplete: Promise.resolve(true), renderRoot: { querySelector: () => null } as unknown as HTMLElement };
  const conversationController = new ConversationController(host, {
    showError: () => {}, refreshSessions: async () => {}, paneCreating: () => false, paneCreationFailed: () => false,
    resetSession: () => {}, connectionLost: () => {}, adoptSnapshot: () => {}, adoptEvent: () => {},
    statusChanged: () => {}, flushLaunchPrompt: () => {},
  });
  conversationController.selected = { id: "s1", status: "idle" } as SessionView;
  const selected = { current: conversationController.selected };
  const { controller } = composer(selected, { conversation: conversationController });
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  controller.props().onDraftInput("ship it");
  controller.send("ship it");
  assert.equal(conversationController.streaming, true, "the composer lock follows the started turn");
  assert.equal(typeof conversationController.turnStartedAt, "number", "the held turn's trail can count from here");
  fake.prompts[0]?.reject(new Error("refused"));
  await settle();
  assert.equal(conversationController.streaming, false);
  assert.equal(conversationController.turnStartedAt, undefined, "a send that never started a turn leaves no clock behind");
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

/** A text file the picker stores: the payload carries its bytes and the runtime names its absolute path. */
const notesFile: Attachment = { name: "notes.txt", kind: "file", mimeType: "text/plain", dataBase64: "" };

test("a prompt holding only a file reaches the API and empty text with no attachment does not", async () => {
  const { controller, notes } = composer({ current: { id: "s1", status: "idle" } as SessionView });
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  controller.attachments = [notesFile];
  controller.send("", [notesFile]);
  assert.deepEqual(fake.prompts.map(({ id, text, attachments }) => [id, text, attachments]), [["s1", "", [notesFile]]]);
  fake.prompts[0]?.resolve();
  await settle();
  assert.equal(controller.sending, false, "the acknowledgement frees the composer");
  assert.equal(controller.draft, "", "the sent prompt leaves no draft behind");
  assert.deepEqual(controller.attachments, [], "the file leaves the composer with the prompt");

  controller.props().onDraftInput("half typed");
  controller.send("");
  await settle();
  assert.equal(fake.prompts.length, 1, "empty text with nothing attached posts nothing");
  assert.equal(controller.draft, "half typed", "the newer draft is left alone");
  assert.deepEqual(notes, ["info:"], "the refused send shows no note");
});

test("a failed file-only send puts the file back in the composer", async () => {
  const { controller, notes } = composer({ current: { id: "s1", status: "idle" } as SessionView });
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  controller.attachments = [notesFile];
  controller.send("", [notesFile]);
  assert.deepEqual(fake.prompts.map(({ text, attachments }) => [text, attachments]), [["", [notesFile]]]);

  fake.prompts[0]?.reject(new Error("refused"));
  await settle();
  assert.equal(controller.sending, false);
  assert.deepEqual(controller.attachments, [notesFile], "the file comes back to the composer");
  assert.deepEqual(fake.drafts.get(sessionDraftKey("s1")), { text: "", attachments: [notesFile] }, "the refused prompt waits on its own session's draft");
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
  const { editor, state } = fakeEditor();
  const { controller, notes } = composer({ current: { id: "s1" } as SessionView }, { streaming: true, editor });
  const target = { entryId: "e1" } as unknown as Parameters<ReturnType<ComposerController["props"]>["onRewind"]>[0];
  controller.props().onRewind(target, "try again", ["notes.txt"]);
  assert.equal(controller.rewindPending, true);
  await settle();
  assert.deepEqual(fake.rewinds, [["s1", target, true]]);
  assert.equal(controller.draft, "try again");
  assert.deepEqual(controller.attachments.map(({ name }) => name), ["notes.txt"]);
  assert.equal(state.focused, 1);
  assert.deepEqual([state.start, state.end], [9, 9]);
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

test("the goal editor keeps a refused objective where it was typed", async () => {
  const goal = { objective: "get CI green on PR 1", status: "active", createdAt: "2026-10-28T09:00:00.000Z", updatedAt: "2026-10-28T09:00:00.000Z", continuations: 0 };
  const { controller, notes } = composer({ current: { id: "s1", status: "idle", goal } as SessionView });
  const props = controller.props();
  assert.deepEqual({ ...props.goalPanel }, { editing: false, error: "" });

  controller.props().onGoalEdit();
  assert.deepEqual({ ...controller.goalPanel }, { editing: true, error: "" });
  controller.props().onGoalCancelEdit();
  assert.deepEqual({ ...controller.goalPanel }, { editing: false, error: "" }, "cancelling closes the editor");

  controller.props().onGoalEdit();
  controller.props().onGoalSave("keep the release branch green");
  assert.equal(controller.sending, true);
  assert.deepEqual(fake.goals.map(({ id, action, objective }) => [id, action, objective]), [["s1", "start", "keep the release branch green"]]);
  fake.goals[0]?.reject(new Error("Finish or stop the active turn before starting a goal."));
  await settle();
  assert.equal(controller.sending, false);
  assert.deepEqual({ ...controller.goalPanel }, { editing: true, error: "Finish or stop the active turn before starting a goal." });
  assert.deepEqual(notes, ["info:"], "the refusal stays in the editor instead of a floating note");

  controller.props().onGoalSave("keep the release branch green");
  fake.goals[1]?.resolve();
  await settle();
  assert.deepEqual({ ...controller.goalPanel }, { editing: false, error: "" });
  assert.deepEqual(notes.at(-1), "info:Goal set. The agent keeps working until it is achieved or you pause it.");

  controller.props().onGoalEdit();
  controller.props().onGoalSave("   ");
  assert.equal(fake.goals.length, 2, "an empty objective never reaches the gateway");
  assert.equal(controller.goalPanel.error, "A goal needs an objective.");
});

test("switching sessions closes the goal editor", () => {
  const selected = { current: { id: "s1", status: "idle", goal: { objective: "ship it", status: "active", createdAt: "2026-10-28T09:00:00.000Z", updatedAt: "2026-10-28T09:00:00.000Z", continuations: 0 } } as SessionView };
  const { controller } = composer(selected);
  controller.switchDraft(sessionDraftKey("s1"));
  controller.props().onGoalEdit();
  assert.equal(controller.goalPanel.editing, true);
  controller.switchDraft(sessionDraftKey("s2"));
  assert.deepEqual({ ...controller.goalPanel }, { editing: false, error: "" });
});

/** A file the picker refuses by size. `arrayBuffer` reports if the refusal ever reaches it. */
const oversizeFile = (name: string, size: number, onRead?: () => void): File => ({
  name,
  size,
  type: "application/octet-stream",
  arrayBuffer: async () => {
    onRead?.();
    return new ArrayBuffer(0);
  },
} as unknown as File);

/** `count` MiB of base64, so the composer's own size checks see exactly that many bytes. */
const megabytes = (count: number, name: string): Attachment => ({
  kind: "file",
  name,
  mimeType: "application/octet-stream",
  dataBase64: "A".repeat((count * 1024 * 1024 * 4) / 3),
});

test("the Files-pane cap a size refusal names is the client's real upload cap", () => {
  // `src/lib/` may not read a value from `src/api/` (R6 in docs/map.md), so `MAX_FILES_PANE_BYTES` mirrors
  // `MAX_UPLOAD_FILE_BYTES`; the mirror is held to the real cap wherever the two can meet.
  assert.equal(MAX_FILES_PANE_BYTES, MAX_UPLOAD_FILE_BYTES);
});

test("an oversize pick stays out of the composer, is never read and says where the file fits", async () => {
  const { controller, notes } = composer({ current: { id: "s1", status: "idle" } as SessionView });
  let read = false;
  controller.props().onAddAttachments([oversizeFile("clip.mov", MAX_ATTACHMENT_BYTES + 1, () => { read = true; })]);
  await settle();
  assert.deepEqual(notes, ["error:clip.mov is larger than 12 MB. Larger files can go in the Files pane, which takes up to 2 GB each."]);
  assert.equal(controller.attachments.length, 0, "the refused file never enters the composer");
  assert.equal(read, false, "the refusal comes before the file is read into memory");
  assert.deepEqual(fake.draftWrites, [], "nothing is stored");
  assert.deepEqual(fake.prompts, [], "nothing is posted");
});

test("a remote conversation is told the limit alone, since its Files pane would refuse it", async () => {
  // The harness reads the session the composer shows, so a worker on it is the whole "remote" this test needs.
  const selected = { current: { id: "s1", status: "idle", worker: { id: "w1", name: "build box" } } as SessionView };
  const { controller, notes } = composer(selected);
  controller.props().onAddAttachments([oversizeFile("clip.mov", MAX_ATTACHMENT_BYTES + 1)]);
  await settle();
  assert.deepEqual(notes, ["error:clip.mov is larger than 12 MB."], "the limit alone: that conversation has no Files pane");
  assert.equal(controller.attachments.length, 0, "the refused file never enters the composer");

  // The same conversation's send refuses a restored set with the limit alone too.
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  const restored = [megabytes(9, "a.bin"), megabytes(9, "b.bin")];
  controller.attachments = restored;
  controller.send("send these", restored);
  await settle();
  assert.deepEqual(fake.prompts, [], "no request is built");
  assert.deepEqual(notes.at(-1), "error:Attachments must be 16 MB or less in total.");
  assert.ok(!notes.some((note) => note.includes("Files pane")), "no refusal points at a pane that is not there");

  // A new session is on this gateway's disk, so its composer keeps the way out.
  const fresh = composer({ current: undefined });
  fresh.controller.props().onAddAttachments([oversizeFile("clip.mov", MAX_ATTACHMENT_BYTES + 1)]);
  await settle();
  assert.deepEqual(fresh.notes, ["error:clip.mov is larger than 12 MB. Larger files can go in the Files pane, which takes up to 2 GB each."]);
});

test("a pick while a send or a session start is in flight says so instead of vanishing", async () => {
  const sending = composer({ current: { id: "s1", status: "idle" } as SessionView });
  sending.controller.sending = true;
  sending.controller.props().onAddAttachments([new File(["hi"], "notes.txt", { type: "text/plain" })]);
  await settle();
  assert.deepEqual(sending.notes, ["error:Wait for this message to be sent before adding attachments."]);
  assert.equal(sending.controller.attachments.length, 0);

  const launching = composer({ current: { id: "s1", status: "starting" } as SessionView }, { launching: true });
  launching.controller.props().onAddAttachments([new File(["hi"], "notes.txt", { type: "text/plain" })]);
  await settle();
  assert.deepEqual(launching.notes, ["error:Wait for the session to start before adding attachments."]);
  assert.equal(launching.controller.attachments.length, 0);
  assert.deepEqual(fake.draftWrites, [], "neither pick is stored");
});

test("a send holding restored oversize attachments posts nothing and reports the refusal once", async () => {
  const { controller, notes } = composer({ current: { id: "s1", status: "idle" } as SessionView });
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  controller.setDraft("send these");
  // A draft stored before the limits, or a launch prompt: the picker never saw this set, so the send is what refuses it.
  const restored = [megabytes(9, "a.bin"), megabytes(9, "b.bin")];
  controller.attachments = restored;
  controller.send("send these", restored);
  await settle();
  assert.deepEqual(fake.prompts, [], "no request is built");
  assert.deepEqual(notes, ["error:Attachments must be 16 MB or less in total. Larger files can go in the Files pane, which takes up to 2 GB each."]);
  assert.equal(controller.sending, false, "the composer stays free");
  assert.equal(controller.draft, "send these", "the draft is not taken from the operator");
  assert.deepEqual(controller.attachments, restored, "the files stay, merged in once and never duplicated");
});

test("a launch prompt the size check refuses comes back to the composer with its files", async () => {
  const { controller, notes } = composer({ current: { id: "s1", status: "idle" } as SessionView });
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  const restored = [megabytes(9, "a.bin"), megabytes(9, "b.bin")];
  controller.pendingLaunchPrompt = "first";
  controller.pendingLaunchAttachments = restored;
  controller.flushLaunchPrompt();
  await settle();
  assert.deepEqual(fake.prompts, [], "no request is built");
  assert.deepEqual(notes, ["error:Attachments must be 16 MB or less in total. Larger files can go in the Files pane, which takes up to 2 GB each."]);
  assert.equal(controller.draft, "first", "the launch prompt is not lost");
  assert.deepEqual(controller.attachments.map(({ name }) => name), ["a.bin", "b.bin"]);
  assert.equal(fake.drafts.get(sessionDraftKey("s1"))?.text, "first", "the restored draft is stored");
});

test("a pick that fails after the composer moved to another draft still reports it", async () => {
  const { controller, notes } = composer({ current: { id: "s1", status: "idle" } as SessionView });
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  controller.props().onAddAttachments([oversizeFile("clip.mov", MAX_ATTACHMENT_BYTES + 1)]);
  // The operator picked this file: a switch that lands while it is read does not make the failure invisible.
  controller.switchDraft(sessionDraftKey("s2"));
  await settle();
  assert.deepEqual(notes, ["error:clip.mov is larger than 12 MB. Larger files can go in the Files pane, which takes up to 2 GB each."]);
  assert.equal(controller.attachments.length, 0);
});

const REFUSED_TOTAL = "error:Attachments must be 16 MB or less in total. Larger files can go in the Files pane, which takes up to 2 GB each.";

/** Queues a launch prompt the size check refuses, with the files that are too large for one message. */
function refusedLaunch(controller: ComposerController): readonly Attachment[] {
  const files = [megabytes(9, "a.bin"), megabytes(9, "b.bin")];
  controller.pendingLaunchPrompt = "first";
  controller.pendingLaunchAttachments = files;
  controller.flushLaunchPrompt();
  return files;
}

test("typing while a refused launch prompt is recovered keeps the typed text", async () => {
  const { controller, notes } = composer({ current: { id: "s1", status: "idle" } as SessionView });
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  refusedLaunch(controller);
  // The operator goes on typing in the gap between the refusal and the recovered draft landing: what they type is
  // newer than the recovery, so it is what the composer keeps.
  controller.props().onDraftInput("first and then this");
  await settle();
  assert.deepEqual(notes, [REFUSED_TOTAL], "the refusal is reported once");
  assert.equal(controller.draft, "first and then this", "the recovery never overwrites what was typed after it");
  assert.deepEqual(controller.attachments.map(({ name }) => name), ["a.bin", "b.bin"], "the refused files come back once");
  assert.equal(fake.drafts.get(sessionDraftKey("s1"))?.text, "first and then this", "the newest draft is the stored one");
});

test("switching sessions while a refused launch prompt is recovered keeps it out of the new one", async () => {
  const selected = { current: { id: "s1", status: "idle" } as SessionView };
  const { controller, notes } = composer(selected);
  controller.switchDraft(sessionDraftKey("s1"));
  await settle();
  const files = refusedLaunch(controller);
  // The operator opens another conversation in the gap between the refusal and the recovered draft landing.
  selected.current = { id: "s2", status: "idle" } as SessionView;
  controller.switchDraft(sessionDraftKey("s2"));
  await settle();
  assert.deepEqual(notes, [REFUSED_TOTAL], "the refusal is reported once");
  assert.equal(controller.draft, "", "the second conversation's composer is left alone");
  assert.deepEqual(controller.attachments, [], "the refused files never land in the second conversation");
  assert.deepEqual(fake.drafts.get(sessionDraftKey("s1")), { text: "first", attachments: files }, "the refused prompt waits on its own session's draft");
});
