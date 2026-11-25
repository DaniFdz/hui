/**
 * What an activity trail says, from the items one turn's stretch holds: the clock a live turn has been working for or
 * the measured span a settled one worked for, the counts of what its calls did, how many of them failed, and the
 * duration, file, pull-request, issue and session references a row can prove from its own call. Pure wording and
 * extraction, so `views/home.ts` and `views/chat/tool-call-group.ts` only draw what it decides.
 */
import type { TranscriptItem } from "../api/sessions.ts";
import { toolFilePath } from "./tool-cards.ts";
import { toolActivityCounts, type ToolItem } from "./tool-kinds.ts";

/** The items a trail holds: the reasoning, tool calls and errors between two messages. */
export type TrailItem = Extract<TranscriptItem, { kind: "thinking" | "tool" | "error" }>;

/** A clock as a trail writes it: `12s`, `3m 04s`, `1h 02m`. Padding seconds keeps a counting clock from jittering the
 * header's width; a span under a second reads `0s`, never a fraction. */
export function activityDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}m`;
}

export type ActivityTrailOptions = {
  /** The turn is still streaming, so the trail counts up to `now` instead of settling on its last measurement. */
  streaming: boolean;
  /** The render's clock. Read only while streaming: a settled trail never reads the wall clock. */
  now?: number;
  /** When the live turn began, for a turn whose own items carry no timestamp yet. */
  turnStartedAt?: number;
};

export type ActivityTrail = { label: string; failed: number };

/** The measured span of a stretch: from its earliest timestamp to its latest completion once it settled, or to `now`
 * while it runs. A span needs both ends, so a call set that never reported one reads as a count instead. */
function measuredSpan(items: readonly TrailItem[], options: ActivityTrailOptions): string | undefined {
  const timestamps = items.flatMap((item) => item.metrics?.timestamp ?? []);
  const started = timestamps.length ? Math.min(...timestamps) : undefined;
  if (options.streaming) {
    const from = started ?? options.turnStartedAt;
    const now = options.now ?? Date.now();
    if (from === undefined || now < from) return undefined;
    return activityDuration(now - from);
  }
  const finished = items.flatMap((item) => item.metrics?.completedAt ?? []);
  if (started === undefined || !finished.length) return undefined;
  const until = Math.max(...finished);
  return until >= started ? activityDuration(until - started) : undefined;
}

/** The collapsed summary: `Working for 3m 04s · 5 edits, 3 reads, 2 runs` while it runs and `Worked for …` once it
 * settles, the count wording when no span could be measured, `Reasoning`/`Thinking…` for reasoning alone that measured
 * nothing, and how many of its calls (or its error) failed. Reasoning that did measure both ends reads the clock as
 * well: it is work the turn spent, and there is nothing for a count to say. */
export function activityTrail(items: readonly TrailItem[], options: ActivityTrailOptions): ActivityTrail {
  const tools = items.filter((item): item is ToolItem => item.kind === "tool");
  const failed = items.filter((item) => item.kind === "error" || (item.kind === "tool" && (item.failed === true || item.status === "failed"))).length;
  let label: string;
  if (!tools.length) {
    // Reasoning alone keeps its words only when nothing measured a span for it.
    const span = measuredSpan(items, options);
    label = span !== undefined
      ? `${options.streaming ? "Working" : "Worked"} for ${span}`
      : items.some((item) => item.kind === "thinking") ? (options.streaming ? "Thinking…" : "Reasoning") : "Run details";
    return { label, failed };
  }
  const counts = toolActivityCounts(tools);
  const detail = counts ? ` · ${counts}` : "";
  const span = measuredSpan(items, options);
  label = span !== undefined
    ? `${options.streaming ? "Working" : "Worked"} for ${span}${detail}`
    : `${options.streaming ? "Using" : "Used"} ${tools.length} ${tools.length === 1 ? "tool" : "tools"}${detail}`;
  return { label, failed };
}

/** What a call proved about where it happened, in the order its row draws it. */
export type ToolReference =
  | { kind: "file"; path: string }
  | { kind: "pull" | "issue"; number: number; href: string }
  | { kind: "session"; query: string };

const PULL_REQUEST = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(pull|issues)\/\d+/gu;
const SESSION_REFERENCE = /session:([A-Za-z0-9][A-Za-z0-9_-]*)/gu;
const SESSION_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

/** What the call itself carries: its arguments and the output the model got, never a request for more. */
function callText(item: ToolItem): string {
  let args = "";
  if (typeof item.args === "string") args = item.args;
  else if (item.args !== undefined) {
    try {
      args = JSON.stringify(item.args) ?? "";
    } catch {
      args = "";
    }
  }
  return `${args}\n${item.output ?? ""}`;
}

/** The references one call's own data proves, in the row's order (its file, its pull requests and issues, then the
 * sessions it named), deduplicated and capped so a row cannot grow a wall of chips. A link no call printed, and a
 * session no call named, is left out rather than guessed. */
export function toolReferences(item: ToolItem, limit = 3): ToolReference[] {
  const references: ToolReference[] = [];
  const path = toolFilePath(item);
  if (path) references.push({ kind: "file", path });
  const text = callText(item);
  const seen = new Set<string>();
  for (const match of text.matchAll(PULL_REQUEST)) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    references.push({ kind: match[1] === "pull" ? "pull" : "issue", number: Number(match[0].slice(match[0].lastIndexOf("/") + 1)), href: match[0] });
  }
  for (const match of text.matchAll(SESSION_REFERENCE)) {
    const query = match[1]!;
    if (seen.has(`session:${query}`)) continue;
    seen.add(`session:${query}`);
    references.push({ kind: "session", query });
  }
  for (const match of text.matchAll(SESSION_UUID)) {
    const query = match[0];
    if (seen.has(`session:${query.toLowerCase()}`) || seen.has(`session:${query}`)) continue;
    seen.add(`session:${query.toLowerCase()}`);
    references.push({ kind: "session", query });
  }
  return references.slice(0, limit);
}

/** The chip a pull request or issue reads as: `PR #580`, `Issue #12`. Its number is all the call proved. */
export function toolReferenceLabel(reference: Extract<ToolReference, { kind: "pull" | "issue" }>): string {
  return `${reference.kind === "pull" ? "PR" : "Issue"} #${reference.number}`;
}
