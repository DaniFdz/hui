import assert from "node:assert/strict";
import { test } from "vitest";
import type { SessionGroup, SessionView } from "../../api/sessions.ts";
import { sessionGroupLabel } from "./sessions.ts";
import {
  DEFAULT_SIDEBAR_SESSION_OPTIONS as defaults,
  filterSessionGroups,
  customGroupOrder,
  childSessionsByParent,
  mergeChildAndStartedSessions,
  runStatusChildRows,
  moveGroupLabel,
  normalizeSidebarSessionOptions,
  sessionTreeRows,
  sidebarSessionGroups,
  startedSessionsByBot,
} from "./sidebar-sessions.ts";

function session(id: string, overrides: Partial<SessionView> = {}): SessionView {
  return {
    id, title: id, group: "Work", cwd: "/work/app", tool: "pi", status: "idle",
    displayCwd: "", stage: "investigation", stageOrigin: "default", createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", ...overrides,
  };
}

const groups: SessionGroup[] = [
  { label: "ungrouped", sessions: [session("Other note", { group: "", cwd: "/work/misc" })] },
  { label: "Work", cwd: "/work/app", sessions: [
    session("Zulu", { updatedAt: "2026-09-24T00:00:00Z", status: "running" }),
    session("Alpha", { createdAt: "2026-09-23T00:00:00Z", cwd: "/work/lib", status: "waiting" }),
    session("Pinned", { pinned: true, status: "error" }),
  ] },
  { label: "Empty", sessions: [] },
];

const ids = (result: SessionGroup[]) => result.flatMap((group) => group.sessions.map((session) => session.id));

test("display labels use OTHER and uppercase without changing registry identities", () => {
  assert.equal(sessionGroupLabel(""), "OTHER");
  assert.equal(sessionGroupLabel("ungrouped"), "OTHER");
  assert.equal(sessionGroupLabel("💻 Mi proyecto"), "💻 MI PROYECTO");
  const result = sidebarSessionGroups(groups, "", defaults);
  assert.deepEqual(result.map((group) => group.label), ["Work", "Empty", "ungrouped"]);
  assert.equal(result[0]?.cwd, "/work/app");
});

test("custom groups keep catalog order and move before or after a target", () => {
  assert.deepEqual(customGroupOrder(groups), ["Work", "Empty"]);
  const order = ["A", "B", "C", "D"];
  assert.deepEqual(moveGroupLabel(order, "D", "A", "before"), ["D", "A", "B", "C"]);
  assert.deepEqual(moveGroupLabel(order, "A", "C", "after"), ["B", "C", "A", "D"]);
  assert.deepEqual(moveGroupLabel(order, "B", "D", "after"), ["A", "C", "D", "B"]);
  assert.equal(moveGroupLabel(order, "B", "C", "before"), undefined);
  assert.equal(moveGroupLabel(order, "B", "A", "after"), undefined);
  assert.equal(moveGroupLabel(order, "B", "B", "before"), undefined);
  assert.equal(moveGroupLabel(order, "B", "ungrouped", "after"), undefined);
  assert.deepEqual(order, ["A", "B", "C", "D"]);
});

test("all sorts keep pins first and never mutate the source registry order", () => {
  const before = structuredClone(groups);
  for (const [sortBy, expected] of [
    ["updated", ["Pinned", "Zulu", "Alpha"]],
    ["created", ["Pinned", "Alpha", "Zulu"]],
    ["title", ["Pinned", "Alpha", "Zulu"]],
  ] as const) {
    const result = sidebarSessionGroups(groups, "", { ...defaults, sortBy });
    assert.deepEqual(result.find((group) => group.label === "Work")?.sessions.map((session) => session.id), expected);
  }
  assert.deepEqual(groups, before);
});

