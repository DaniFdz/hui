import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import type { HostMetrics } from "../api/schema/host.ts";
import type { SessionGroup, SessionView } from "../api/schema/sessions.ts";
import type { WorkerMetrics } from "../api/workers.ts";
import { EMPTY_FILTERS, type SessionFilters } from "../lib/dashboard.ts";
import { HUI_PAGES, availablePages, isPageAvailable } from "../lib/pages.ts";
import { DEFAULT_SETTINGS } from "../lib/settings/settings.ts";
import { renderDashboard, type DashboardChartProps, type DashboardProps } from "./dashboard.ts";

/** A template's text with every nested template and value in place; handlers and directives drop out. */
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: readonly unknown[] };
    return template.strings.map((part, index) => part + (index < template.values.length ? text(template.values[index]) : "")).join("");
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

type Action = { label: string; handler: (event: unknown) => void };

/** The text the element around a binding shows: inline when it has any, its whole rendered text otherwise. */
function elementLabel(template: { strings: readonly string[]; values: readonly unknown[] }, index: number): string {
  const rest = template.strings[index + 1] ?? "";
  const close = rest.indexOf("<");
  if (rest.startsWith(">") && close > 0) {
    const inline = rest.slice(1, close).trim();
    if (inline) return inline;
  }
  return text(template).replace(/<[^>]*>/gu, "").trim();
}

/** The elements a view binds one template attribute to, with the text they show, in document order. */
function actions(value: unknown, attribute: string, found: Action[] = []): Action[] {
  if (Array.isArray(value)) {
    value.forEach((item) => actions(item, attribute, found));
    return found;
  }
  if (!value || typeof value !== "object" || !("strings" in value && "values" in value)) return found;
  const template = value as { strings: readonly string[]; values: readonly unknown[] };
  template.strings.forEach((part, index) => {
    const bound = template.values[index];
    if (part.includes(attribute) && typeof bound === "function") {
      found.push({ label: elementLabel(template, index), handler: bound as (event: unknown) => void });
    }
    actions(bound, attribute, found);
  });
  return found;
}

type PickerParams = { label: string; value: string | null; options: readonly { value: string; label: string }[]; showOptionTooltips?: boolean; onChange: (value: string) => void };

/** The settings pickers a view draws, in render order. */
function pickers(value: unknown, found: PickerParams[] = []): PickerParams[] {
  if (Array.isArray(value)) {
    value.forEach((item) => pickers(item, found));
    return found;
  }
  if (!value || typeof value !== "object" || !("strings" in value && "values" in value)) return found;
  const template = value as { strings: readonly string[]; values: readonly unknown[] };
  template.strings.forEach((part, index) => {
    const bound = template.values[index];
    if (part.includes(".params=") && bound && typeof bound === "object" && "onChange" in bound) found.push(bound as PickerParams);
    pickers(bound, found);
  });
  return found;
}

const NOW = Date.parse("2026-10-23T12:00:00Z");

function session(id: string, overrides: Partial<SessionView> = {}): SessionView {
  return {
    id, title: `Session ${id}`, group: "", cwd: "/work", displayCwd: "~/work", tool: "pi", status: "idle",
    stage: "investigation", stageOrigin: "default", createdAt: "2026-10-23T10:00:00Z", updatedAt: "2026-10-23T11:55:00Z",
    ...overrides,
  };
}

const listed = (...sessions: SessionView[]): SessionGroup[] => [{ label: "", sessions }];

function metrics(overrides: Partial<HostMetrics> = {}): HostMetrics {
  return {
    sampledAt: "2026-10-23T12:00:00Z",
    host: { platform: "darwin", cores: 10 },
    cpu: { percent: 42, load: [2, 1.5, 1] },
    memory: { totalBytes: 32 * 1024 ** 3, usedBytes: 30 * 1024 ** 3, swapUsedBytes: 0 },
    disk: { path: "/Users/me/.config/hui", totalBytes: 1000 * 1024 ** 3, usedBytes: 400 * 1024 ** 3 },
    network: null,
    gpu: null,
    gateway: { cpuPercent: 3, rssBytes: 200 * 1024 ** 2 },
    ...overrides,
  };
}

function chart(overrides: Partial<DashboardChartProps> = {}): DashboardChartProps {
  return {
    gateway: "gateway", metric: "cpu", window: 5, hidden: new Set(), samples: new Map(), hover: null,
    onMetric: () => {}, onWindow: () => {}, onToggleMachine: () => {}, onHover: () => {},
    ...overrides,
  };
}

function view(overrides: Partial<DashboardProps> = {}) {
  return renderDashboard({
    groups: [], sessionsLoading: false, sessionsError: "", filters: EMPTY_FILTERS, busy: new Set(), actionError: "",
    metrics: undefined, metricsError: "", workers: [], workersError: "", chart: chart(), expandedLists: new Set(), now: NOW,
    onRetry: () => {}, onToggleList: () => {}, onFilters: () => {}, onClearFilters: () => {}, onDismissActionError: () => {},
    onAnswer: () => {}, onResume: () => {}, onOpenSession: () => {},
    ...overrides,
  });
}

const page = (overrides: Partial<DashboardProps> = {}) => text(view(overrides));

/** Where an element with this test id starts, whether Lit drew the attribute quoted or bound. */
function at(markup: string, id: string, from = 0): number {
  const quoted = markup.indexOf(`data-testid="${id}"`, from);
  return quoted >= 0 ? quoted : markup.indexOf(`data-testid=${id}`, from);
}

/** The sessions section, up to the activity monitor. */
function sessionsArea(markup: string): string {
  const start = at(markup, "dashboard-sessions");
  const end = at(markup, "dashboard-activity", start);
  assert.ok(start >= 0 && end > start, "the page has a sessions section before the activity monitor");
  return markup.slice(start, end);
}

