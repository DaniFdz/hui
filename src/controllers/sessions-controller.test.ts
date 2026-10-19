import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { SessionGroup, SessionStatusUpdate, SessionView } from "../api/sessions.ts";
import { SessionsController } from "./sessions-controller.ts";

type Handlers = {
  onSnapshot: (updates: readonly SessionStatusUpdate[]) => void;
  onStatus: (update: SessionStatusUpdate) => void;
  onSessions: (update: { revision: number; groups?: { label: string; ids: string[] }[]; upserts: SessionView[] }) => void;
};
const fake = vi.hoisted(() => ({
  streams: [] as { handlers: Handlers; stopped: boolean }[],
  list: { revision: 0, groups: [] as SessionGroup[] },
}));
vi.mock("../api/sessions.ts", () => ({
  loadSessions: async () => fake.list,
  subscribeSessionStatuses: (handlers: Handlers) => {
    const stream = { handlers, stopped: false };
    fake.streams.push(stream);
    return () => { stream.stopped = true; };
  },
}));

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  fake.streams = [];
  fake.list = { revision: 0, groups: [] };
});

const host = { addController: () => {}, removeController: () => {}, requestUpdate: () => {}, updateComplete: Promise.resolve(true) };
const session = (id: string, extra: Partial<SessionView> = {}) => ({ id, title: id, status: "idle", ...extra }) as SessionView;
const group = (...sessions: SessionView[]) => ({ label: "ungrouped", sessions }) as unknown as SessionGroup;

function controller(presented = "") {
  const calls = { received: [] as string[][], settled: 0, statuses: [] as string[] };
  const sessions = new SessionsController(host, {
    presented: (id) => id === presented,
    listReceived: (ids) => calls.received.push([...ids]),
    listSettled: () => { calls.settled += 1; },
    statusesApplied: () => calls.statuses.push("snapshot"),
    statusApplied: ({ id }) => calls.statuses.push(id),
    reportError: () => {},
  });
  return { sessions, calls };
}

test("one status stream keeps the registry current until it stops", async () => {
  const { sessions, calls } = controller("b");
  sessions.start();
  sessions.start();
  assert.equal(fake.streams.length, 1, "the shell holds one status stream however often it starts");
  fake.list = { revision: 1, groups: [group(session("a"), session("b"))] };
  await sessions.refresh();
  assert.equal(sessions.loading, false);
  assert.deepEqual(calls.received, [["a", "b"]]);

  const { handlers } = fake.streams[0]!;
  handlers.onSnapshot([{ id: "a", status: "running", unread: true }]);
  assert.equal(sessions.listed("a")?.status, "running");
  assert.equal(sessions.listed("a")?.unread, true);
  handlers.onStatus({ id: "b", status: "running", unread: true });
  assert.equal(sessions.listed("b")?.status, "running");
  assert.equal(sessions.listed("b")?.unread, undefined, "a presented session is never unread");
  assert.deepEqual(calls.statuses, ["snapshot", "b"]);

  handlers.onSessions({ revision: 1, groups: [{ label: "ungrouped", ids: ["b"] }], upserts: [] });
  assert.ok(sessions.listed("a"), "an older or equal revision loses");
  handlers.onSessions({ revision: 2, groups: [{ label: "ungrouped", ids: ["b"] }], upserts: [] });
  assert.equal(sessions.listed("a"), undefined);
  assert.equal(sessions.revision, 2);

  sessions.stop();
  assert.equal(fake.streams[0]!.stopped, true);
  sessions.start();
  assert.equal(fake.streams.length, 2, "a stopped stream starts again");
});

test("collapsed groups are remembered in the browser", () => {
  const { sessions } = controller();
  sessions.toggleGroup("repo");
  assert.deepEqual(JSON.parse(localStorage.getItem("hui.collapsed-groups") ?? ""), ["repo"]);
  assert.deepEqual([...controller().sessions.collapsed], ["repo"]);
  sessions.expandGroup("repo");
  assert.deepEqual(JSON.parse(localStorage.getItem("hui.collapsed-groups") ?? ""), []);
});