test("stage sort follows the board order, keeps pins first and breaks ties by recency", () => {
  const staged: SessionGroup[] = [{ label: "Work", sessions: [
    session("Done", { stage: "done" }),
    // No stored stage: sorts with Investigation (sessions never sit in Backlog).
    session("Unplaced"),
    session("Testing", { stage: "testing" }),
    session("Investigation old", { stage: "investigation" }),
    session("Investigation new", { stage: "investigation", updatedAt: "2026-09-25T00:00:00Z" }),
    session("Pinned done", { stage: "done", pinned: true }),
  ] }];
  assert.deepEqual(
    sidebarSessionGroups(staged, "", { ...defaults, sortBy: "stage" })[0]?.sessions.map(({ id }) => id),
    ["Pinned done", "Investigation new", "Investigation old", "Unplaced", "Testing", "Done"],
  );
  assert.equal(normalizeSidebarSessionOptions({ sortBy: "stage" }).sortBy, "stage");
});

test("status filters intersect with search and preserve the collapsed-group identity", () => {
  assert.deepEqual(ids(sidebarSessionGroups(groups, "  WORK ", { ...defaults, status: "waiting" })), ["Alpha"]);
  assert.deepEqual(sidebarSessionGroups(groups, "Other", { ...defaults, status: "running" }), []);
  assert.equal(sidebarSessionGroups(groups, "", { ...defaults, status: "error" })[0]?.key, "Work");
  for (const status of ["idle", "running", "waiting", "starting", "error"] as const) {
    const source = [{ label: "Test", sessions: [session("match", { status }), session("other", { status: status === "idle" ? "running" : "idle" })] }];
    assert.deepEqual(ids(sidebarSessionGroups(source, "", { ...defaults, status })), ["match"]);
  }
});

test("archived sessions leave the active sidebar without leaving the registry", () => {
  const source = [{ label: "Work", sessions: [session("active"), session("archived", { archived: true })] }];
  assert.deepEqual(ids(sidebarSessionGroups(source, "", defaults)), ["active"]);
  assert.deepEqual(source[0]?.sessions.map((entry) => entry.id), ["active", "archived"]);
});

test("Swarm helpers have no sidebar rows; ordinary subagents keep theirs", () => {
  const child = (id: string, collect: boolean) => session(id, { parentId: "parent", subagent: {
    taskId: id, status: "running", startedAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", ...(collect ? { collect: true } : {}),
  } });
  const helperChild = session("helper-child", { parentId: "helper" });
  const source = [{ label: "Work", sessions: [session("parent"), child("ordinary", false), child("helper", true), helperChild] }];
  assert.deepEqual(ids(sidebarSessionGroups(source, "", defaults)), ["ordinary", "parent"]);
  assert.deepEqual(ids(sidebarSessionGroups(source, "helper", defaults)), []);
});

test("hiding many Swarm trees reads parent links once per projection", () => {
  let parentReads = 0;
  const helpers = Array.from({ length: 128 }, (_, index) => ({
    ...session(`helper-${index}`, {
      archived: index % 2 === 0 ? true : undefined,
      subagent: {
        taskId: `task-${index}`, collect: true, status: "completed",
        startedAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z",
      },
    }),
    get parentId() {
      parentReads += 1;
      return index % 2 ? "helper-0" : "parent";
    },
  }));
  const source = [
    { label: "Work", sessions: [session("parent"), session("ordinary", { parentId: "parent" }), ...helpers] },
    { label: "Other", sessions: [session("outside"), session("hidden-descendant", { parentId: "helper-0" })] },
  ];
  for (const groupBy of ["custom", "project", "none"] as const) {
    parentReads = 0;
    assert.deepEqual(ids(sidebarSessionGroups(source, "", { ...defaults, groupBy })).sort(), ["ordinary", "outside", "parent"]);
    assert.ok(parentReads <= helpers.length * 4, `parent links were read ${parentReads} times for ${helpers.length} helpers`);
  }
});

