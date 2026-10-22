import assert from "node:assert/strict";
import { test } from "vitest";
import type { DesktopNotification, NotificationChat } from "../agent-tools/notifications.ts";
import { DEFAULT_SETTINGS } from "../hui-settings.ts";
import { readObservability } from "../observability.ts";
import { waitFor } from "../test-support/wait-for.ts";
import type { HuiQuestion, RunEnd, SessionStatusUpdate, SubagentTaskView } from "./live-sessions.ts";
import { watchSessionNotifications, type NotificationTarget } from "./session-notifications.ts";

function notifier(options: {
  settings?: Partial<typeof DEFAULT_SETTINGS.notifications>;
  chats?: Record<string, Partial<NotificationTarget>>;
  initial?: SessionStatusUpdate[];
  deliver?: (chat: NotificationChat, notification: DesktopNotification) => Promise<unknown>;
} = {}) {
  let onStatus!: (update: SessionStatusUpdate) => void;
  let onRunEnd!: (end: RunEnd) => void;
  const questions = new Map<string, { title: string }[]>();
  const subagents = new Map<string, { status: SubagentTaskView["status"] }[]>();
  const sent: (DesktopNotification & { chat: string })[] = [];
  watchSessionNotifications({
    sessions: {
      watchStatuses: (listener) => { onStatus = listener; return { statuses: options.initial ?? [], unsubscribe: () => {} }; },
      watchRunEnds: (listener) => { onRunEnd = listener; },
      questions: (id) => (questions.get(id) ?? []) as HuiQuestion[],
      subagents: (id) => (subagents.get(id) ?? []) as SubagentTaskView[],
    },
    settings: async () => ({ ...DEFAULT_SETTINGS.notifications, ...options.settings }),
    chat: async (id) => {
      if (id === "unreadable") throw new Error("The session registry could not be read.");
      return id === "gone" ? undefined : { id, title: `Chat ${id}`, subagent: false, ...options.chats?.[id] };
    },
    deliver: options.deliver ?? (async (chat, notification) => { sent.push({ chat: chat.bot ?? chat.id, ...notification }); }),
  });
  return { sent, questions, subagents, status: (id: string, status: SessionStatusUpdate["status"]) => onStatus({ id, status }), end: (end: RunEnd) => onRunEnd(end) };
}

test("a finished or failed run the operator started notifies silently, as each setting allows", async () => {
  const off = notifier();
  off.end({ id: "a", failed: false, prompt: "fix the tests" });
  off.end({ id: "b", failed: true, prompt: "fix the tests" });
  await waitFor("the failed run's notification", () => off.sent.length === 1);
  assert.deepEqual(off.sent, [{ chat: "b", title: "Chat b", subtitle: "Run failed", priority: "low" }], "finished runs are opt-in");

  const on = notifier({ settings: { runFinished: true, runFailed: false }, chats: { pager: { bot: "bot-1", title: "Pager" } } });
  on.end({ id: "pager", failed: false, prompt: "check the deploy" });
  on.end({ id: "c", failed: true });
  await waitFor("the finished run's notification", () => on.sent.length === 1);
  assert.deepEqual(on.sent, [{ chat: "bot-1", title: "Pager", subtitle: "Finished", priority: "low" }], "failed runs are opt-out");
});

test("runs the operator didn't start, subagents and chats still waiting on subagents don't notify that they finished", async () => {
  const state = notifier({ settings: { runFinished: true }, chats: { child: { subagent: true } } });
  for (const prompt of ["[routine: Daily digest] summarize", "[trigger: PR merged · #7] check it", "[from @grace] done", "[from agent: Fix CI] here",
    "[Inter-session message from Fix CI (s1)]\nhello"]) {
    state.end({ id: "a", failed: false, prompt });
  }
  state.end({ id: "child", failed: false, prompt: "run the tests" });
  state.end({ id: "gone", failed: false, prompt: "run the tests" });
  state.subagents.set("parent", [{ status: "running" }]);
  state.end({ id: "parent", failed: false, prompt: "[HUI subagent completion event]\nchild 1 done" });
  state.end({ id: "parent", failed: true, prompt: "[HUI subagent completion event]\nchild 1 done" });
  state.end({ id: "last", failed: false, prompt: "[HUI subagent completion event]\nall done" });
  await waitFor("the two notifications that count", () => state.sent.length === 2);
  assert.deepEqual(state.sent.map(({ chat, subtitle }) => `${chat}: ${subtitle}`), ["parent: Run failed", "last: Finished"]);
});

test("a conversation that starts waiting notifies with its first question, once per wait", async () => {
  const state = notifier({ initial: [{ id: "already", status: "waiting" }] });
  state.questions.set("a", [{ title: "Deploy to staging?" }, { title: "And prod?" }]);
  state.status("already", "waiting");
  state.status("a", "running");
  state.status("a", "waiting");
  state.status("a", "waiting");
  state.status("a", "running");
  state.status("a", "waiting");
  state.status("b", "waiting");
  await waitFor("both waits and the question-less one", () => state.sent.length === 3);
  assert.deepEqual(state.sent, [
    { chat: "a", title: "Chat a", subtitle: "Needs your input", message: "Deploy to staging?", priority: "normal" },
    { chat: "a", title: "Chat a", subtitle: "Needs your input", message: "Deploy to staging?", priority: "normal" },
    { chat: "b", title: "Chat b", subtitle: "Needs your input", priority: "normal" },
  ]);
  const off = notifier({ settings: { needsInput: false } });
  off.status("a", "waiting");
  off.end({ id: "a", failed: true });
  await waitFor("the failed run, which needsInput doesn't turn off", () => off.sent.length === 1);
  assert.equal(off.sent[0]?.subtitle, "Run failed");
});

test("a notification HUI can't send or the desktop app can't show is recorded in diagnostics and nothing else fails", async () => {
  const state = notifier({ deliver: async () => { throw new Error("Install the current HUI desktop app with `hui install-app`."); } });
  state.status("unshown", "waiting");
  state.end({ id: "unreadable", failed: true, prompt: "fix the tests" });
  const skipped = async (id: string) => waitFor(`${id}'s skipped notification in diagnostics`, async () =>
    (await readObservability([])).logs.find((entry) => entry.sessionId === id && entry.action === "notification_skipped"));
  assert.match((await skipped("unshown")).detail ?? "", /hui install-app/u);
  assert.match((await skipped("unreadable")).detail ?? "", /registry could not be read/u);
});
