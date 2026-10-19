import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { BacklogItem } from "../api/backlog.ts";
import type { SessionView } from "../api/sessions.ts";
import { BacklogController } from "./backlog-controller.ts";

const fake = vi.hoisted(() => ({
  calls: [] as { call: string; answer: (outcome: unknown) => void }[],
}));

const pending = (call: string) => new Promise((resolve, reject) => {
  fake.calls.push({ call, answer: (outcome) => outcome instanceof Error ? reject(outcome) : resolve(outcome) });
});

vi.mock("../api/backlog.ts", () => ({
  loadBacklog: (refresh: boolean) => pending(refresh ? "load (refresh)" : "load"),
  setBacklogItemGroup: (id: string, group: string) => pending(`group ${id} ${group}`),
  removeBacklogItem: (id: string) => pending(`remove ${id}`),
}));
vi.mock("../components/backlog-start-dialog.ts", () => ({}));

beforeEach(() => { fake.calls = []; });

const FIX: BacklogItem = { id: "fix", title: "Fix the toast" } as BacklogItem;
const DOCS: BacklogItem = { id: "docs", title: "Write docs" } as BacklogItem;
const view = (...items: BacklogItem[]) => ({ items, jira: { status: "unconfigured" } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const notes: string[] = [];
  let sessionRefreshes = 0;
  const host = { updates: 0, addController: () => {}, removeController: () => {}, requestUpdate() { this.updates += 1; }, updateComplete: Promise.resolve(true) };
  const backlog = new BacklogController(host, {
    notify: (message, failed) => notes.push(failed ? `error: ${message}` : message),
    refreshSessions: () => { sessionRefreshes += 1; },
  });
  return { backlog, host, notes, sessionRefreshes: () => sessionRefreshes };
}

test("only the latest read fills the column; a failed read shows its error", async () => {
  const { backlog } = setup();
  const first = backlog.refresh();
  const second = backlog.refresh(true);
  assert.equal(backlog.loading, true);
  fake.calls[1]!.answer(view(FIX));
  fake.calls[0]!.answer(view(DOCS));
  await Promise.all([first, second]);
  assert.deepEqual(backlog.items, [FIX], "the older read arriving later is dropped");
  assert.equal(backlog.loading, false);
  void backlog.refresh();
  fake.calls[2]!.answer(new Error("Jira is down"));
  await settle();
  assert.equal(backlog.error, "Jira is down");
  assert.deepEqual(backlog.items, [FIX]);
});

test("moving a task waits for the server, one task at a time, and not to its own group", async () => {
  const { backlog, notes } = setup();
  backlog.setGroup({ ...FIX, group: "ungrouped" }, "");
  assert.equal(fake.calls.length, 0);
  backlog.setGroup(FIX, "web");
  backlog.setGroup(DOCS, "web");
  assert.deepEqual(fake.calls.map(({ call }) => call), ["group fix web"]);
  assert.equal(backlog.pendingId, "fix");
  fake.calls[0]!.answer(view({ ...FIX, group: "web" }));
  await settle();
  assert.equal(backlog.pendingId, "");
  assert.equal(backlog.items[0]?.group, "web");
  assert.deepEqual(notes, ["Moving Fix the toast to WEB…", "Moved Fix the toast to WEB."]);
});

test("a started task leaves the column at once and both lists are read again", async () => {
  const { backlog, notes, sessionRefreshes } = setup();
  void backlog.refresh();
  fake.calls[0]!.answer(view(FIX, DOCS));
  await settle();
  backlog.openStart(FIX, { stage: "testing", group: "" });
  await settle();
  assert.equal(backlog.starting?.item, FIX);
  backlog.started({ title: "Fix the toast", stage: "testing" } as SessionView, FIX);
  assert.equal(backlog.starting, undefined);
  assert.deepEqual(backlog.items, [DOCS]);
  assert.equal(sessionRefreshes(), 1);
  assert.equal(fake.calls.at(-1)?.call, "load");
  assert.deepEqual(notes, ["Started “Fix the toast” from the backlog in Testing."]);
});

test("removing asks first, can't be cancelled while it runs, and closes either way", async () => {
  const { backlog, notes } = setup();
  const submit = { preventDefault: () => {} } as Event;
  backlog.askRemove(FIX);
  backlog.cancelRemove();
  assert.equal(backlog.removing, undefined);
  backlog.askRemove(FIX);
  backlog.confirmRemove(submit);
  backlog.cancelRemove();
  assert.equal(backlog.removing, FIX, "Cancel waits for the removal under way");
  fake.calls[0]!.answer(view(DOCS));
  await settle();
  assert.equal(backlog.removing, undefined);
  assert.deepEqual(backlog.items, [DOCS]);
  backlog.askRemove(DOCS);
  backlog.confirmRemove(submit);
  fake.calls[1]!.answer(new Error("gone"));
  await settle();
  assert.equal(backlog.removing, undefined);
  assert.equal(backlog.pendingId, "");
  assert.deepEqual(notes, ["Removed “Fix the toast” from the backlog.", "error: gone"]);
});