test("child sessions are indexed once for all parents, excluding helpers and archived children", () => {
  let parentReads = 0;
  const children = Array.from({ length: 128 }, (_, index) => ({
    ...session(`child-${index}`),
    get parentId() { parentReads += 1; return `parent-${index % 8}`; },
  }));
  const source = [{ label: "Work", sessions: [
    ...children,
    session("root"),
    session("archived", { parentId: "parent-0", archived: true }),
    session("helper", { parentId: "parent-0", subagent: {
      taskId: "helper", status: "running", startedAt: "", updatedAt: "",
    } }),
  ] }];
  const index = childSessionsByParent(source);
  assert.equal(parentReads, children.length, "one read per child, not one scan per parent");
  for (let parent = 0; parent < 8; parent += 1) {
    const siblings = index.get(`parent-${parent}`)!;
    assert.equal(siblings.length, 16);
    assert.strictEqual(index.get(`parent-${parent}`), siblings, "lookups retain the same array");
    assert.equal(runStatusChildRows(siblings).more, 8);
  }
  assert.equal(parentReads, children.length, "parent lookups and row caps never reread the registry");
  assert.equal([...index.values()].flat().length, children.length);
  const changed = childSessionsByParent([{ label: "Work", sessions: [session("new", { parentId: "parent-0" })] }]);
  assert.deepEqual(changed.get("parent-0")?.map(({ id }) => id), ["new"], "a new registry drops deleted/archived children");
});

test("child session rows prioritize running, waiting, error, idle then other statuses and cap only drawing", () => {
  const statuses = ["starting", "idle", "error", "waiting", "running", "reconnecting", "disconnected", "running", "idle", "waiting"] as const;
  const source = [{ label: "Work", sessions: statuses.map((status, i) => session(String(i), { parentId: "parent", status })) }];
  const before = source[0]!.sessions.map(({ id }) => id);
  const children = childSessionsByParent(source).get("parent")!;
  assert.deepEqual(children.map(({ id }) => id), ["4", "7", "3", "9", "2", "1", "8", "0", "5", "6"]);
  assert.deepEqual(runStatusChildRows(children), { rows: children.slice(0, 8), more: 2 });
  assert.deepEqual(runStatusChildRows([]), { rows: [], more: 0 });
  assert.deepEqual(source[0]!.sessions.map(({ id }) => id), before, "projection never mutates registry order");
});

test("sessions a bot started are indexed once for all bots, excluding archived, subagents and bot chats", () => {
  let createdByReads = 0;
  const bot = (index: number) => ({ id: `bot-${index % 2}`, handle: `bot-${index % 2}`, name: `Bot ${index % 2}` });
  const started = Array.from({ length: 64 }, (_, index) => ({
    ...session(`started-${index}`),
    get createdBy() { createdByReads += 1; return bot(index); },
  }));
  const source = [{ label: "Work", sessions: [
    session("plain"),
    ...started,
    session("archived", { createdBy: bot(0), archived: true }),
    session("helper", { createdBy: bot(0), subagent: { taskId: "helper", status: "running", startedAt: "", updatedAt: "" } }),
    session("own-chat", { createdBy: bot(0), bot: bot(0) }),
  ] }];
  const index = startedSessionsByBot(source);
  assert.equal(createdByReads, started.length, "one read per candidate session, not one scan per bot");
  assert.equal(index.get("bot-0")?.length, 32);
  assert.equal(index.get("bot-1")?.length, 32);
  assert.equal(index.get("bot-2"), undefined, "a session without createdBy is never indexed");
  assert.ok(!index.get("bot-0")?.some(({ id }) => ["archived", "helper", "own-chat"].includes(id)),
    "archived, subagent and a bot's own chat never count as sessions it started");
});

test("started sessions sort like children: running, waiting, error, idle then other statuses", () => {
  const statuses = ["idle", "running", "error", "waiting"] as const;
  const source = [{ label: "Work", sessions: statuses.map((status, i) =>
    ({ ...session(String(i), { status }), createdBy: { id: "bot-1", handle: "bot-1", name: "Bot" } })) }];
  assert.deepEqual(startedSessionsByBot(source).get("bot-1")?.map(({ id }) => id), ["1", "3", "2", "0"]);
});

