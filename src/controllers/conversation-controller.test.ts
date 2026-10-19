import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { SessionView } from "../api/sessions.ts";
import { ConversationController } from "./conversation-controller.ts";

const fake = vi.hoisted(() => ({
  modelRequests: [] as string[],
  modelsFail: false,
  thinking: [] as { id: string; level: string; resolve: (level: string) => void }[],
}));
vi.mock("../api/sessions.ts", () => ({
  loadModels: async (id: string) => {
    fake.modelRequests.push(id);
    if (fake.modelsFail) throw new Error("not booted");
    return [{ provider: "gw", id: "opus", name: "Opus" }];
  },
  setSessionThinking: (id: string, level: string) => new Promise((resolve) => fake.thinking.push({ id, level, resolve })),
}));

beforeEach(() => {
  fake.modelRequests = [];
  fake.modelsFail = false;
  fake.thinking = [];
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function conversation(state: { selected?: SessionView; streaming?: boolean } = {}) {
  const errors: string[] = [];
  let updates = 0;
  const host = { addController: () => {}, removeController: () => {}, requestUpdate: () => { updates += 1; }, updateComplete: Promise.resolve(true), renderRoot: { querySelector: () => null } as unknown as HTMLElement };
  const controller = new ConversationController(host, {
    selected: () => state.selected,
    streaming: () => state.streaming ?? false,
    showError: (message) => errors.push(message),
    refreshSessions: async () => {},
  });
  return { controller, errors, updates: () => updates };
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
  const state: { selected?: SessionView; streaming?: boolean } = { selected: { id: "s1" } as SessionView, streaming: true };
  const { controller } = conversation(state);
  controller.props().onSelectThinking("high");
  assert.equal(fake.thinking.length, 0);

  state.streaming = false;
  controller.props().onSelectThinking("high");
  fake.thinking[0]?.resolve("high");
  await settle();
  assert.equal(controller.props().thinking, "high");

  controller.props().onSelectThinking("low");
  state.selected = { id: "s2" } as SessionView;
  fake.thinking[1]?.resolve("low");
  await settle();
  assert.equal(controller.props().thinking, "high");
});
