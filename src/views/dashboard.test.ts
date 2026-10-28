import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import type { HostMetrics } from "../api/schema/host.ts";
import type { SessionView } from "../api/schema/sessions.ts";
import { HUI_PAGES, availablePages, isPageAvailable } from "../lib/pages.ts";
import { DEFAULT_SETTINGS } from "../lib/settings/settings.ts";
import { renderDashboard, type DashboardProps } from "./dashboard.ts";

/** A template's text with every nested template and value in place; handlers and directives drop out. */
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: readonly unknown[] };
    return template.strings.map((part, index) => part + (index < template.values.length ? text(template.values[index]) : "")).join("");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const NOW = Date.parse("2026-10-23T12:00:00Z");

function session(id: string, overrides: Partial<SessionView> = {}): SessionView {
  return {
    id, title: `Session ${id}`, group: "", cwd: "/work", displayCwd: "~/work", tool: "pi", status: "idle",
    stage: "investigation", stageOrigin: "default", createdAt: "2026-10-23T10:00:00Z", updatedAt: "2026-10-23T11:55:00Z",
    ...overrides,
  };
}

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

function page(overrides: Partial<DashboardProps> = {}): string {
  return text(renderDashboard({
    groups: [], sessionsLoading: false, sessionsError: "", metrics: undefined, history: [], metricsError: "", expandedLists: new Set(), now: NOW,
    onRetry: () => {}, onOpenSession: () => {}, onToggleList: () => {},
    ...overrides,
  }));
}

/** The markup of one `data-testid` element up to the next element with a test id. */
function part(markup: string, id: string): string {
  const start = markup.search(new RegExp(`data-testid="?dashboard-${id}\\b`, "u"));
  assert.ok(start >= 0, id);
  const next = markup.indexOf("data-testid=", start + 1);
  return markup.slice(start, next < 0 ? undefined : next);
}

test("Dashboard is a page only while Labs → Dashboard is on", () => {
  const dashboard = HUI_PAGES.find((entry) => entry.id === "dashboard")!;
  assert.equal(isPageAvailable(dashboard, DEFAULT_SETTINGS.labs), false);
  assert.equal(availablePages(DEFAULT_SETTINGS.labs).some((entry) => entry.id === "dashboard"), false);
  assert.equal(isPageAvailable(dashboard, { ...DEFAULT_SETTINGS.labs, dashboard: true }), true);
  assert.equal(availablePages(DEFAULT_SETTINGS.labs).length, HUI_PAGES.length - 1, "every other page stays");
});