/** One lane's markup, from its section to the next lane. */
function lane(markup: string, key: string): string {
  const start = at(markup, `dashboard-lane-${key}`);
  assert.ok(start >= 0, `the ${key} lane is drawn`);
  const next = markup.indexOf("data-testid=dashboard-lane-", start + 1);
  const end = next < 0 ? at(markup, "dashboard-activity", start) : next;
  return markup.slice(start, end < 0 ? undefined : end);
}

/** The lane keys the sessions section draws, in order. */
const laneKeys = (markup: string) => [...sessionsArea(markup).matchAll(/data-testid=dashboard-lane-(\w+)/gu)].map((match) => match[1]);

/** Each row's title, in the order it is drawn. */
const titles = (markup: string) => [...markup.matchAll(/dashboard-row__title-text">([^<]*)</gu)].map((match) => match[1]!);

/** Each row's session id, in the order it is drawn. */
const rowIds = (markup: string) => [...markup.matchAll(/data-session-id=([\w-]+)/gu)].map((match) => match[1]!);

/** One row's markup, from its list item to the row after it. */
function rowOf(markup: string, id: string): string {
  const start = markup.indexOf(`data-session-id=${id}`);
  assert.ok(start >= 0, `the row for ${id} is drawn`);
  const next = markup.indexOf("data-session-id=", start + 1);
  return markup.slice(start, next < 0 ? undefined : next);
}

/** The handler of the one action whose label is `label`, in a rendered view or its markup. */
function actionAt(value: unknown, attribute: string, label: string): (event: unknown) => void {
  const matches = actions(value, attribute).filter((entry) => entry.label === label);
  assert.equal(matches.length, 1, `one action reads ${label}: ${JSON.stringify(actions(value, attribute).map((entry) => entry.label))}`);
  return matches[0]!.handler;
}

const click = {} as MouseEvent;

test("Dashboard is a page only while Labs → Dashboard is on", () => {
  const dashboard = HUI_PAGES.find((entry) => entry.id === "dashboard")!;
  assert.equal(isPageAvailable(dashboard, DEFAULT_SETTINGS.labs), false);
  assert.equal(availablePages(DEFAULT_SETTINGS.labs).some((entry) => entry.id === "dashboard"), false);
  assert.equal(isPageAvailable(dashboard, { ...DEFAULT_SETTINGS.labs, dashboard: true }), true);
  assert.equal(availablePages(DEFAULT_SETTINGS.labs).length, HUI_PAGES.length - 1, "every other page stays");
});

test("each reason for a session in flight is a lane, in queue order, holding its own rows", () => {
  const groups = listed(
    session("ask", { status: "waiting", question: { id: "q", method: "select", title: "Which branch should I ship?", options: ["main", "next"] } }),
    session("broken", { status: "error", failure: "The provider answered 500." }),
    session("read", { status: "idle", unread: true }),
    session("run", { status: "running" }),
    session("parked", { status: "idle" }),
    session("shipped", { status: "idle", stage: "done" }),
    session("child", { status: "running", parentId: "run" }),
  );
  const markup = page({ groups });
  assert.deepEqual(laneKeys(markup), ["answer", "fix", "unread", "flight", "parked"], "the lanes keep their order and a finished session or subagent has none");
  assert.deepEqual(titles(lane(markup, "answer")), ["“Which branch should I ship?”"], "a question leads its row in quotes");
  assert.deepEqual(rowIds(lane(markup, "answer")), ["ask"]);
  assert.deepEqual(rowIds(lane(markup, "fix")), ["broken"]);
  assert.deepEqual(rowIds(lane(markup, "unread")), ["read"]);
  assert.deepEqual(rowIds(lane(markup, "flight")), ["run"]);
  assert.deepEqual(rowIds(lane(markup, "parked")), ["parked"]);
  assert.match(lane(markup, "answer"), /Session ask · Investigation · waiting <time/u, "the session's own title moves below the question it is waiting on");
  assert.match(lane(markup, "unread"), /Unread answer/u);
  assert.match(lane(markup, "parked"), /last answer read <time/u);
  assert.match(lane(markup, "flight"), /Investigation · <time class="dashboard-row__time" datetime=2026-10-23T11:55:00Z>5m ago<\/time>/u,
    "an In flight row says when it changed too");
  assert.match(lane(markup, "fix"), /dashboard-row__failure">The provider answered 500\./u);
  assert.deepEqual([...markup.matchAll(/data-lane=(\w+)>\s*<strong class="dashboard-stat__count">(\d+)/gu)].map((match) => `${match[1]} ${match[2]}`),
    ["answer 1", "fix 1", "unread 1", "flight 1", "parked 1"], "the stat strip counts one per lane");
  assert.doesNotMatch(markup, /dashboard-needs-you|dashboard-stage-counts|need you/u, "the old status pill and stage boxes are gone");
  assert.match(sessionsArea(markup), /grouped by what they need from you/u, "the paragraph on the page is one sentence");
});

test("a lane with nothing in it is left out", () => {
  const markup = page({ groups: listed(session("run", { status: "running" })) });
  assert.deepEqual(laneKeys(markup), ["flight"]);
  assert.match(sessionsArea(markup), /class="dashboard-stat dashboard-stat--zero" data-lane=answer/u, "the strip still says each lane is empty");
  assert.doesNotMatch(sessionsArea(markup), /data-testid=dashboard-lane-answer/u);
});

test("a select question draws one button per option and answers with the value the operator picks", () => {
  const answers: Array<{ session: string; question: string; answer: unknown }> = [];
  const options = Array.from({ length: 10 }, (_, index) => `Option ${index}`);
  const groups = listed(session("ask", { status: "waiting", question: { id: "q-1", method: "select", title: "Pick a lane", options } }));
  const markup = page({ groups, onAnswer: (target, question, answer) => answers.push({ session: target.id, question: question.id, answer }) });
  const row = lane(markup, "answer");
  assert.deepEqual([...row.matchAll(/dashboard-action" type="button" \?disabled=false\s+@click=>([^<]+)</gu)].map((match) => match[1]),
    options.slice(0, 8), "the gateway sends at most eight options, and each one is a button");
  const render = view({ groups, onAnswer: (target, question, answer) => answers.push({ session: target.id, question: question.id, answer }) });
  actionAt(render, "@click=", "Option 3")(click);
  assert.deepEqual(answers, [{ session: "ask", question: "q-1", answer: { value: "Option 3" } }]);
  assert.match(row, />Open</u, "a row always opens its session too");
  assert.doesNotMatch(row, /Open to answer/u);

  const omitted = page({ groups: listed(session("long", { status: "waiting", question: { id: "q-4", method: "select", title: "Pick a long lane" } })) });
  const omittedRow = lane(omitted, "answer");
  assert.doesNotMatch(omittedRow, /type="button"/u, "a select whose options the gateway left out draws no answer button");
  assert.match(omittedRow, /dashboard-action--link href=[^>]*>Open to answer</u);
  assert.equal(omittedRow.match(/dashboard-action--link/gu)?.length, 1, "the title already links, so the row keeps one way in");
});

test("a confirm question answers yes or no, and any other method opens the session to answer", () => {
  const answers: Array<{ confirmed: boolean }> = [];
  const groups = listed(session("ask", { status: "waiting", question: { id: "q-2", method: "confirm", title: "Delete the branch?" } }));
  const render = view({ groups, onAnswer: (_target, _question, answer) => answers.push(answer as { confirmed: boolean }) });
  const row = lane(text(render), "answer");
  assert.deepEqual([...row.matchAll(/dashboard-action" type="button" \?disabled=false\s+@click=>([^<]+)</gu)].map((match) => match[1]), ["Yes", "No"]);
  actionAt(render, "@click=", "Yes")(click);
  actionAt(render, "@click=", "No")(click);
  assert.deepEqual(answers, [{ confirmed: true }, { confirmed: false }]);

  const input = page({ groups: listed(session("type", { status: "waiting", question: { id: "q-3", method: "input", title: "Which tag?" } })) });
  const inputRow = lane(input, "answer");
  assert.doesNotMatch(inputRow, /type="button"/u, "an answer typed into the session has no one-click value");
  assert.match(inputRow, />Open to answer</u);
  assert.doesNotMatch(inputRow, />Open</u, "no second link: the row's title already opens the session");
  assert.equal(inputRow.match(/dashboard-action--link/gu)?.length, 1, "one way in from the actions");
});

test("a waiting session without a question says what it is waiting for and reads its title", () => {
  const markup = page({ groups: listed(session("ask", { status: "waiting", title: "Rebuild the index" })) });
  const row = lane(markup, "answer");
  assert.deepEqual(titles(row), ["Rebuild the index"]);
  assert.match(row, /dashboard-row__why" data-tone="waiting">Waiting for your answer/u);
  assert.doesNotMatch(row, /Open to answer|type="button"/u);
});

test("Fix offers Resume only for an idle session whose last run failed, and opens one whose runtime died", () => {
  const groups = listed(
    session("failed", { status: "idle", runFailed: true, failure: "The provider answered 401.", updatedAt: "2026-10-23T11:50:00Z" }),
    session("crashed", { status: "error", failure: "The runtime exited.", updatedAt: "2026-10-23T11:40:00Z" }),
    session("offline", { status: "disconnected", updatedAt: "2026-10-23T11:30:00Z" }),
  );
  const resumed: string[] = [];
  const render = view({ groups, onResume: (target) => resumed.push(target.id) });
  const fix = lane(text(render), "fix");
  assert.deepEqual(rowIds(fix), ["offline", "crashed", "failed"], "a failed turn and a dead runtime wait in Fix alike, longest wait first");

  const failed = rowOf(fix, "failed");
  assert.match(failed, /dashboard-row__failure">The provider answered 401\./u, "the row keeps what the run reported");
  assert.match(failed, /\?disabled=false\s+@click=>Resume</u, "an idle session's runtime can continue the failed turn");
  assert.match(failed, />Open</u);

  assert.match(rowOf(fix, "crashed"), /dashboard-row__failure">The runtime exited\./u);
  assert.match(rowOf(fix, "offline"), /dashboard-row__failure">Disconnected</u, "a disconnect without a message says so");
  for (const dead of ["crashed", "offline"]) {
    const row = rowOf(fix, dead);
    assert.doesNotMatch(row, /Resume|type="button"/u, `${dead} offers no Resume: a dead runtime cannot continue`);
    assert.match(row, />Open</u, "the session still opens, so the operator retries it there");
  }
  actionAt(render, "@click=", "Resume")(click);
  assert.deepEqual(resumed, ["failed"], "only the session that can continue is resumed");

  const gone = page({ groups: listed(session("crashed", { status: "error" })) });
  assert.match(rowOf(lane(gone, "fix"), "crashed"), /dashboard-row__failure">The last run failed\./u, "a stop with nothing to quote still says why it is here");
});

test("a stopped session says why it stopped, from the run, the HUI record or its disconnect", () => {
  const markup = page({ groups: listed(
    session("reported", { status: "error", failure: "The tool call was denied." }),
    session("failed", { status: "error", runFailed: true }),
    session("offline", { status: "disconnected" }),
  ) });
  const laneMarkup = lane(markup, "fix");
  assert.match(laneMarkup, /The tool call was denied\./u);
  assert.match(laneMarkup, /The last run failed\./u);
  assert.match(laneMarkup, /Disconnected/u);
  assert.equal(laneMarkup.match(/dashboard-row__failure/gu)?.length, 3);
});

test("a session in flight reads its progress steps, and its own status when it has no card", () => {
  const steps = [
    ["lint the tree", "completed"], ["write the parser", "completed"], ["wire the view", "completed"], ["run the suite", "completed"],
    ["Wiring the resize handle", "in_progress"], ["write the tests", "pending"], ["update the docs", "pending"],
  ] as const;
  const markup = page({ groups: listed(
    session("run", { status: "running", progress: { markdown: "", steps: steps.map(([step, status]) => ({ step, status })) } }),
    session("fresh", { status: "starting" }),
    session("back", { status: "reconnecting" }),
    session("read", { status: "idle", unread: true, progress: { markdown: "Waiting on the flaky suite", steps: [] } }),
  ) });
  assert.match(lane(markup, "flight"), /dashboard-row__progress">4 of 7 steps · Wiring the resize handle</u);
  assert.match(rowOf(markup, "fresh"), /dashboard-row__progress">Starting</u, "a session starting says so, not that it runs");
  assert.match(rowOf(markup, "back"), /dashboard-row__progress">Reconnecting</u, "and a reconnecting one names its own state");
  assert.doesNotMatch(rowOf(markup, "fresh"), /dashboard-row__progress">Running</u);
  assert.match(lane(markup, "unread"), /dashboard-row__progress">Waiting on the flaky suite</u, "an unread card reads its note when it has no steps");
  assert.match(rowOf(markup, "fresh"), /<time class="dashboard-row__time"/u, "a running row carries when it changed");
});

test("the filter bar offers every value with its count and narrows the lanes without reordering them", () => {
  const patches: Partial<SessionFilters>[] = [];
  const groups: SessionGroup[] = [
    { label: "HUI", sessions: [
      session("run", { group: "HUI", status: "running", stage: "implementation" }),
      session("ask", { group: "HUI", status: "waiting", stage: "testing", worker: { id: "w1", name: "Workspace One" } }),
    ] },
    { label: "Other", sessions: [session("parked", { group: "Other", status: "idle", stage: "investigation" })] },
  ];
  const render = view({ groups, onFilters: (patch) => patches.push(patch) });
  const markup = text(render);
  assert.match(markup, /<input type="search" aria-label="Search sessions" placeholder="Search title or project"/u);
  const drawn = pickers(render);
  assert.deepEqual(drawn.map((picker) => [picker.label, picker.value]), [["Group", "all"], ["Status", "all"], ["Worker", "all"], ["Stage", "all"]]);
  assert.deepEqual(drawn[0]!.options.map(({ value, label }) => ({ value, label })), [
    { value: "all", label: "All groups" },
    { value: "filter:HUI", label: "HUI (2)" },
    { value: "filter:Other", label: "OTHER (1)" },
  ], "a group choice counts the sessions it would show and keeps the stored group behind its own prefix");
  assert.deepEqual(drawn[1]!.options.map((option) => option.label), ["All statuses", "Idle (1)", "Needs input (1)", "Running (1)"]);
  assert.deepEqual(drawn[2]!.options.map((option) => option.label), ["Every machine", "This gateway (2)", "Workspace One (1)"]);
  assert.deepEqual(drawn[3]!.options.map((option) => option.label), ["Every stage", "Implementation (1)", "Investigation (1)", "Testing (1)"]);

  // A choice counts the sessions the other filters leave, so a picker promises what picking it would draw.
  const narrowed = pickers(view({ groups, filters: { ...EMPTY_FILTERS, group: "HUI" } }));
  assert.deepEqual(narrowed[0]!.options.map((option) => option.label), ["All groups", "HUI (2)", "OTHER (1)"],
    "a group choice leaves its own filter out");
  assert.deepEqual(narrowed[1]!.options.map((option) => option.label), ["All statuses", "Needs input (1)", "Running (1)", "Idle (0)"],
    "a status choice stays listed with the count the group filter leaves it");
  assert.deepEqual(narrowed[2]!.options.map((option) => option.label), ["Every machine", "This gateway (1)", "Workspace One (1)"]);
  assert.deepEqual(narrowed[3]!.options.map((option) => option.label), ["Every stage", "Implementation (1)", "Testing (1)", "Investigation (0)"],
    "a choice the other filters leave out stays listed, with nothing to show");

  drawn[0]!.onChange("filter:HUI");
  drawn[1]!.onChange("all");
  drawn[3]!.onChange("filter:testing");
  assert.deepEqual(patches, [{ group: "HUI" }, { status: "" }, { stage: "testing" }], "the sentinel filters nothing");

  const filtered = page({ groups, filters: { ...EMPTY_FILTERS, status: "waiting" } });
  assert.deepEqual(laneKeys(filtered), ["answer"], "a status filter leaves only the lane that holds it");
  const byStage = page({ groups, filters: { ...EMPTY_FILTERS, stage: "investigation" } });
  assert.deepEqual(laneKeys(byStage), ["parked"], "a stage filter narrows the rest");
  const query = page({ groups, filters: { ...EMPTY_FILTERS, query: "workspace" } });
  assert.deepEqual(rowIds(query), [], "the query reads title, path and group, so a worker name matches nothing");
  const byGroup = page({ groups, filters: { ...EMPTY_FILTERS, group: "HUI" } });
  assert.deepEqual(rowIds(byGroup), ["ask", "run"], "the lanes stay in order, with each lane's own order inside");
});

test("a group name too long for its choice is shortened there so the count stays readable", () => {
  const patches: Partial<SessionFilters>[] = [];
  const group = "Atlas persistence and replication working group of reviewers";
  assert.equal(group.length, 60, "the case is a name no 390px filter row draws whole");
  const [picker] = pickers(view({ groups: listed(session("long", { group, status: "running" })), onFilters: (patch) => patches.push(patch) }));
  assert.deepEqual(picker!.options.map(({ value, label }) => ({ value, label })), [
    { value: "all", label: "All groups" },
    { value: `filter:${group}`, label: "ATLAS PERSISTENCE AND R… (1)" },
  ], "the choice shows the shortened name with its count, and the sentinel keeps its whole label");

  const choice = picker!.options.find((option) => option.value !== "all")!;
  const shown = choice.label.slice(0, choice.label.lastIndexOf(" ("));
  assert.equal(shown.length, 24, "the name a choice shows is at most 24 characters long");
  assert.ok(shown.endsWith("…"), "ending in an ellipsis in place of the rest");

  picker!.onChange(choice.value);
  assert.deepEqual(patches, [{ group }], "picking the shortened choice still filters by the whole name");
});

test("a group literally named all is a choice of its own, not the sentinel", () => {
  const patches: Partial<SessionFilters>[] = [];
  const groups: SessionGroup[] = [
    { label: "all", sessions: [session("named-all", { group: "all", status: "running" })] },
    { label: "Other", sessions: [session("other", { group: "Other", status: "idle" })] },
  ];
  const [group] = pickers(view({ groups, onFilters: (patch) => patches.push(patch) }));
  assert.deepEqual(group!.options.map(({ value, label }) => ({ value, label })), [
    { value: "all", label: "All groups" },
    { value: "filter:all", label: "ALL (1)" },
    { value: "filter:Other", label: "OTHER (1)" },
  ], "the sentinel and the group named all are two different choices");
  assert.equal(group!.value, "all", "an unfiltered page shows the sentinel");

  group!.onChange("filter:all");
  group!.onChange("all");
  assert.deepEqual(patches, [{ group: "all" }, { group: "" }], "picking the group named all sets it, and only the sentinel clears");

  const filtered = view({ groups, filters: { ...EMPTY_FILTERS, group: "all" } });
  assert.equal(pickers(filtered)[0]!.value, "filter:all", "the group named all is shown as the selected choice");
  assert.deepEqual(rowIds(page({ groups, filters: { ...EMPTY_FILTERS, group: "all" } })), ["named-all"]);
});

test("Clear shows only while a filter is set, and empties all of them", () => {
  const groups = listed(session("run", { status: "running" }));
  assert.doesNotMatch(page({ groups }), />Clear</u, "nothing to clear without a filter");
  const cleared: number[] = [];
  const render = view({ groups, filters: { ...EMPTY_FILTERS, group: "HUI", query: " hid " }, onClearFilters: () => cleared.push(1) });
  const markup = text(render);
  assert.match(sessionsArea(markup), />Clear</u);
  actionAt(render, "@click=", "Clear")(click);
  assert.deepEqual(cleared, [1]);
  const patched: Partial<SessionFilters>[] = [];
  actionAt(view({ groups, onFilters: (patch) => patched.push(patch) }), "@input=", "")({ target: { value: "parser" } } as unknown);
  assert.deepEqual(patched, [{ query: "parser" }], "the search field patches the query");
});

test("the count line reads how many of the sessions pass, and how many are finished", () => {
  const running = Array.from({ length: 3 }, (_, index) => session(`run${index}`, { status: "running", updatedAt: `2026-10-23T11:5${index}:00Z` }));
  const parked = Array.from({ length: 5 }, (_, index) => session(`idle${index}`, { status: "idle" }));
  const done = Array.from({ length: 2 }, (_, index) => session(`done${index}`, { status: "idle", stage: "done" }));
  const groups = listed(...running, ...parked, ...done);
  const markup = page({ groups, filters: { ...EMPTY_FILTERS, status: "running" } });
  const count = markup.slice(at(markup, "dashboard-count"), markup.indexOf("</p>", at(markup, "dashboard-count")));
  assert.match(count, /<strong class="dashboard-count__matched">3 of 8 sessions<\/strong>/u);
  assert.match(count, /dashboard-count__finished">· 2 finished</u, "the finished count stays visible beside the filter");
  assert.match(markup, /role="status" data-testid="dashboard-count"/u);
  assert.match(page({ groups }), /<strong class="dashboard-count__matched">8 of 8 sessions<\/strong>/u);
  assert.match(page({ groups, sessionsLoading: true }), /data-testid="dashboard-updating">Updating…</u, "a read in flight is quiet beside the rows");
  assert.doesNotMatch(page({ groups }), /Updating…/u);
});

test("nothing matched reads one empty state that clears the filters", () => {
  const groups = listed(session("run", { status: "running" }));
  const cleared: number[] = [];
  const render = view({ groups, filters: { ...EMPTY_FILTERS, status: "waiting" }, onClearFilters: () => cleared.push(1) });
  const markup = text(render);
  assert.deepEqual(laneKeys(markup), []);
  assert.match(markup, /data-testid="dashboard-empty"[\s\S]*No sessions match these filters\./u);
  actionAt(render, "@click=", "Clear filters")(click);
  assert.deepEqual(cleared, [1]);
  assert.match(page({ groups: [] }), /No sessions yet\./u);
  assert.match(page({ groups: listed(session("done", { status: "idle", stage: "done" })) }), /No sessions in flight\./u);
  assert.match(page({ sessionsLoading: true }), /Reading sessions…/u, "the first read says it is reading");
  assert.match(page({ sessionsError: "the registry answered 500" }), /role="alert">the registry answered 500/u);
});

test("each lane shows three rows and opens on its own Show all button", () => {
  const many = (prefix: string, status: SessionView["status"], count: number) =>
    Array.from({ length: count }, (_, index) => session(`${prefix}${index}`, { status, updatedAt: `2026-10-23T11:5${9 - index}:00Z` }));
  const groups = listed(...many("r", "running", 5), ...many("p", "idle", 4));
  const collapsed = page({ groups });
  assert.deepEqual(rowIds(lane(collapsed, "flight")), ["r0", "r1", "r2"], "a lane draws three rows");
  assert.match(lane(collapsed, "flight"), /<button class="dashboard-more" type="button" aria-controls=dashboard-list-flight aria-expanded=false/u);
  assert.match(lane(collapsed, "flight"), />Show all 5</u);
  assert.match(lane(collapsed, "parked"), />Show all 4</u);
  assert.doesNotMatch(lane(collapsed, "parked"), /aria-expanded=true/u);
  assert.match(lane(collapsed, "parked"), /aria-controls=dashboard-list-parked aria-expanded=false/u, "a lane key is its own list key");

  const toggled: string[] = [];
  const render = view({ groups, onToggleList: (key) => toggled.push(key) });
  actionAt(render, "@click=", "Show all 5")(click);
  assert.deepEqual(toggled, ["flight"]);

  const expanded = page({ groups, expandedLists: new Set(["flight"]) });
  assert.deepEqual(rowIds(lane(expanded, "flight")), ["r0", "r1", "r2", "r3", "r4"]);
  assert.match(lane(expanded, "flight"), />Show fewer</u);
  assert.match(lane(expanded, "flight"), /aria-expanded=true/u);
  assert.match(lane(expanded, "parked"), /aria-expanded=false/u, "opening one lane leaves the others folded");
});

test("an answer or a resume in flight disables its buttons and says what it is doing", () => {
  const busy = new Set(["ask", "failed"]);
  const groups = listed(
    session("ask", { status: "waiting", question: { id: "q", method: "confirm", title: "Continue?" } }),
    session("failed", { status: "idle", runFailed: true }),
  );
  const markup = page({ groups, busy });
  const answer = lane(markup, "answer");
  assert.doesNotMatch(answer, /type="button" \?disabled=false/u, "every answer button is inert");
  assert.equal(answer.match(/\?disabled=true\s+@click=>Answering…</gu)?.length, 2);
  const fix = lane(markup, "fix");
  assert.match(fix, /\?disabled=true\s+@click=>Resuming…</u);
  assert.match(fix, />Open</u, "the way into the session stays open");
  assert.match(page({ groups }), /\?disabled=false @click=>Resume</u);
});

test("the page draws no native title tooltip, keeping its detail in HUI's own tooltip", () => {
  const title = "A".repeat(120);
  const worker = "workspace-with-a-long-name";
  const render = view({
    groups: listed(session("long", { status: "running", title, worker: { id: "w", name: worker },
      pullRequests: [{ repository: "o/r", number: 12, url: "https://github.com/o/r/pull/12", state: "open" }] })),
    metrics: metrics(),
  });
  const markup = text(render);
  assert.doesNotMatch(markup, /\stitle=/u, "no element the page serializes falls back to the browser's own tooltip");
  assert.deepEqual(pickers(render).map((picker) => picker.showOptionTooltips), [false, false, false, false],
    "each filter picker keeps its option values out of a native title, where the serialized markup cannot show it");
  assert.match(sessionsArea(markup), new RegExp(`dashboard-row__title-text">${title}<`, "u"), "a long title keeps its two lines");
  assert.match(sessionsArea(markup), new RegExp(`dashboard-chip--worker[^>]*data-hui-tooltip=${worker}>${worker}<`, "u"),
    "a worker chip keeps its whole name in HUI's tooltip");
  assert.match(sessionsArea(markup), /data-hui-tooltip=Pull request o\/r#12, open>#12 Open</u, "a pull request keeps its full label");
  assert.match(markup, /dashboard-metric__path" data-hui-tooltip=\/Users\/me\/\.config\/hui/u, "the disk path keeps its full text");
  assert.match(sessionsArea(markup), /dashboard-chip--subagent|dashboard-chip--worker/u);
});

test("a filter the operator cannot satisfy keeps the lane order that is left", () => {
  const groups = listed(
    session("run", { status: "running", stage: "implementation", updatedAt: "2026-10-23T11:59:00Z" }),
    session("ask", { status: "waiting", stage: "implementation", updatedAt: "2026-10-23T10:00:00Z" }),
    session("parked", { status: "idle", stage: "implementation", updatedAt: "2026-10-23T09:00:00Z" }),
  );
  assert.deepEqual(laneKeys(page({ groups, filters: { ...EMPTY_FILTERS, stage: "implementation" } })), ["answer", "flight", "parked"]);
  assert.deepEqual(rowIds(page({ groups })), ["ask", "run", "parked"], "the answer lane waits longest first, the flight lane newest first");
});

test("the answer error is a dismissible alert above the lanes, and a read failure keeps its own callout", () => {
  const dismissed: number[] = [];
  const render = view({
    groups: listed(session("ask", { status: "waiting", question: { id: "q", method: "confirm", title: "Continue?" } })),
    actionError: "the gateway answered 409",
    onDismissActionError: () => dismissed.push(1),
  });
  const markup = text(render);
  const alert = markup.indexOf('<div class="callout danger dashboard-callout" role="alert" data-testid="dashboard-action-error">the gateway answered 409');
  assert.ok(alert >= 0, "the answer failure is an alert callout carrying its reason");
  assert.ok(alert < at(markup, "dashboard-lane-answer"), "the alert sits above the lanes");
  actionAt(render, "@click=", "Dismiss")(click);
  assert.deepEqual(dismissed, [1]);
  assert.doesNotMatch(page(), /dashboard-action-error/u);
});

test("each host metric shows its value, marks one above 85% and says when the host can't report it", () => {
  const markup = page({ metrics: metrics() });
  const cpu = part(markup, "metric-cpu");
  assert.match(cpu, /42%/u);
  assert.match(cpu, /Load 2\.00 · 1\.50 · 1\.00 · 10 cores/u);
  assert.match(cpu, /aria-valuenow=42/u);
  assert.doesNotMatch(cpu, /dashboard-metric--high/u);
  const memory = part(markup, "metric-memory");
  assert.match(memory, /dashboard-metric--high/u, "94% memory is marked");
  assert.match(memory, /30\.0 GiB of 32\.0 GiB · swap 0 B/u);
  assert.match(part(markup, "metric-disk"), /40%[\s\S]*\/Users\/me\/\.config\/hui/u);
  assert.match(part(markup, "metric-gpu"), /Not available on this host/u);
  assert.match(part(markup, "metric-network"), /Not available on this host/u);
  assert.match(part(markup, "metric-gateway"), /3%[\s\S]*CPU of one core · 200\.0 MiB resident/u);
  const busy = page({ metrics: metrics({ gpu: { percent: 97 }, network: { rxBytesPerSecond: 2048, txBytesPerSecond: 512 } }) });
  assert.match(part(busy, "metric-gpu"), /dashboard-metric--high[\s\S]*97%/u);
  assert.match(part(busy, "metric-network"), /↓\u00a02\u00a0KiB\/s ↑\u00a0512\u00a0B\/s/u);
});

test("a metric is marked high only once it reads above 85%", () => {
  const disk = (usedBytes: number) => part(page({ metrics: metrics({ disk: { path: "/", totalBytes: 1000, usedBytes } }) }), "metric-disk");
  assert.doesNotMatch(disk(850), /dashboard-metric--high/u);
  assert.doesNotMatch(disk(851), /dashboard-metric--high/u, "85.1% reads 85%");
  assert.match(disk(856), /dashboard-metric--high[\s\S]*86%/u);
});

test("a long network value wraps between its rates and a long disk path stays on one line inside its card", () => {
  const path = `/Users/me/${"deep/".repeat(30)}hui`;
  const markup = page({ metrics: metrics({
    network: { rxBytesPerSecond: 999.9 * 1024 ** 4, txBytesPerSecond: 1.2 * 1024 ** 3 },
    disk: { path, totalBytes: 2 * 1024 ** 4, usedBytes: 1024 ** 4 },
  }) });
  assert.match(part(markup, "metric-network"), /__value">↓\u00a0999\.9\u00a0TiB\/s ↑\u00a01\.2\u00a0GiB\/s</u, "the only break opportunity is between the two rates");
  assert.match(part(markup, "metric-disk"), new RegExp(`__detail">1\\.0 TiB of 2\\.0 TiB<span class="dashboard-metric__path" data-hui-tooltip=${path}><span dir="ltr">${path}</span>`, "u"),
    "the path has its own line and its full text in HUI's tooltip");
});

test("the dashboard CSS lays the page out in two columns, wraps its filters and keeps every row inside 360px", () => {
  const css = readFileSync(new URL("../styles/dashboard.css", import.meta.url), "utf8");
  const rule = (selector: string) => css.match(new RegExp(`^${selector.replaceAll(".", "\\.")} \\{([^}]*)\\}`, "mu"))?.[1] ?? "";
  assert.match(rule(".dashboard-page"), /font-size: var\(--text-base\)/u, "values, details and rows follow the text scale");
  assert.match(css, /@media \(min-width: 1200px\) \{\s*\.dashboard-page \{ display: grid; grid-template-columns: minmax\(0, 1\.6fr\) minmax\(0, 1fr\)/u,
    "the sessions column is wider than the activity column from 1200px");
  assert.match(rule(".dashboard-page__activity"), /container-type: inline-size/u, "the metric cards follow their own column");
  assert.match(rule(".dashboard-filters"), /display: flex;[^]*flex-wrap: wrap/u, "the filter bar wraps instead of overflowing");
  assert.match(rule(".dashboard-filters__field"), /flex: 1 1 132px;[^]*min-width: 0/u, "a picker shrinks to its column");
  assert.match(rule(".dashboard-row"), /min-width: 0/u);
  assert.match(rule(".dashboard-row__title-text"), /-webkit-line-clamp: 2;[^]*overflow-wrap: anywhere/u, "a title takes two lines and never widens its row");
  assert.match(rule(".dashboard-row__line"), /overflow-wrap: anywhere/u);
  assert.match(rule(".dashboard-row__actions"), /flex-wrap: wrap/u);
  assert.match(rule(".dashboard-chip"), /display: inline-block;[^]*text-overflow: ellipsis/u, "a chip can show its ellipsis");
  assert.match(rule(".dashboard-metric__value"), /min-width: 0;[^]*overflow-wrap: anywhere/u, "a value wider than its card wraps instead of overflowing");
  assert.match(rule(".dashboard-metric__path"), /overflow: hidden;[^]*direction: rtl;[^]*text-overflow: ellipsis; white-space: nowrap/u, "a long path ends in an ellipsis at its start");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.dashboard-lane\[data-lane="flight"\] \.dashboard-lane__dot \{ animation: none; \} \}/u);
  assert.doesNotMatch(css, /dashboard-summary|dashboard-stage|dashboard-needs-you/u, "the dead status board styles are gone");
  assert.doesNotMatch(css, /backdrop-filter/u, "no lane card composites a blur behind it");
});

test("the activity monitor shows what it read, what it is reading, and why a read failed", () => {
  assert.match(page(), /This gateway[\s\S]*Reading this machine/u);
  const failed = page({ metricsError: "answered 500" });
  assert.match(failed, /Could not read this machine: answered 500/u);
  const stale = page({ metrics: metrics(), metricsError: "answered 500" });
  assert.match(stale, /The last read of this machine failed: answered 500\. Showing the one before\.[\s\S]*Retry/u);
  assert.match(stale, /data-testid=dashboard-metric-cpu/u);
});

test("every machine the operator shows gets its own cards, and one HUI cannot read says why instead", () => {
  const worker = (id: string, overrides: Partial<WorkerMetrics> = {}): WorkerMetrics => ({ id, name: `Worker ${id}`, state: "connected", metrics: metrics(), ...overrides });
  const markup = page({
    metrics: metrics(),
    workers: [
      worker("a"),
      worker("b", { state: "disconnected", metrics: undefined }),
      worker("c", { state: "connected", metrics: undefined, error: "This worker runs an older HUI release." }),
    ],
    workersError: "gateway unreachable",
    chart: chart({ samples: new Map([["a", [metrics(), metrics({ sampledAt: "2026-10-23T12:00:05Z", cpu: { percent: 55, load: [2, 1.5, 1] } })]]]) }),
  });
  const first = block(markup, "Worker a");
  for (const title of ["CPU", "Memory", "Disk", "GPU", "Network", "Host process"]) assert.match(first, new RegExp(title, "u"));
  assert.doesNotMatch(first, /Gateway process/u, "a worker's card names its own host process");
  assert.match(block(markup, "Worker b"), /not connected to this worker/u);
  assert.match(block(markup, "Worker c"), /runs an older HUI release/u);
  assert.match(markup, /Could not read the workers: gateway unreachable/u);
  const names = (text_: string) => [...text_.matchAll(/dashboard-host__name">([^<]+)</gu)].map((match) => match[1]);
  assert.deepEqual(names(page({ metrics: metrics(), workers: [worker("a")] })), ["This gateway", "Worker a"], "this machine comes first");
});

test("the chart draws one line per shown machine, and a hidden one leaves both the chart and the cards", () => {
  const samples = new Map([
    ["gateway", [metrics({ sampledAt: "2026-10-23T11:59:58Z" }), metrics()]],
    ["w", [metrics({ sampledAt: "2026-10-23T11:59:58Z", cpu: { percent: 90, load: [1, 1, 1] } }), metrics({ cpu: { percent: 70, load: [1, 1, 1] } })]],
  ]);
  const workers = [{ id: "w", name: "Worker w", state: "connected" as const, metrics: metrics() }];
  const shown = chartPart(page({ metrics: metrics(), workers, chart: chart({ samples }) }));
  assert.equal(shown.match(/<polyline/gu)?.length, 2, "a line per machine");
  assert.match(shown, /Worker w/u);
  assert.match(shown, /70%/, "the legend carries each machine's latest value");
  assert.match(shown, /aria-label=CPU over the last 5 minutes: This gateway 42%, Worker w 70%\. Arrow keys/u);

  const markup = page({ metrics: metrics(), workers, chart: chart({ samples, hidden: new Set(["w"]) }) });
  assert.equal(chartPart(markup).match(/<polyline/gu)?.length, 1, "the hidden machine is off the chart");
  assert.doesNotMatch(chartPart(markup), /Worker w/u);
  assert.deepEqual([...markup.matchAll(/dashboard-host__name">([^<]+)</gu)].map((match) => match[1]), ["This gateway"], "and its cards are gone too");
  assert.match(page({ metrics: metrics(), chart: chart({ hidden: new Set(["gateway"]) }) }), /Pick a machine to chart\./u);
});

test("a line needs two samples, and the switch says which metric and window it draws", () => {
  const one = new Map([["gateway", [metrics()]]]);
  assert.doesNotMatch(chartPart(page({ metrics: metrics(), chart: chart({ samples: one }) })), /<polyline/u);
  const chartMarkup = chartPart(page({ metrics: metrics(), chart: chart({ metric: "network", window: 15, samples: one }) }));
  assert.match(chartMarkup, /aria-label=Network over the last 15 minutes/u);
  const controls = part(page({ metrics: metrics(), chart: chart({ metric: "network", window: 15 }) }), "activity");
  assert.match(controls, /settings-segmented__btn--active"[^>]*>Network</u, "the metric switch names the metric it draws");
  assert.match(controls, /settings-segmented__btn--active"[^>]*>15m</u, "and the window");
});

test("the reading under the pointer is marked and listed, busiest first, and goes away with the pointer", () => {
  const samples = new Map([
    ["gateway", [metrics({ sampledAt: "2026-10-23T11:58:00Z" }), metrics({ sampledAt: "2026-10-23T11:59:30Z" })]],
    ["w", [metrics({ sampledAt: "2026-10-23T11:58:00Z" }), metrics({ sampledAt: "2026-10-23T11:59:30Z", cpu: { percent: 90, load: [1, 1, 1] } })]],
  ]);
  const workers = [{ id: "w", name: "Worker w", state: "connected" as const, metrics: metrics() }];
  const markup = page({ metrics: metrics(), workers, chart: chart({ samples, hover: Date.parse("2026-10-23T11:59:20Z") }) });
  const tip = markup.slice(markup.indexOf('data-testid="dashboard-chart-tip"'));
  const when = new Date(Date.parse("2026-10-23T11:59:30Z")).toLocaleTimeString();
  assert.match(markup.slice(0, markup.indexOf('data-testid="dashboard-chart-tip"')), /dashboard-chart__crosshair/u, "the crosshair marks the time");
  assert.equal(markup.match(/class="dashboard-chart__dot"/gu)?.length, 2, "a dot per machine at its reading");
  assert.ok(tip.includes(`dashboard-chart__tip-time">${when}<`), "the tooltip names the time under the pointer");
  assert.ok(tip.indexOf("Worker w") < tip.indexOf("This gateway"), "the busiest machine comes first");
  assert.match(tip, /Worker w<strong>90%<\/strong>/u);
  assert.match(tip, /This gateway<strong>42%<\/strong>/u);
  const spoken = markup.slice(markup.indexOf('aria-live="polite"'));
  assert.ok(spoken.startsWith(`aria-live="polite">${when}: Worker w 90%, This gateway 42%`), "and a screen reader hears the same");
  const away = page({ metrics: metrics(), workers, chart: chart({ samples, hover: null }) });
  assert.doesNotMatch(away, /dashboard-chart__crosshair|dashboard-chart-tip/u);
});

/** The chart, its plot and its legend, up to the first machine's cards. */
function chartPart(markup: string): string {
  const start = markup.indexOf('data-testid="dashboard-chart"');
  assert.ok(start >= 0, "chart");
  const next = markup.indexOf('data-testid="dashboard-machine"', start);
  return markup.slice(start, next < 0 ? undefined : next);
}

/** The markup of one `data-testid` element up to the next element with a test id. */
function part(markup: string, id: string): string {
  const start = markup.search(new RegExp(`data-testid="?dashboard-${id}\\b`, "u"));
  assert.ok(start >= 0, id);
  const next = markup.indexOf("data-testid=", start + 1);
  return markup.slice(start, next < 0 ? undefined : next);
}

/** One machine's whole block, found by the name it shows. */
function block(markup: string, name: string): string {
  const start = markup.indexOf(`dashboard-host__name">${name}<`);
  assert.ok(start >= 0, name);
  const from = markup.lastIndexOf('data-testid="dashboard-machine"', start);
  const next = markup.indexOf('data-testid="dashboard-machine"', start);
  return markup.slice(from, next < 0 ? undefined : next);
}
