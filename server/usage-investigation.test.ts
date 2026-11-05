/**
 * The investigation's first turn: what a session or pull request cost, which
 * cheaper histories it can fairly be compared with, and that a target the
 * report does not hold is refused rather than explained from nothing.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { UsageMetrics, UsageReport, UsageSession } from "./api/diagnostics.ts";
import type { SessionRecord } from "./sessions/sessions.ts";
import type { UsageQuery } from "./usage.ts";
import { SESSION_TITLE_MAX } from "./sessions/lifecycle.ts";
import {
  createUsageInvestigation,
  usageInvestigationPlan,
  UsageInvestigationNotFoundError,
} from "./usage-investigation.ts";

function metrics(tokens: number, costUsd: number | null, patch: Partial<UsageMetrics> = {}): UsageMetrics {
  return {
    inputTokens: Math.round(tokens / 2), outputTokens: Math.round(tokens / 10), cacheReadTokens: Math.round(tokens / 3), cacheWriteTokens: 0,
    totalTokens: tokens, costUsd, unpricedCalls: costUsd === null ? 1 : 0, calls: 4, userMessages: 2, assistantMessages: 3, toolResults: 5, errors: 1,
    ...patch,
  };
}

function row(id: string, title: string, value: UsageMetrics, patch: Partial<UsageSession> = {}): UsageSession {
  return {
    id, title, lastActivityAt: 1, metrics: value,
    models: [{ provider: "anthropic", model: "claude-opus-5-5", metrics: value }],
    days: [{ date: "2026-06-02", metrics: value, models: [{ provider: "anthropic", model: "claude-opus-5-5", metrics: value }] }],
    tools: [{ name: "bash", calls: 5, errors: 1, outputChars: 8_000_000 }, { name: "read", calls: 9, errors: 0, outputChars: 1_000 }],
    ...patch,
  };
}

const range = { from: "2026-06-01", to: "2026-06-30", timeZone: "Europe/Madrid" };

function reportOf(sessions: UsageSession[]): UsageReport {
  return {
    generatedAt: "2026-07-01T00:00:00.000Z", range,
    sessions,
    investigations: [],
    coverage: { registeredSessions: sessions.length, readSessions: sessions.length, unavailable: [], undatedRecords: 0 },
    unplacedSpend: { totalTokens: 0, costUsd: 0 },
  };
}

const expensive = row("expensive", "Retry-safe checkout", metrics(46_000_000, 0.84), {
  pullRequests: [{ repository: "acme/web", number: 12, url: "https://github.com/acme/web/pull/12" }],
});
const cheap = row("cheap", "Webhook double charge", metrics(2_000_000, 0.19));
const cheaper = row("cheapest", "Bump the fixture", metrics(200_000, 0.01));
const child = row("child", "Grader subagent", metrics(100_000, 0.01), { parentId: "expensive" });
const other = row("other", "Unrelated release", metrics(1_000_000, 0.05), {
  pullRequests: [{ repository: "acme/docs", number: 7, url: "https://github.com/acme/docs/pull/7" }],
});
const cohorts = new Map([["expensive", "checkout-api"], ["cheap", "checkout-api"], ["cheapest", "checkout-api"], ["other", "release"], ["child", "checkout-api"]]);

test("a session plan lists its recorded spend, its drivers and the cheaper histories with comparable work", () => {
  const plan = usageInvestigationPlan({ report: reportOf([expensive, cheap, cheaper, child, other]), target: { kind: "session", id: "expensive" }, cohorts, checkout: "/work/checkout-api" });
  assert.equal(plan.title, 'Why was "Retry-safe checkout" expensive?');
  for (const text of [
    "0.84", "46M tokens", "2026-06-01 to 2026-06-30 (Europe/Madrid)",
    "`anthropic/claude-opus-5-5`", "`bash` 5 calls, 8M characters, 1 failed", "acme/web#12",
    "Same project (`checkout-api`)", "2 other histories", "median", "Webhook double charge", "Bump the fixture",
    "/work/checkout-api", "What to work out",
  ]) assert.ok(plan.prompt.includes(text), `${text} is in the prompt`);
  assert.ok(!plan.prompt.includes("Unrelated release"), "another project is not the comparison set");
  assert.ok(!plan.prompt.includes("Grader subagent"), "a child session is not a peer");
  const compared = plan.prompt.split("### Cheaper histories that did comparable work")[1] ?? "";
  assert.equal((compared.match(/"Webhook double charge"/gu) ?? []).length, 1, "one history is listed once");
  assert.ok(plan.prompt.indexOf("Bump the fixture") < plan.prompt.indexOf("Webhook double charge"), "cheapest first");
});

test("a session with nothing to compare with says so instead of inventing a baseline", () => {
  const plan = usageInvestigationPlan({ report: reportOf([expensive]), target: { kind: "session", id: "expensive" }, cohorts });
  assert.ok(plan.prompt.includes("All sessions in range"));
  assert.ok(plan.prompt.includes("Nothing else with recorded spend is in range"));
  assert.ok(plan.prompt.includes("no longer on this machine"), "the prompt says what evidence is unreachable");
});

test("an unpriced or partly priced history is described as a lower bound, never as free", () => {
  const unpriced = row("unpriced", "Imported history", metrics(3_000_000, null));
  const plan = usageInvestigationPlan({ report: reportOf([unpriced, cheap]), target: { kind: "session", id: "unpriced" }, cohorts });
  assert.ok(plan.prompt.includes("no recorded price"));
  assert.ok(plan.prompt.includes("1 usage record recorded no price"), "an unpriced record is named");

  const partial = row("partial", "Partly priced", metrics(3_000_000, 0.5, { unpricedCalls: 2 }));
  const plan2 = usageInvestigationPlan({ report: reportOf([partial]), target: { kind: "session", id: "partial" }, cohorts });
  assert.ok(plan2.prompt.includes("$0.50 or more"), "a partial sum is stated as a lower bound");
  assert.ok(plan2.prompt.includes("2 usage records recorded no price"));
});

test("a pull request sums the sessions that created it and compares with the other pull requests", () => {
  const second = row("second", "Fix the webhook race", metrics(1_000_000, 0.25), {
    pullRequests: [{ repository: "acme/web", number: 12, url: "https://github.com/acme/web/pull/12" }],
  });
  const plan = usageInvestigationPlan({ report: reportOf([expensive, second, other]), target: { kind: "pullRequest", repository: "acme/web", number: 12 }, cohorts, checkout: "/work/checkout-api" });
  assert.equal(plan.title, "Why was acme/web#12 expensive?");
  assert.ok(plan.prompt.includes("2 sessions created"));
  assert.ok(plan.prompt.includes("created") && plan.prompt.includes("acme/web/pull/12"), "the pull request the sessions created is named");
  assert.ok(plan.prompt.includes("### Retry-safe checkout"));
  assert.ok(plan.prompt.includes("### Fix the webhook race"));
  assert.ok(plan.prompt.includes("Other pull requests in range"));
  assert.ok(plan.prompt.includes("acme/docs#7"), "a cheaper pull request is the comparison");
  assert.ok(!plan.prompt.includes("counts under each"), "a session with one pull request cannot overlap");
});

test("a target the report does not hold is refused", () => {
  assert.throws(() => usageInvestigationPlan({ report: reportOf([expensive]), target: { kind: "session", id: "missing" }, cohorts }), UsageInvestigationNotFoundError);
  assert.throws(() => usageInvestigationPlan({ report: reportOf([expensive]), target: { kind: "pullRequest", repository: "acme/web", number: 99 }, cohorts }), UsageInvestigationNotFoundError);
});

test("a long session name is cut to the title limit instead of failing creation", () => {
  const long = row("long", `${"word ".repeat(80)}done`, metrics(1_000, 0.01));
  const plan = usageInvestigationPlan({ report: reportOf([long]), target: { kind: "session", id: "long" }, cohorts });
  assert.ok(plan.title.length <= SESSION_TITLE_MAX && plan.title.endsWith("…"), plan.title);
});

test("starting an investigation opens a session in the history's project and sends the plan as its first turn", async () => {
  const created: Record<string, unknown>[] = [];
  const prompted: { id: string; text: string }[] = [];
  const records: SessionRecord[] = [
    { id: "expensive", title: "Retry-safe checkout", group: "checkout-api", cwd: "/work/checkout-api", tool: "durable", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" },
  ];
  const investigation = createUsageInvestigation({
    usage: async (query) => {
      assert.deepEqual(query, { kind: "custom", from: range.from, to: range.to, timeZone: range.timeZone });
      return reportOf([expensive, cheap, cheaper]);
    },
    readRegistry: async () => records,
    liveSessions: { prompt: async (id, text) => { prompted.push({ id, text }); }, status: () => "running" },
    lifecycle: {
      createSession: async (body, _sessions, _updater, _progress, seed) => {
        created.push({ ...body, ...(seed?.investigation ? { investigation: seed.investigation } : {}) });
        return { ...records[0]!, id: "investigation", title: String(body["title"]) } as SessionRecord;
      },
      waitForSessionReady: async () => {},
    },
    views: { toView: (record) => ({ id: record.id, title: record.title, group: record.group, cwd: record.cwd, displayCwd: record.cwd, tool: record.tool, status: "running", stage: "investigation", stageOrigin: "default", createdAt: record.createdAt, updatedAt: record.updatedAt }) },
    directoryExists: async (path) => path === "/work/checkout-api",
    costSkillEnabled: async () => true,
  });
  const view = await investigation.investigate({ target: { kind: "session", id: "expensive" }, range: { from: range.from, to: range.to, timeZone: range.timeZone } });
  assert.equal(view.session.id, "investigation");
  assert.equal(view.existing, false);
  assert.deepEqual(created, [{
    cwd: "/work/checkout-api", title: 'Why was "Retry-safe checkout" expensive?', group: "checkout-api", tool: "durable",
    investigation: { target: { kind: "session", id: "expensive" }, range: { from: "2026-06-01", to: "2026-06-30", timeZone: "Europe/Madrid" } },
  }]);
  assert.equal(prompted[0]?.id, "investigation");
  assert.ok(prompted[0]?.text.startsWith("/skill:cost-investigation"), "the gateway asks the runtime for the method skill");
  assert.ok(prompted[0]?.text.includes("Why was"));
});

test("a disabled method skill is written into the prompt instead of invoked", async () => {
  const prompted: string[] = [];
  const investigation = createUsageInvestigation({
    usage: async () => reportOf([expensive, cheap, cheaper]),
    readRegistry: async () => [{ id: "expensive", title: "Retry-safe checkout", group: "checkout-api", cwd: "/work/checkout-api", tool: "durable", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }],
    liveSessions: { prompt: async (_id, text) => { prompted.push(text); }, status: () => "running" },
    lifecycle: {
      createSession: async () => ({ id: "investigation", title: "x", group: "", cwd: "/work/checkout-api", tool: "durable", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }),
      waitForSessionReady: async () => {},
    },
    views: { toView: (record) => ({ id: record.id, title: record.title, group: record.group, cwd: record.cwd, displayCwd: record.cwd, tool: record.tool, status: "running", stage: "investigation", stageOrigin: "default", createdAt: record.createdAt, updatedAt: record.updatedAt }) },
    directoryExists: async () => true,
    costSkillEnabled: async () => false,
  });
  await investigation.investigate({ target: { kind: "session", id: "expensive" }, range: { from: range.from, to: range.to, timeZone: range.timeZone } });
  assert.ok(!prompted[0]?.startsWith("/skill:"), "no dangling skill command reaches the runtime");
  assert.ok(prompted[0]?.includes("name the cheaper mechanism"), "the method travels with the prompt");
});

test("a target HUI already explained opens that report instead of starting a second one", async () => {
  const created: Record<string, unknown>[] = [];
  const prompted: string[] = [];
  const answered: SessionRecord = {
    id: "answered", title: 'Why was "Retry-safe checkout" expensive?', group: "checkout-api", cwd: "/work/checkout-api",
    tool: "durable", createdAt: "2026-06-04T00:00:00.000Z", updatedAt: "2026-06-04T00:00:00.000Z",
    investigation: {
      target: { kind: "session", id: "expensive" },
      range: { from: "2026-05-01", to: "2026-05-31", timeZone: "UTC" },
    },
  };
  let read: UsageQuery | undefined;
  const investigation = createUsageInvestigation({
    // The page's range holds no row for the target: the existing report still opens.
    usage: async (query) => { read = query; return reportOf([]); },
    readRegistry: async () => [answered],
    liveSessions: { prompt: async (id, text) => { prompted.push(id, text); }, status: () => "idle" },
    lifecycle: {
      createSession: async (body, _sessions, _updater, _progress, seed) => {
        created.push({ ...body, ...(seed?.investigation ? { investigation: seed.investigation } : {}) });
        return answered;
      },
      waitForSessionReady: async () => {},
    },
    views: { toView: (record) => ({ id: record.id, title: record.title, group: record.group, cwd: record.cwd, displayCwd: record.cwd, tool: record.tool, status: "idle", stage: "investigation", stageOrigin: "default", createdAt: record.createdAt, updatedAt: record.updatedAt }) },
    directoryExists: async () => true,
  });
  const answer = await investigation.investigate({ target: { kind: "session", id: "expensive" }, range: { from: range.from, to: range.to, timeZone: range.timeZone } });
  assert.equal(answer.existing, true);
  assert.equal(answer.session.id, "answered");
  assert.deepEqual(created, [], "nothing is created twice");
  assert.deepEqual(prompted, [], "and no second turn is sent");
  assert.equal(read, undefined, "an answered target does not even read the histories again");
});

test("a pull request total says when a session opened several of them, and not when it did not", () => {
  const both = row("both", "Two at once", metrics(1_000_000, 0.5), {
    pullRequests: [
      { repository: "acme/web", number: 12, url: "https://github.com/acme/web/pull/12" },
      { repository: "acme/web", number: 13, url: "https://github.com/acme/web/pull/13" },
    ],
  });
  const plan = usageInvestigationPlan({ report: reportOf([both]), target: { kind: "pullRequest", repository: "acme/web", number: 12 }, cohorts });
  assert.ok(plan.prompt.includes("counts under each, so these totals can overlap"), "the overlap is stated");
  const single = usageInvestigationPlan({ report: reportOf([expensive]), target: { kind: "pullRequest", repository: "acme/web", number: 12 }, cohorts });
  assert.ok(!single.prompt.includes("counts under each"), "a session with one pull request cannot overlap");
});

test("an enabled method skill is invoked instead of restating the method in the prompt", () => {
  const plan = usageInvestigationPlan({ report: reportOf([expensive, cheap, cheaper]), target: { kind: "session", id: "expensive" }, cohorts, costSkill: true });
  assert.ok(plan.prompt.startsWith("/skill:cost-investigation"), "a leading skill command is the one form the runtime expands and removes");
  assert.ok(plan.prompt.includes("## What it recorded"), "the target's own facts stay in the prompt");
  assert.ok(!plan.prompt.includes("name the cheaper mechanism"), "the method comes from the skill, not the prompt");
  assert.ok(!plan.prompt.includes("What to work out"), "the method comes from the skill, not the prompt");

  const fallback = usageInvestigationPlan({ report: reportOf([expensive, cheap, cheaper]), target: { kind: "session", id: "expensive" }, cohorts, costSkill: false });
  assert.ok(!fallback.prompt.includes("/skill:"), "a disabled skill leaves no dangling command");
  assert.ok(fallback.prompt.includes("name the cheaper mechanism"), "the method is written out instead");
});
