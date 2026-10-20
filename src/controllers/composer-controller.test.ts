import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { QueueSnapshot, SessionSnapshot, SessionView } from "../api/sessions.ts";
import { ComposerController } from "./composer-controller.ts";

const fake = vi.hoisted(() => ({
  mutations: [] as { id: string; mutation: unknown; resolve: () => void; reject: (error: Error) => void }[],
}));
vi.mock("../api/sessions.ts", () => ({
  mutateQueuedMessage: (id: string, mutation: unknown) => new Promise<void>((resolve, reject) => fake.mutations.push({ id, mutation, resolve, reject })),
}));

beforeEach(() => {
  fake.mutations = [];
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function composer(selected: { current: SessionView | undefined }) {
  const notes: string[] = [];
  let updates = 0;
  const host = { addController: () => {}, removeController: () => {}, requestUpdate: () => { updates += 1; }, updateComplete: Promise.resolve(true) };
  const controller = new ComposerController(host, {
    selected: () => selected.current,
    showNote: (message, level) => notes.push(`${level}:${message}`),
  });
  return { controller, notes, updates: () => updates };
}

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