test("the sessions summary counts every status that is present and the pipeline counts every stage", () => {
  const markup = page({
    groups: [
      { label: "", sessions: [
        session("a", { status: "running", stage: "implementation" }),
        session("b", { status: "running", stage: "testing" }),
        session("c"),
        session("d", { status: "error" }),
        session("e", { status: "waiting", archived: true }),
        session("kid", { status: "running", parentId: "a" }),
        session("old-kid", { parentId: "gone" }),
        session("shipped", { stage: "done" }),
      ] },
      { label: "Other", sessions: [session("f", { stage: "done", status: "running" }), session("g", { stage: "done" })] },
    ],
  });
  const summary = part(markup, "summary");
  assert.match(summary, /5 sessions <span class="dashboard-summary__finished">· 2 finished<\/span><\/strong>\s*<span class="dashboard-summary__state dashboard-summary__state--attention">2 need you/u,
    "archived sessions and subagents are not counted, idle sessions in Done are counted apart, and an idle session outside Done needs the operator");
  assert.match(summary, /role="img" aria-label=Sessions by status: 1 Error, 3 Running, 1 Idle>/u);
  assert.deepEqual([...summary.matchAll(/data-status=(\w+) style=flex-grow: (\d)>/gu)].map((match) => `${match[1]} ${match[2]}`), ["error 1", "running 3", "idle 1"]);
  assert.deepEqual([...summary.matchAll(/<\/span>(\d+ [\w ]+)<\/li>/gu)].map((match) => match[1]), ["1 Error", "3 Running", "1 Idle"], "the legend leaves zero statuses out");
  const stages = part(markup, "stage-counts");
  assert.deepEqual([...stages.matchAll(/class="dashboard-stage ([\w-]*)" data-stage=(\w+)><strong>(\d+)/gu)].map((match) => `${match[2]} ${match[3]}${match[1] ? " zero" : ""}`),
    ["investigation 2", "implementation 1", "testing 1", "done 1"], "Done counts only a session still in flight");
  assert.deepEqual([...part(markup, "needs-you").matchAll(/__name" title=[^>]*>Session ([\w-]+)</gu)].map((match) => match[1]), ["c", "d"],
    "every session that stopped outside Done is waiting for the operator");
  assert.deepEqual([...part(markup, "active-sessions").matchAll(/__name" title=[^>]*>Session ([\w-]+)</gu)].map((match) => match[1]).sort(), ["a", "b", "f"],
    "no subagent or finished session is listed");
  assert.match(page({ groups: [{ label: "", sessions: [session("x")] }] }), /dashboard-stage--zero" data-stage=done><strong>0/u);
});

test("a session that stopped anywhere but Done needs you, and the rest of what is in flight is grouped by status", () => {
  const groups = [{ label: "", sessions: [
    session("run", { status: "running", stage: "implementation", updatedAt: "2026-10-23T11:58:00Z" }),
    session("wait", { status: "waiting", stage: "testing", worker: { id: "w1", name: "Workspace One" } }),
    session("child", { status: "running", parentId: "run" }),
    session("done-child", { parentId: "run" }),
    session("err-child", { status: "error", parentId: "err" }),
    session("idle-child", { parentId: "err" }),
    session("start", { status: "starting", pullRequests: [{ repository: "o/r", number: 123, url: "https://github.com/o/r/pull/123", state: "open" }] }),
    session("err", { status: "error" }),
    session("off", { status: "disconnected" }),
    session("idle"),
  ] }];
  const markup = page({ groups });
  assert.match(part(markup, "summary"), /dashboard-summary__state--attention">4 need you/u);
  const needsYou = part(markup, "needs-you");
  assert.match(needsYou, /Needs you <span class="dashboard-subheading__count">4/u);
  assert.match(needsYou, /Session wait<\/span>[\s\S]*5m ago[\s\S]*dashboard-chip--status" data-tone=waiting title=>Needs input<[\s\S]*>Testing<[\s\S]*>Workspace One</u,
    "a waiting session says why and keeps its stage and worker");
  assert.deepEqual([...needsYou.matchAll(/__name" title=[^>]*>Session (\w+)</gu)].map((match) => match[1]), ["wait", "err", "off"],
    "the first three rows are the newest");
  assert.match(needsYou, /Show all 4</u);
  const all = part(page({ groups, expandedLists: new Set(["needs-you"]) }), "needs-you");
  assert.deepEqual([...all.matchAll(/__name" title=[^>]*>Session (\w+)</gu)].map((match) => match[1]), ["wait", "err", "off", "idle"],
    "an error, a disconnect and an idle session outside Done each wait for the operator too");
  assert.match(all, /Session off<[\s\S]*data-tone=disconnected title=>Disconnected</u, "a disconnect reads differently from an error");
  assert.match(all, /Session idle<[\s\S]*data-tone=idle title=>Idle</u, "a parked session says it is idle");
  assert.match(all, /Session err<[^]*?dashboard-chip--subagent" data-tone= title=>2 subagents · 1 running<[^]*?Session off</u);
  assert.ok(markup.indexOf("dashboard-needs-you") < markup.indexOf("dashboard-stage-counts"), "Needs you sits above the pipeline");
  const active = part(markup, "active-sessions");
  assert.deepEqual([...active.matchAll(/<h3 class="dashboard-subheading">(\w+) <span class="dashboard-subheading__count">(\d)/gu)].map((match) => `${match[1]} ${match[2]}`),
    ["Running 1", "Starting 1"], "empty groups are left out and a subagent is no row");
  assert.deepEqual([...active.matchAll(/__name" title=[^>]*>Session (\w+)</gu)].map((match) => match[1]), ["run", "start"]);
  assert.doesNotMatch(active, /dashboard-chip--status/u, "a single-status group needs no status chip");
  assert.match(active, /Session run<[^]*?>2 subagents · 1 running<[^]*?Session start/u);
  assert.match(active, /Session start<[\s\S]*dashboard-chip--pr" data-tone=open title=Pull request o\/r#123, open>#123 Open</u);
  assert.doesNotMatch(active.slice(active.indexOf("Session start")), /subagent/u, "a session without subagents has no subagent chip");
  const quiet = part(page({ groups: [{ label: "", sessions: [session("p", { status: "running" }), session("k", { parentId: "p" })] }] }), "active-sessions");
  assert.match(quiet, />1 subagent</u, "no running count when every subagent is idle");
  assert.match(active, /href=\/sessions\/run/u);
});

test("each list shows three rows and a button that shows all of them, and every count stays a total", () => {
  const many = (prefix: string, status: SessionView["status"], count: number) =>
    Array.from({ length: count }, (_, index) => session(`${prefix}${index}`, { status, updatedAt: `2026-10-23T11:5${9 - index}:00Z` }));
  const groups = [{ label: "", sessions: [...many("w", "waiting", 4), ...many("r", "running", 5), ...many("e", "error", 5), ...many("s", "starting", 3)] }];
  const names = (markup: string) => [...markup.matchAll(/__name" title=[^>]*>Session (\w+)</gu)].map((match) => match[1]);
  const button = (markup: string) => markup.match(/<button class="dashboard-more"[^>]*>[^<]*/u)?.[0];
  const sections = (markup: string) => Object.fromEntries(["Running", "Starting"].map((label) => {
    const active = part(markup, "active-sessions");
    const start = active.indexOf(`>${label} <`);
    const end = active.indexOf("<h3", start);
    return [label, active.slice(start, end < 0 ? undefined : end)];
  }));

  const collapsed = page({ groups });
  assert.match(part(collapsed, "summary"), /17 sessions/u);
  assert.match(part(collapsed, "needs-you"), /Needs you <span class="dashboard-subheading__count">9/u, "the error sessions wait for the operator too, so they are in Needs you");
  assert.deepEqual(names(part(collapsed, "needs-you")), ["w0", "e0", "w1"]);
  assert.equal(button(part(collapsed, "needs-you")), `<button class="dashboard-more" type="button" aria-controls=dashboard-list-needs-you aria-expanded=false @click=>Show all 9`);
  assert.match(part(collapsed, "needs-you"), /<ul id=dashboard-list-needs-you /u);
  const closed = sections(collapsed);
  assert.match(closed.Running!, /^>Running <span class="dashboard-subheading__count">5/u, "a heading counts every row, not the shown ones");
  assert.deepEqual(names(closed.Running!), ["r0", "r1", "r2"]);
  assert.equal(button(closed.Running!), `<button class="dashboard-more" type="button" aria-controls=dashboard-list-running aria-expanded=false @click=>Show all 5`);
  assert.match(closed.Running!, /<ul id=dashboard-list-running /u);
  assert.deepEqual(names(closed.Starting!), ["s0", "s1", "s2"]);
  assert.equal(button(closed.Starting!), undefined, "a list of three has nothing to show");

  const expanded = page({ groups, expandedLists: new Set(["running"]) });
  const open = sections(expanded);
  assert.deepEqual(names(open.Running!), ["r0", "r1", "r2", "r3", "r4"]);
  assert.equal(button(open.Running!), `<button class="dashboard-more" type="button" aria-controls=dashboard-list-running aria-expanded=true @click=>Show fewer`);
  assert.equal(button(part(expanded, "needs-you")), `<button class="dashboard-more" type="button" aria-controls=dashboard-list-needs-you aria-expanded=false @click=>Show all 9`, "opening one list leaves the others folded");
  assert.deepEqual(names(part(expanded, "needs-you")), ["w0", "e0", "w1"]);
  assert.match(part(expanded, "summary"), /17 sessions/u);
  assert.match(open.Running!, /^>Running <span class="dashboard-subheading__count">5/u);
});

test("an idle session that is not finished needs you, and the list waits for the first session read", () => {
  const idle = page({ groups: [{ label: "", sessions: [session("c")] }] });
  assert.match(idle, /1 session<\/strong>/u);
  assert.match(idle, /1 needs you/u);
  assert.match(part(idle, "needs-you"), /Session c<[\s\S]*data-tone=idle title=>Idle</u, "a parked session is all the page has to offer the operator");
  assert.doesNotMatch(idle, /data-testid="dashboard-active-sessions"/u);
  assert.match(page({ sessionsLoading: true }), /Reading sessions…/u);
  const none = page();
  assert.match(none, /0 sessions<\/strong>/u);
  assert.match(none, /No sessions yet\./u);
  const finished = page({ groups: [{ label: "", sessions: [session("a", { stage: "done" }), session("b", { stage: "done" }), session("k", { parentId: "a", status: "running" })] }] });
  assert.match(finished, /No sessions in flight <span class="dashboard-summary__finished">· 2 finished<\/span><\/strong>/u);
  assert.doesNotMatch(finished, /No sessions yet|data-testid="dashboard-(needs-you|active-sessions)"/u);
  assert.match(finished, /dashboard-summary__state ">Nothing needs you/u, "two finished sessions and a busy subagent leave nothing for the operator");
});

test("each host metric shows its value, marks one above 85% and says when the host can't report it", () => {
  const markup = page({ metrics: metrics(), history: [metrics({ cpu: { percent: 10, load: [1, 1, 1] } }), metrics()] });
  const cpu = part(markup, "metric-cpu");
  assert.match(cpu, /42%/u);
  assert.match(cpu, /Load 2\.00 · 1\.50 · 1\.00 · 10 cores/u);
  assert.match(cpu, /aria-valuenow=42/u);
  assert.match(cpu, /<polyline points=0\.0,21\.8 100\.0,14\.8>/u, "the sparkline draws the kept samples");
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

test("a long network value wraps between its rates and a long disk path stays on one line inside its card", () => {
  const path = `/Users/me/${"deep/".repeat(30)}hui`;
  const markup = page({ metrics: metrics({
    network: { rxBytesPerSecond: 999.9 * 1024 ** 4, txBytesPerSecond: 1.2 * 1024 ** 3 },
    disk: { path, totalBytes: 2 * 1024 ** 4, usedBytes: 1024 ** 4 },
  }) });
  assert.match(part(markup, "metric-network"), /__value">↓\u00a0999\.9\u00a0TiB\/s ↑\u00a01\.2\u00a0GiB\/s</u, "the only break opportunity is between the two rates");
  assert.match(part(markup, "metric-disk"), new RegExp(`__detail">1\\.0 TiB of 2\\.0 TiB<span class="dashboard-metric__path" title=${path}><span dir="ltr">${path}</span>`, "u"),
    "the path has its own line and its full text in the tooltip");
  const css = readFileSync(new URL("../styles/dashboard.css", import.meta.url), "utf8");
  const rule = (selector: string) => css.match(new RegExp(`^${selector.replaceAll(".", "\\.")} \\{([^}]*)\\}`, "mu"))?.[1] ?? "";
  assert.doesNotMatch(rule(".dashboard-metric__value"), /nowrap/u, "a value wider than its card wraps instead of overflowing");
  assert.match(rule(".dashboard-metric__value"), /min-width: 0;[^]*overflow-wrap: anywhere/u);
  assert.match(rule(".dashboard-metric__path"), /overflow: hidden;[^]*direction: rtl;[^]*text-overflow: ellipsis; white-space: nowrap/u, "a long path ends in an ellipsis at its start");
  assert.match(rule(".dashboard-chip"), /display: inline-block;[^]*text-overflow: ellipsis/u, "a chip can show its ellipsis");
  assert.match(rule(".dashboard-page"), /font-size: var\(--text-base\)/u, "values, details and rows follow the text scale");
});

test("a metric is marked high only once it reads above 85%", () => {
  const disk = (usedBytes: number) => part(page({ metrics: metrics({ disk: { path: "/", totalBytes: 1000, usedBytes } }) }), "metric-disk");
  assert.doesNotMatch(disk(850), /dashboard-metric--high/u);
  assert.doesNotMatch(disk(851), /dashboard-metric--high/u, "85.1% reads 85%");
  assert.match(disk(856), /dashboard-metric--high[\s\S]*86%/u);
});

test("a session row keeps its full title and worker in tooltips and drops a time it can't read", () => {
  const title = "A".repeat(200);
  const worker = { id: "w", name: "workspace-with-a-very-long-name-in-us1-staging" };
  const active = part(page({ groups: [{ label: "", sessions: [
    session("broken", { status: "running", updatedAt: "not a date" }),
    session("long", { status: "running", title, worker }),
  ] }] }), "active-sessions");
  assert.match(active, new RegExp(`__name" title=${title}>${title}<`, "u"));
  assert.match(active, new RegExp(`dashboard-chip--worker" data-tone= title=${worker.name}>${worker.name}<`, "u"));
  assert.deepEqual([...active.matchAll(/__name" title=([^>]+)>/gu)].map((match) => match[1]), [title, "Session broken"], "an unreadable time sorts last");
  assert.doesNotMatch(active, /NaN/u);
  assert.equal(active.match(/<time /gu)?.length, 1);
});

test("the host section shows its loading and error states", () => {
  assert.match(page(), /Reading the host's metrics…/u);
  const failed = page({ metricsError: "answered 500" });
  assert.match(failed, /Could not read the host's metrics: answered 500[\s\S]*Retry/u);
  assert.doesNotMatch(failed, /Reading the host's metrics…/u);
  const stale = page({ metrics: metrics(), metricsError: "answered 500" });
  assert.match(stale, /The last read failed: answered 500\. Showing the one before\./u);
  assert.match(stale, /data-testid="dashboard-metrics"/u);
});
