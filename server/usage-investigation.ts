/**
 * "Why was this expensive?": the prompt a new session reads to explain one
 * session's or one pull request's recorded spend, and the session that runs it.
 *
 * The prompt carries what the Usage report measured — totals, the models and
 * tools that produced them, cache health, the costliest days and the pull
 * requests the history created — beside the same numbers for the cheaper
 * histories it can fairly be compared with. HUI's report holds no message
 * content, so the prompt says what it cannot see and sends the agent to the
 * checkout for evidence instead of inventing a cause.
 */
import type { UsageInvestigationRequest, UsageMetrics, UsageReport, UsageSession } from "./api/diagnostics.ts";
import type { SessionView } from "./api/sessions.ts";
import type { PullRequestRef } from "./integrations/pull-requests.ts";
import { SESSION_TITLE_MAX, defaultSessionTool, type createSessionLifecycle } from "./sessions/lifecycle.ts";
import type { liveSessions } from "./sessions/live-sessions.ts";
import { readRegistry, type SessionRecord } from "./sessions/sessions.ts";
import type { createSessionViews } from "./sessions/views.ts";
import { usageQuery, UsageQueryError, type UsageQuery } from "./usage.ts";

/** A target the report does not hold: a session outside the range, or a pull request none of them created. */
export class UsageInvestigationNotFoundError extends Error {
  override name = "UsageInvestigationNotFoundError";
}

/** A range or a target this gateway cannot act on. */
export class UsageInvestigationInputError extends Error {
  override name = "UsageInvestigationInputError";
}

export type UsageInvestigationTarget = UsageInvestigationRequest["target"];

/** What a started investigation reads, and what it becomes. */
export type UsageInvestigationDeps = {
  usage(query: UsageQuery): Promise<UsageReport>;
  readRegistry: typeof readRegistry;
  liveSessions: Pick<typeof liveSessions, "prompt" | "status">;
  lifecycle: Pick<ReturnType<typeof createSessionLifecycle>, "createSession" | "waitForSessionReady">;
  views: Pick<ReturnType<typeof createSessionViews>, "toView">;
  /** Whether a directory still exists, so a removed checkout never blocks the new session. */
  directoryExists(path: string): Promise<boolean>;
  /** Whether HUI's bundled method skill is enabled; when it is off, the prompt carries the method itself. */
  costSkillEnabled?: () => Promise<boolean>;
  defaultSessionTool?: () => string;
};
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const integers = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** Cheaper rows listed per comparison, so the prompt stays bounded. */
const COMPARED = 3;

/** The spend a comparison uses: recorded cost when one exists, recorded tokens otherwise. */
function weight(row: Pick<UsageSession, "metrics">): number {
  return row.metrics.costUsd ?? row.metrics.totalTokens;
}

function messages(row: Pick<UsageSession, "metrics">): number {
  return row.metrics.userMessages + row.metrics.assistantMessages;
}

function money(metrics: Pick<UsageMetrics, "costUsd" | "unpricedCalls">): string {
  // Read as "$0.41 or more" in a sentence, never as "at $0.41" plus a qualifier.
  return metrics.costUsd === null ? "no recorded price" : `${usd.format(metrics.costUsd)}${metrics.unpricedCalls ? " or more" : ""}`;
}

const count = (value: number): string => integers.format(value);
const plural = (value: number, one: string, many = `${one}s`): string => `${count(value)} ${value === 1 ? one : many}`;
const tokens = (value: number): string => compact.format(value);
const share = (part: number, total: number): string => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "0%");
const times = (ratio: number): string => (ratio >= 10 ? `${Math.round(ratio)}×` : `${ratio.toFixed(1)}×`);

function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function sumMetrics(rows: readonly UsageMetrics[]): UsageMetrics {
  const total: UsageMetrics = {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
    costUsd: rows.some((row) => row.costUsd !== null) ? 0 : null, unpricedCalls: 0,
    calls: 0, userMessages: 0, assistantMessages: 0, toolResults: 0, errors: 0,
  };
  for (const row of rows) {
    for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "unpricedCalls", "calls", "userMessages", "assistantMessages", "toolResults", "errors"] as const) {
      total[key] += row[key];
    }
    if (row.costUsd !== null) total.costUsd = (total.costUsd ?? 0) + row.costUsd;
  }
  return total;
}

