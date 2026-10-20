import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { QueueSnapshot, SessionSnapshot, SessionView } from "../api/sessions.ts";
import type { ComposerDraft } from "../lib/composer/drafts.ts";
import { NEW_SESSION_DRAFT_KEY, sessionDraftKey } from "../lib/composer/drafts.ts";
import { ComposerController } from "./composer-controller.ts";
import type { ConversationController } from "./conversation-controller.ts";

const fake = vi.hoisted(() => ({
  mutations: [] as { id: string; mutation: unknown; resolve: () => void; reject: (error: Error) => void }[],
  drafts: new Map<string, ComposerDraft>(),
  pathRequests: [] as { cwd: string; input: string }[],
}));
vi.mock("../api/sessions.ts", () => ({
  mutateQueuedMessage: (id: string, mutation: unknown) => new Promise<void>((resolve, reject) => fake.mutations.push({ id, mutation, resolve, reject })),
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
  fake.drafts = new Map();
  fake.pathRequests = [];
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function composer(selected: { current: SessionView | undefined }, options: { embeddedPane?: boolean } = {}) {
  const notes: string[] = [];
  const reported: string[] = [];
  let updates = 0;
  const host = { addController: () => {}, removeController: () => {}, requestUpdate: () => { updates += 1; }, updateComplete: Promise.resolve(true), renderRoot: { querySelector: () => null } as unknown as HTMLElement };
  const conversation = {
    get selected() { return selected.current; },
    opening: false,
    connection: "live",
    streaming: false,
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
    textarea: () => null,
    sending: () => false,
    launching: () => false,
  });
  return { controller, notes, reported, updates: () => updates };
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