test("merging a parent's children with a bot's started sessions dedupes by id and sorts status, then recency, then id", () => {
  const child = session("shared", { status: "idle", updatedAt: "2026-09-20T00:00:00Z" });
  const started = session("shared", { status: "running", updatedAt: "2099-01-01T00:00:00Z" });
  assert.deepEqual(mergeChildAndStartedSessions([child], [started]).map(({ id, status }) => [id, status]), [["shared", "idle"]],
    "a parent's own entry for an id wins over a clashing started entry");

  const children = [session("child-running", { status: "running", updatedAt: "2026-01-01T00:00:00Z" })];
  const startedOnly = [
    session("started-older", { status: "running", updatedAt: "2025-01-01T00:00:00Z" }),
    session("started-newer", { status: "running", updatedAt: "2027-01-01T00:00:00Z" }),
    session("started-idle", { status: "idle", updatedAt: "2099-01-01T00:00:00Z" }),
  ];
  assert.deepEqual(
    mergeChildAndStartedSessions(children, startedOnly).map(({ id }) => id),
    ["started-newer", "child-running", "started-older", "started-idle"],
  );

  assert.strictEqual(mergeChildAndStartedSessions(children, []), children, "an empty started list returns children unchanged");
});

test("search recognizes OTHER and raw labels across every grouping mode", () => {
  for (const groupBy of ["custom", "project", "none"] as const) {
    assert.deepEqual(ids(sidebarSessionGroups(groups, "other", { ...defaults, groupBy })), ["Other note"]);
    assert.deepEqual(ids(sidebarSessionGroups(groups, "Zulu", { ...defaults, groupBy })), ["Zulu"]);
  }
  assert.deepEqual(ids(filterSessionGroups(groups, "other")), ["Other note"]);
  assert.deepEqual(ids(filterSessionGroups(groups, "ungrouped")), ["Other note"]);
});

test("project grouping merges shared directories without inventing custom groups", () => {
  const result = sidebarSessionGroups(groups, "", { ...defaults, groupBy: "project" });
  assert.deepEqual(result.map((group) => group.label), ["app", "lib", "misc"]);
  assert.deepEqual(result[0]?.sessions.map((session) => session.id), ["Pinned", "Zulu"]);
  assert.equal(result[0]?.kind, "project");
  assert.equal(result[0]?.cwd, "/work/app");
  assert.notEqual(result[0]?.key, "/work/app");
  assert.equal(result[0]?.sessions[0]?.group, "Work");
});

test("no grouping sorts all sessions globally and exposes no empty phantom group", () => {
  const result = sidebarSessionGroups(groups, "", { ...defaults, groupBy: "none", sortBy: "title" });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, "none");
  assert.deepEqual(ids(result), ["Pinned", "Alpha", "Other note", "Zulu"]);
  assert.deepEqual(sidebarSessionGroups([], "", { ...defaults, groupBy: "none", hideEmpty: "never" }), []);
});

test("projects with the same directory name remain distinct and searchable by path", () => {
  const source = [{ label: "Work", sessions: [session("one", { cwd: "/first/app" }), session("two", { cwd: "/second/app" })] }];
  const result = sidebarSessionGroups(source, "", { ...defaults, groupBy: "project" });
  assert.deepEqual(result.map((group) => group.label), ["app", "app"]);
  assert.notEqual(result[0]?.key, result[1]?.key);
  assert.deepEqual(ids(sidebarSessionGroups(source, "/second/app", { ...defaults, groupBy: "project" })), ["two"]);
});

test("empty-group visibility supports filtering, always and never", () => {
  assert.equal(sidebarSessionGroups(groups, "", defaults).length, 3);
  assert.equal(sidebarSessionGroups(groups, "", { ...defaults, hideEmpty: "always" }).length, 2);
  assert.equal(sidebarSessionGroups(groups, "nothing", defaults).length, 0);
  const visible = sidebarSessionGroups(groups, "nothing", { ...defaults, hideEmpty: "never" });
  assert.equal(visible.length, 3);
  assert.deepEqual(ids(visible), []);
  assert.equal(sidebarSessionGroups(groups, "", { ...defaults, status: "starting" }).length, 0);
});

test("browser preference parsing rejects invalid values field by field", () => {
  assert.deepEqual(normalizeSidebarSessionOptions(null), defaults);
  assert.deepEqual(normalizeSidebarSessionOptions({ groupBy: "owners", status: "archived", sortBy: "bad", hideEmpty: true }), defaults);
  const saved = { groupBy: "project", status: "waiting", sortBy: "created", hideEmpty: "never" } as const;
  assert.deepEqual(normalizeSidebarSessionOptions(JSON.parse(JSON.stringify(saved))), saved);
  assert.deepEqual(normalizeSidebarSessionOptions({ ...saved, sortBy: "invalid" }), { ...saved, sortBy: "updated" });
});