/** What one history recorded, as the prompt lists it. */
function profile(row: UsageSession): string[] {
  const metrics = row.metrics;
  const lines = [
    `- Cost and tokens: ${money(metrics)}, ${tokens(metrics.totalTokens)} tokens over ${count(metrics.calls)} usage records.`,
    `  Input ${tokens(metrics.inputTokens)} · output ${tokens(metrics.outputTokens)} · cache read ${tokens(metrics.cacheReadTokens)} · cache write ${tokens(metrics.cacheWriteTokens)}.`,
    `- Messages: ${count(messages(row))} (${count(metrics.userMessages)} user, ${count(metrics.assistantMessages)} assistant), ${plural(metrics.toolResults, "tool result")}, ${plural(metrics.errors, "error")}.`,
    `- Cache: ${share(metrics.cacheReadTokens, metrics.inputTokens + metrics.cacheReadTokens + metrics.cacheWriteTokens)} of read input came from the prompt cache.`,
  ];
  if (metrics.assistantMessages > 0 && metrics.costUsd !== null) lines.push(`- Cost per assistant message: ${usd.format(metrics.costUsd / metrics.assistantMessages)}.`);
  if (metrics.unpricedCalls > 0) lines.push(`- ${plural(metrics.unpricedCalls, "usage record")} recorded no price, so any cost above is a lower bound.`);
  if (row.models.length) {
    lines.push(`- Models: ${row.models.map(({ provider, model, metrics: byModel }) => `\`${provider}/${model}\` ${money(byModel)} · ${tokens(byModel.totalTokens)} tokens`).join("; ")}.`);
  }
  if (row.tools.length) {
    const byOutput = [...row.tools].toSorted((left, right) => right.outputChars - left.outputChars || right.calls - left.calls);
    lines.push(`- Tools by output: ${byOutput.slice(0, 5).map((tool) => `\`${tool.name}\` ${plural(tool.calls, "call")}, ${tokens(tool.outputChars)} characters${tool.errors ? `, ${count(tool.errors)} failed` : ""}`).join("; ")}.`);
  }
  const days = [...row.days].toSorted((left, right) => (right.metrics.costUsd ?? right.metrics.totalTokens) - (left.metrics.costUsd ?? left.metrics.totalTokens));
  if (days.length) lines.push(`- Costliest days: ${days.slice(0, 3).map((day) => `${day.date} ${money(day.metrics)} (${tokens(day.metrics.totalTokens)} tokens)`).join("; ")}.`);
  if (row.pullRequests?.length) lines.push(`- Pull requests it created: ${row.pullRequests.map((ref) => `${ref.repository}#${ref.number}`).join(", ")}.`);
  return lines;
}

/** One comparison row: what another history cost, in the same words as the target. */
function compared(row: UsageSession): string {
  return `- "${row.title}" — ${money(row.metrics)}, ${tokens(row.metrics.totalTokens)} tokens, ${plural(messages(row), "message")}, ${plural(row.metrics.toolResults, "tool result")}, ${plural(row.metrics.errors, "error")}`;
}

/**
 * A history's comparison set: its own project first, because a cheap lookup and
 * an expensive refactor are not the same work, and the whole range when that
 * project has nothing else in it.
 */
function comparison(target: UsageSession, others: readonly UsageSession[], label: string): string[] {
  const lines = [`## ${label}`];
  if (!others.length) return [...lines, "- Nothing else with recorded spend is in range, so there is no cheaper history to compare with."];
  const costs = others.flatMap((row) => (row.metrics.costUsd === null ? [] : [row.metrics.costUsd]));
  const medianCost = median(costs);
  const targetCost = target.metrics.costUsd;
  lines.push(`- ${plural(others.length, "other history", "other histories")}: median ${medianCost === undefined ? "no recorded price" : usd.format(medianCost)} and ${tokens(median(others.map((row) => row.metrics.totalTokens)) ?? 0)} tokens.`);
  if (medianCost !== undefined && medianCost > 0 && targetCost !== null) lines.push(`- This one cost ${times(targetCost / medianCost)} that median.`);
  const perMessage = (row: UsageSession): number | undefined => (row.metrics.costUsd === null || messages(row) === 0 ? undefined : row.metrics.costUsd / messages(row));
  const targetPerMessage = perMessage(target);
  const medianPerMessage = median(others.flatMap((row) => perMessage(row) ?? []));
  if (targetPerMessage !== undefined && medianPerMessage !== undefined && medianPerMessage > 0) {
    lines.push(`- Cost per message is ${usd.format(targetPerMessage)} against a median of ${usd.format(medianPerMessage)} (${times(targetPerMessage / medianPerMessage)}).`);
  }
  const medianMessages = median(others.map(messages));
  if (medianMessages !== undefined && messages(target) > 0) lines.push(`- It recorded ${count(messages(target))} messages against a median of ${count(medianMessages)}.`);

  const cheaper = others.filter((row) => weight(row) < weight(target)).toSorted((left, right) => weight(left) - weight(right));
  const shown: UsageSession[] = [];
  if (cheaper.length) {
    // A fairer pair than the cheapest of everything: rows that did a comparable
    // amount of work and still cost less.
    const similar = cheaper.filter((row) => messages(row) >= messages(target) / 2 && messages(row) <= messages(target) * 2);
    shown.push(...(similar.length ? similar : [...cheaper].toSorted((left, right) => Math.abs(messages(left) - messages(target)) - Math.abs(messages(right) - messages(target)))).slice(0, COMPARED));
    lines.push("### Cheaper histories that did comparable work", ...shown.map(compared));
  }
  // The cheapest of the rest, never the same row twice.
  const cheapest = [...others].filter((row) => !shown.includes(row)).toSorted((left, right) => weight(left) - weight(right)).slice(0, COMPARED);
  if (cheapest.length) lines.push("### Cheapest in the same range", ...cheapest.map(compared));
  return lines;
}

