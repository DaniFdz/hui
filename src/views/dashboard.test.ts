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

test("the sessions section counts statuses and stages and lists what is not idle, urgent first", () => {
  const markup = page({
    groups: [
      { label: "", sessions: [
        session("a", { status: "running", stage: "implementation", updatedAt: "2026-10-23T11:58:00Z" }),
        session("b", { status: "waiting", stage: "testing", worker: { id: "w1", name: "Workspace One" } }),
        session("c"),
        session("d", { status: "error", parentId: "a", subagent: { status: "failed" } as SessionView["subagent"] }),
        session("e", { status: "running", archived: true }),
      ] },
      { label: "Other", sessions: [session("f", { status: "disconnected", stage: "done" })] },
    ],
  });
  const statuses = part(markup, "status-counts");
  assert.match(statuses, /data-key=waiting><strong>1<\/strong><span>Needs input/u);
  assert.match(statuses, /data-key=running><strong>1<\/strong><span>Running/u, "an archived session is not counted");
  assert.match(statuses, /data-key=idle><strong>1<\/strong>/u);
  assert.match(statuses, /dashboard-count--zero" data-key=reconnecting><strong>0/u);
  const stages = part(markup, "stage-counts");
  assert.match(stages, /data-key=investigation><strong>2<\/strong>/u);
  assert.match(stages, /data-key=done><strong>1<\/strong>/u);
  const active = part(markup, "active-sessions");
  assert.deepEqual([...active.matchAll(/Session (\w)/gu)].map((match) => match[1]), ["b", "d", "f", "a"]);
  assert.doesNotMatch(active, /Session [ce]/u);
  assert.match(active, /Session b[\s\S]*Needs input[\s\S]*Testing · Workspace One · updated 5m ago/u);
  assert.match(active, /Session d<\/span><span class="dashboard-session__kind">Subagent/u);
  assert.match(active, /href=\/sessions\/a/u);
  assert.doesNotMatch(active, /Session a<\/span><span class="dashboard-session__kind">/u, "a top-level session has no Subagent mark");
});

test("every idle session reads as such, and the list waits for the first session read", () => {
  assert.match(page({ groups: [{ label: "", sessions: [session("c")] }] }), /Every session is idle\./u);
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
