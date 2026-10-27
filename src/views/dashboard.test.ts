import assert from "node:assert/strict";
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
    groups: [], sessionsLoading: false, sessionsError: "", metrics: undefined, history: [], metricsError: "", now: NOW,
    onRetry: () => {}, onOpenSession: () => {},
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
      ] },
      { label: "Other", sessions: [session("f", { stage: "done" })] },
    ],
  });
  const summary = part(markup, "summary");
  assert.match(summary, /5 sessions<\/strong>\s*<span class="dashboard-summary__state ">Nothing needs you/u, "an archived session is not counted");
  assert.match(summary, /role="img" aria-label=Sessions by status: 1 Error, 2 Running, 2 Idle>/u);
  assert.deepEqual([...summary.matchAll(/data-status=(\w+) style=flex-grow: (\d)>/gu)].map((match) => `${match[1]} ${match[2]}`), ["error 1", "running 2", "idle 2"]);
  assert.deepEqual([...summary.matchAll(/<\/span>(\d+ [\w ]+)<\/li>/gu)].map((match) => match[1]), ["1 Error", "2 Running", "2 Idle"], "the legend leaves zero statuses out");
  const stages = part(markup, "stage-counts");
  assert.deepEqual([...stages.matchAll(/class="dashboard-stage ([\w-]*)" data-stage=(\w+)><strong>(\d+)/gu)].map((match) => `${match[2]} ${match[3]}${match[1] ? " zero" : ""}`),
    ["investigation 2", "implementation 1", "testing 1", "done 1"]);
  assert.match(page({ groups: [{ label: "", sessions: [session("x")] }] }), /dashboard-stage--zero" data-stage=done><strong>0/u);
});

test("waiting sessions come first under Needs you, then the rest of what is not idle grouped by status", () => {
  const markup = page({
    groups: [{ label: "", sessions: [
      session("run", { status: "running", stage: "implementation", updatedAt: "2026-10-23T11:58:00Z" }),
      session("wait", { status: "waiting", stage: "testing", worker: { id: "w1", name: "Workspace One" } }),
      session("child", { status: "running", parentId: "run", pullRequests: [{ repository: "o/r", number: 123, url: "https://github.com/o/r/pull/123", state: "open" }] }),
      session("orphan", { status: "starting", parentId: "gone" }),
      session("err", { status: "error" }),
      session("off", { status: "disconnected" }),
      session("idle"),
    ] }],
  });
  assert.match(part(markup, "summary"), /dashboard-summary__state--attention">1 needs you/u);
  const needsYou = part(markup, "needs-you");
  assert.match(needsYou, /Needs you <span class="dashboard-subheading__count">1/u);
  assert.match(needsYou, /Session wait<\/span>[\s\S]*5m ago[\s\S]*>Testing<[\s\S]*>Workspace One</u);
  assert.ok(markup.indexOf("dashboard-needs-you") < markup.indexOf("dashboard-stage-counts"), "Needs you sits above the pipeline");
  const active = part(markup, "active-sessions");
  assert.deepEqual([...active.matchAll(/<h3 class="dashboard-subheading">(\w+) <span class="dashboard-subheading__count">(\d)/gu)].map((match) => `${match[1]} ${match[2]}`),
    ["Errors 2", "Running 2", "Starting 1"], "empty groups are left out");
  assert.deepEqual([...active.matchAll(/__name">Session (\w+)</gu)].map((match) => match[1]), ["err", "off", "run", "child", "orphan"]);
  assert.match(active, /Session off<[\s\S]*dashboard-chip--status" data-tone= title=>Disconnected/u, "the Errors group tells an error from a disconnect");
  assert.doesNotMatch(active.slice(active.indexOf("Running")), /dashboard-chip--status/u, "a single-status group needs no status chip");
  assert.match(active, /Session child<[\s\S]*>Subagent of Session run<[\s\S]*dashboard-chip--pr" data-tone=open title=Pull request o\/r#123, open>#123 Open</u);
  assert.match(active, /Session orphan<[\s\S]*>Subagent</u, "a subagent whose parent is not listed is still marked");
  assert.doesNotMatch(active, /Session run<\/span>[^]*?Subagent[^]*?Session child/u, "a top-level session has no Subagent mark");
  assert.match(active, /href=\/sessions\/run/u);
  assert.doesNotMatch(markup, /Session idle</u);
});

test("every idle session reads as such, and the list waits for the first session read", () => {
  const idle = page({ groups: [{ label: "", sessions: [session("c")] }] });
  assert.match(idle, /Every session is idle\./u);
  assert.match(idle, /1 session<\/strong>/u);
  assert.doesNotMatch(idle, /data-testid="dashboard-(needs-you|active-sessions)"/u);
  assert.match(page({ sessionsLoading: true }), /Reading sessions…/u);
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
  assert.match(part(busy, "metric-network"), /↓ 2 KiB\/s ↑ 512 B\/s/u);
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