function workLines(checkout: string): string[] {
  return [
    "## What to work out",
    "HUI measures volume, not intent: a turn that re-reads one file, a command that prints megabytes, a model priced far above the work it did, or a loop that retries a failing tool all show up here only as tokens.",
    "1. Name the two or three drivers the numbers point to, each with the number that supports it.",
    checkout
      ? `2. Confirm what you can instead of assuming: this session opens in the history's own checkout (${checkout}), so its branch, \`git log\`, \`git status\` and changed files show what that work was doing.`
      : "2. Confirm what you can instead of assuming: the history's checkout is no longer on this machine, so work from the numbers and ask for the conversation if one turn matters.",
    "3. For each driver, name the cheaper mechanism, not just \"be careful\":",
    "   - Context: route a bulk read or a noisy command to a subagent and keep only its summary, or narrow the command itself (`| head -n 200`); compact before the window fills; brief a fresh subagent instead of resuming a long one.",
    "   - Model and effort: send exploration and routine edits to a cheaper model or a lower thinking level, and keep the strongest model for the hard judgment calls.",
    "   - Structure: when a correction would apply to every session (a build flag, a lint, a test, a line in `AGENTS.md`), encode it once rather than restating it in each prompt.",
    "   - Workflow: when the same multi-step work keeps coming back, write it down as a skill the next session can invoke, so it is not re-derived from scratch.",
    "4. Finish with a table of driver → mechanism → what it saves, split into what would have helped this session and what would help every session.",
    "5. Record the one to three follow-ups that would have prevented the cost as suggestion cards (`suggest_task`): a lint, test or check; a skill for recurring work; a refactor of the service that forced the extra turns; or service instructions in `AGENTS.md`. One card per change, and only for a concrete change.",
    "Do not change code unless asked: this session exists to explain the cost.",
  ];
}

/** The title and first turn of the investigation session. Its directory and
 * project come from the registry, which knows what still exists. */
export type UsageInvestigationPlan = { title: string; prompt: string };

export type UsageInvestigationPlanInput = {
  report: UsageReport;
  target: UsageInvestigationTarget;
  /** Each registered session's project, so a comparison stays within comparable work. */
  cohorts: ReadonlyMap<string, string>;
  /** The directory the new session opens in; empty when no candidate exists any more. */
  checkout?: string;
  /** Whether HUI's bundled method skill is enabled, so the prompt can invoke it instead of restating it. */
  costSkill?: boolean;
};

