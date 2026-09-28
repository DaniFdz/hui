/** Browser side of the chat's changes card: typed calls to the session
 * changes routes plus the pure helpers the card renders with. */
import type { FileDiff, SessionChanges, ShipInput, ShipResponse } from "../../shared/session-changes.ts";
import { fetchJson } from "./settings-store.ts";

export { changesReady, COLLAPSED_FILE_ROWS, defaultShipSelection, isChangesDecision, orderChangedFiles, proposedShipAction, shipSummary } from "../../shared/session-changes.ts";
export type { ChangedFile, ChangesProposal, FileDiff, ReadyChanges, SessionChanges, ShipAction, ShipInput, ShipResponse, ShipResult } from "../../shared/session-changes.ts";

function changesUrl(sessionId: string, suffix = ""): string {
  return `/__hui/sessions/${encodeURIComponent(sessionId)}/changes${suffix}`;
}

export async function loadSessionChanges(sessionId: string, signal?: AbortSignal): Promise<SessionChanges> {
  return (await fetchJson<{ changes: SessionChanges }>(changesUrl(sessionId), {
    signal: signal ?? AbortSignal.timeout(20_000),
  })).changes;
}

export function loadFileDiff(sessionId: string, path: string): Promise<FileDiff> {
  return fetchJson<FileDiff>(changesUrl(sessionId, `/diff?path=${encodeURIComponent(path)}`), { signal: AbortSignal.timeout(20_000) });
}

/** Commit messages and pull request drafts come from the utility model and the
 * push talks to the remote, so this may take a while. */
export function shipSessionChanges(sessionId: string, input: ShipInput): Promise<ShipResponse> {
  return fetchJson<ShipResponse>(changesUrl(sessionId, "/ship"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(5 * 60_000),
  });
}

/** "Keep iterating": answers the waiting `propose_changes` call without shipping. */
export async function iterateSessionChanges(sessionId: string): Promise<SessionChanges> {
  return (await fetchJson<{ changes: SessionChanges }>(changesUrl(sessionId, "/iterate"), {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  })).changes;
}

export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "context";
export type DiffLine = { kind: DiffLineKind; text: string };

/** Classifies unified-diff lines; the `diff --git`/index/---/+++ header is meta. */
export function parseDiffLines(diff: string): DiffLine[] {
  const lines = diff.replace(/\n$/u, "").split("\n");
  let inHunk = false;
  return lines.filter((line) => line !== "" || inHunk).map((text) => {
    if (text.startsWith("@@")) { inHunk = true; return { kind: "hunk", text }; }
    if (!inHunk || text.startsWith("\\")) return { kind: "meta", text };
    if (text.startsWith("+")) return { kind: "add", text };
    if (text.startsWith("-")) return { kind: "del", text };
    return { kind: "context", text };
  });
}

/** Cards at least this wide show diffs side by side; narrower ones unified. */
export const SPLIT_DIFF_MIN_WIDTH = 640;

export type SplitSide = { number: number; text: string; kind: "add" | "del" | "context" };
export type SplitRow = { kind: "hunk"; text: string } | { kind: "line"; left?: SplitSide; right?: SplitSide };

/** Side-by-side rows: context on both sides, and each run of deletions paired
 * line by line with the additions that follow it (GitHub's split view). */
export function splitDiffRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let oldNumber = 0;
  let newNumber = 0;
  let deleted: SplitSide[] = [];
  let added: SplitSide[] = [];
  const flush = () => {
    for (let index = 0; index < Math.max(deleted.length, added.length); index += 1) {
      const left = deleted[index];
      const right = added[index];
      rows.push({ kind: "line", ...(left ? { left } : {}), ...(right ? { right } : {}) });
    }
    deleted = [];
    added = [];
  };
  for (const line of lines) {
    if (line.kind === "meta") continue;
    if (line.kind === "hunk") {
      flush();
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line.text);
      oldNumber = Number(match?.[1] ?? 1);
      newNumber = Number(match?.[2] ?? 1);
      rows.push({ kind: "hunk", text: line.text });
    } else if (line.kind === "del") {
      deleted.push({ number: oldNumber++, text: line.text.slice(1), kind: "del" });
    } else if (line.kind === "add") {
      added.push({ number: newNumber++, text: line.text.slice(1), kind: "add" });
    } else {
      flush();
      const text = line.text.slice(1);
      rows.push({ kind: "line", left: { number: oldNumber++, text, kind: "context" }, right: { number: newNumber++, text, kind: "context" } });
    }
  }
  flush();
  return rows;
}