test("spawned sessions render immediately below their parent at increasing depth", () => {
  const source = [
    session("sibling"),
    session("grandchild", { parentId: "child" }),
    session("parent"),
    session("child", { parentId: "parent" }),
    session("orphan", { parentId: "missing" }),
  ];
  assert.deepEqual(
    sessionTreeRows(source).map(({ session, depth }) => [session.id, depth]),
    [
      ["sibling", 0],
      ["parent", 0],
      ["child", 1],
      ["grandchild", 2],
      ["orphan", 0],
    ],
  );
});

test("subagents stay folded until opened, except the path to a selected subagent", () => {
  const source = [session("grandchild", { parentId: "child" }), session("child", { parentId: "parent" }), session("parent"), session("other")];
  const ids = (selectedId: string, toggled: string[] = []) =>
    sessionTreeRows(source, { selectedId, toggled: new Set(toggled) }).map(({ session }) => session.id);
  assert.deepEqual(ids("other"), ["parent", "other"]);
  assert.deepEqual(ids("parent"), ["parent", "other"]);
  assert.deepEqual(ids("parent", ["parent"]), ["parent", "child", "other"]);
  assert.deepEqual(ids("child"), ["parent", "child", "other"]);
  assert.deepEqual(ids("grandchild"), ["parent", "child", "grandchild", "other"]);
  assert.deepEqual(ids("grandchild", ["parent"]), ["parent", "other"]);
  assert.deepEqual(ids("other", ["parent"]), ["parent", "child", "other"]);
  assert.deepEqual(sessionTreeRows(source, { selectedId: "other", toggled: new Set() }).map(({ collapsed }) => collapsed), [true, false]);
  assert.equal(sessionTreeRows(source).length, 4);
  // Opening the parent itself is not an opening of its subagents: only a disclosure unfolds that tree.
  assert.deepEqual(sessionTreeRows(source, { selectedId: "parent", toggled: new Set() }).map(({ session, collapsed }) => [session.id, collapsed]), [["parent", true], ["other", false]]);
  // And a tree the selection unfolded folds again once another session opens.
  assert.deepEqual(ids("other"), ["parent", "other"], "nothing is left unfolded");
});

test("folding remains safe with missing parents, self-links and cycles", () => {
  const source = [session("a", { parentId: "b" }), session("b", { parentId: "a" }), session("self", { parentId: "self" }), session("orphan", { parentId: "missing" })];
  assert.deepEqual(sessionTreeRows(source, { selectedId: "self", toggled: new Set() }).map(({ session }) => session.id), ["orphan", "a", "self"]);
  assert.deepEqual(sessionTreeRows(source, { selectedId: "a", toggled: new Set() }).map(({ session }) => session.id), ["orphan", "a", "b", "self"]);
  assert.equal(sessionTreeRows(source).length, 4);
});

test("filtered children remain reachable while their absent parent is folded", () => {
  const source = [{ label: "Work", sessions: [session("parent"), session("child", { parentId: "parent", status: "running" })] }];
  const filtered = sidebarSessionGroups(source, "child", defaults);
  assert.deepEqual(sessionTreeRows(filtered[0]!.sessions, { selectedId: "", toggled: new Set() }).map(({ session, depth, hasChildren }) => [session.id, depth, hasChildren]), [["child", 0, false]]);
});

test("session search also matches pull request references and titles", () => {
  const withPr = [{ label: "Work", sessions: [
    session("badges", { pullRequests: [{ repository: "acme/web", number: 42, url: "https://github.com/acme/web/pull/42", title: "Sidebar PR marks" }] }),
    session("plain"),
  ] }];
  assert.deepEqual(ids(filterSessionGroups(withPr, "acme/web#42")), ["badges"]);
  assert.deepEqual(ids(filterSessionGroups(withPr, "pr marks")), ["badges"]);
});