function titleOf(title: string): string {
  return title.length <= SESSION_TITLE_MAX ? title : `${title.slice(0, SESSION_TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * Builds the investigation's first turn from recorded numbers only. A target
 * no row holds is refused rather than explained from nothing.
 */
export function usageInvestigationPlan({ report, target, cohorts, checkout = "", costSkill = false }: UsageInvestigationPlanInput): UsageInvestigationPlan {
  if (target.kind === "pullRequest") return pullRequestPlan(report, target, checkout, costSkill);
  const row = report.sessions.find((session) => session.id === target.id);
  if (!row) throw new UsageInvestigationNotFoundError(`Session ${target.id} recorded nothing between ${report.range.from} and ${report.range.to}.`);
  const project = cohorts.get(row.id) ?? "";
  // A child session's spend belongs to the work its parent started, so it is
  // never another history's peer.
  const peers = report.sessions.filter((each) => each.id !== row.id && !each.parentId);
  const others = project ? peers.filter((each) => cohorts.get(each.id) === project) : [];
  const range = `${report.range.from} to ${report.range.to} (${report.range.timeZone})`;
  const prompt = [
    // A leading /skill: is the one form the runtime removes; the skill block it
    // expands to leads the turn, and the facts follow it.
    ...(costSkill ? ["/skill:cost-investigation"] : []),
    `# Why was "${row.title}" expensive?`,
    `HUI's Usage report estimates this session at ${money(row.metrics)} and ${tokens(row.metrics.totalTokens)} tokens between ${range}, from PI's recorded usage. It reads the conversation's numbers, not its messages.`,
    ["## What it recorded", ...profile(row)].join("\n"),
    ...comparison(row, others.length ? others : peers, others.length ? `Same project (\`${project}\`)` : "All sessions in range"),
    ...(costSkill ? [] : workLines(checkout)),
  ].join("\n\n");
  return { title: titleOf(`Why was "${row.title}" expensive?`), prompt };
}

function pullRequestPlan(report: UsageReport, target: Extract<UsageInvestigationTarget, { kind: "pullRequest" }>, checkout: string, costSkill: boolean): UsageInvestigationPlan {
  const name = `${target.repository}#${target.number}`;
  const rows = report.sessions.filter((row) => row.pullRequests?.some((ref) => ref.repository === target.repository && ref.number === target.number));
  if (!rows.length) throw new UsageInvestigationNotFoundError(`No session in ${report.range.from} to ${report.range.to} created ${name}.`);
  const total = sumMetrics(rows.map((row) => row.metrics));
  // The total is the sessions' recorded spend, so a session that opened more
  // than one pull request is counted under each of them.
  const shared = rows.some((row) => (row.pullRequests?.length ?? 0) > 1) ? " A session that created more than one pull request counts under each, so these totals can overlap." : "";
  const range = `${report.range.from} to ${report.range.to} (${report.range.timeZone})`;
  const pullRequests = pullRequestSums(report);
  const url = `https://github.com/${target.repository}/pull/${target.number}`;
  const others = [...pullRequests.values()].filter((each) => each.id !== name.toLowerCase());
  const prompt = [
    ...(costSkill ? ["/skill:cost-investigation"] : []),
    `# Why was \`${name}\` expensive?`,
    `${count(rows.length)} ${rows.length === 1 ? "session" : "sessions"} created ${url} and HUI estimates they cost ${money(total)} and ${tokens(total.totalTokens)} tokens between ${range}, from PI's recorded usage.${shared}`,
    ["## The sessions behind it", ...rows.toSorted((left, right) => weight(right) - weight(left)).flatMap((row) => [`### ${row.title}`, `Session \`${row.id}\`.`, ...profile(row)])].join("\n"),
    ...comparison({ id: name, title: name, lastActivityAt: 0, metrics: total, days: [], models: [], tools: [] }, others, "Other pull requests in range"),
    ...(costSkill ? [] : workLines(checkout)),
  ].join("\n\n");
  return { title: titleOf(`Why was ${name} expensive?`), prompt };
}

/** Every pull request any session in the report created, summed over the sessions that created it. */
function pullRequestSums(report: UsageReport): Map<string, UsageSession> {
  const grouped = new Map<string, { ref: PullRequestRef; metrics: UsageMetrics[] }>();
  for (const row of report.sessions) {
    for (const ref of row.pullRequests ?? []) {
      const key = `${ref.repository}#${ref.number}`.toLowerCase();
      const held = grouped.get(key) ?? { ref, metrics: [] };
      held.metrics.push(row.metrics);
      grouped.set(key, held);
    }
  }
  return new Map([...grouped].map(([key, { ref, metrics }]) => [key, {
    id: key, title: `${ref.repository}#${ref.number}`, lastActivityAt: 0,
    metrics: sumMetrics(metrics), days: [], models: [], tools: [],
  } satisfies UsageSession]));
}

/** One key per target, so the page, the route and the registry agree on what "already investigated" means. */
export function investigationTargetKey(target: { kind: "session"; id: string } | { kind: "pullRequest"; repository: string; number: number }): string {
  return target.kind === "session" ? `session:${target.id}` : `pullRequest:${target.repository.toLowerCase()}#${target.number}`;
}

/** Reads the report the page showed and starts one session in the target's own project. */
export function createUsageInvestigation(deps: UsageInvestigationDeps) {
  const { usage, readRegistry: registry, liveSessions, lifecycle, views } = deps;
  const defaultTool = deps.defaultSessionTool ?? defaultSessionTool;

  async function firstCheckout(records: readonly SessionRecord[]): Promise<string> {
    for (const record of records) {
      if (record.worker) continue;
      if (record.cwd && await deps.directoryExists(record.cwd)) return record.cwd;
    }
    return "";
  }

  async function investigate(request: UsageInvestigationRequest): Promise<{ session: SessionView; existing: boolean }> {
    let query: UsageQuery;
    try {
      query = usageQuery(new URLSearchParams({
        timeZone: request.range.timeZone,
        ...(request.range.from === undefined ? {} : { from: request.range.from }),
        ...(request.range.to === undefined ? {} : { to: request.range.to }),
      }));
    } catch (error) {
      throw error instanceof UsageQueryError ? new UsageInvestigationInputError(error.message) : error;
    }
    const target = request.target;
    const records = await registry();
    // A target HUI already explained opens that report instead of starting a
    // second one, even when the range has since changed to one with no rows.
    const answered = records.find((record) => record.investigation && investigationTargetKey(record.investigation.target) === investigationTargetKey(target));
    if (answered) return { session: views.toView(answered, liveSessions.status(answered.id)), existing: true };
    const report = await usage(query);
    // A pull request names its sessions through the report, most recent first.
    const ids = target.kind === "session"
      ? [target.id]
      : report.sessions
        .filter((row) => row.pullRequests?.some((ref) => ref.repository === target.repository && ref.number === target.number))
        .toSorted((left, right) => right.lastActivityAt - left.lastActivityAt)
        .map((row) => row.id);
    const byId = new Map(records.map((record) => [record.id, record]));
    const candidates = ids.flatMap((id) => byId.get(id) ?? []);
    const checkout = await firstCheckout(candidates);
    const cohorts = new Map(records.map((record) => [record.id, record.group]));
    const plan = usageInvestigationPlan({ report, target, cohorts, checkout, costSkill: await (deps.costSkillEnabled?.() ?? false) });
    const created = await lifecycle.createSession({
      cwd: checkout || "~",
      title: plan.title,
      group: candidates[0]?.group ?? "",
      tool: defaultTool(),
    }, undefined, undefined, undefined, {
      investigation: {
        target,
        range: { from: report.range.from, to: report.range.to, timeZone: report.range.timeZone },
      },
    });
    await lifecycle.waitForSessionReady(created.id);
    await liveSessions.prompt(created.id, plan.prompt);
    const current = (await registry()).find((session) => session.id === created.id) ?? created;
    return { session: views.toView(current, liveSessions.status(created.id)), existing: false };
  }

  return { investigate };
}
