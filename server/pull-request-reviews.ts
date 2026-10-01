/**
 * Risk reviews of pull requests awaiting the operator's review.
 *
 * "Assess risk" starts a temporary PI session (`SessionRecord.temporary`) that
 * reads the pull request with `gh` and reports through `report_pr_risk`. The
 * latest valid call is projected onto the Pull Requests row from the live
 * transcript (memory only). Approve runs one `gh pr review --approve` on an
 * explicit click; approving or dismissing deletes exactly the paths the
 * temporary record names.
 */
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { PullRequestAssessment, PullRequestRiskVerdict } from "../shared/pull-requests.ts";
import { parsePullRequestRisk } from "./runtimes/pr-risk-extension.mjs";
import type { SessionStatus } from "./live-sessions.ts";
import type { SessionRecord } from "./sessions.ts";

type PullRequestRef = { repository: string; number: number; url: string };

/** The first prompt: read-only, `gh` with an explicit repository, ends with the tool. */
export function assessmentPrompt(pr: PullRequestRef, workspace: "checkout" | "scratch"): string {
  const repo = `-R ${pr.repository}`;
  return [
    `Assess the risk of merging pull request ${pr.repository}#${pr.number} (${pr.url}); the operator was asked to review it.`,
    "",
    "Work strictly read-only:",
    `- Read it with \`gh pr view ${pr.number} ${repo}\`, \`gh pr diff ${pr.number} ${repo}\` and \`gh pr checks ${pr.number} ${repo}\`.`,
    workspace === "checkout"
      ? `- The working directory is a local checkout of ${pr.repository}, possibly on another branch. Read it for context; do not check out the pull request branch.`
      : "- The working directory is an empty scratch directory; read repository files through `gh` when you need context.",
    "- Do not modify files, commit, push, comment on, review or approve the pull request. The operator decides.",
    "",
    "Finish by calling report_pr_risk with the overall risk (low, medium or high), a short summary, the concrete reasons and the files that deserve the closest look.",
  ].join("\n");
}

/** The latest successful, valid `report_pr_risk` call wins. */
export function riskVerdictFromTranscript(transcript: readonly { kind: string; name?: string; args?: unknown; failed?: boolean }[]): PullRequestRiskVerdict | undefined {
  for (const entry of transcript.toReversed()) {
    if (entry.kind !== "tool" || entry.name !== "report_pr_risk" || entry.failed) continue;
    const parsed = parsePullRequestRisk(entry.args);
    if ("verdict" in parsed) return parsed.verdict;
  }
  return undefined;
}

export function pullRequestAssessment(
  record: SessionRecord,
  status: SessionStatus,
  transcript: Parameters<typeof riskVerdictFromTranscript>[0],
): PullRequestAssessment {
  const verdict = riskVerdictFromTranscript(transcript);
  if (verdict) return { sessionId: record.id, state: "verdict", verdict };
  const busy = status === "starting" || status === "running" || status === "waiting";
  return { sessionId: record.id, state: busy ? "assessing" : "no_verdict" };
}

export function temporaryReview(records: readonly SessionRecord[], url: string): SessionRecord | undefined {
  const key = url.toLowerCase();
  return records.find((record) => record.temporary?.kind === "pr-review" && record.temporary.pullRequestUrl.toLowerCase() === key);
}

/** Files a temporary review may delete: its PI transcript and, only when it is
 * a direct child of `scratchRoot`, the scratch directory HUI created. */
export function temporaryCleanupPaths(record: SessionRecord, scratchRoot: string): string[] {
  if (!record.temporary) return [];
  const paths: string[] = [];
  const transcript = record.piSessionFile;
  if (transcript && isAbsolute(transcript) && transcript.endsWith(".jsonl")) paths.push(transcript);
  const scratch = record.temporary.scratchDir;
  if (scratch && isAbsolute(scratch) && dirname(resolve(scratch)) === resolve(scratchRoot)) paths.push(resolve(scratch));
  return paths;
}

export async function removeTemporaryFiles(record: SessionRecord, scratchRoot: string, remove = (path: string) => rm(path, { recursive: true, force: true })): Promise<void> {
  for (const path of temporaryCleanupPaths(record, scratchRoot)) await remove(path);
}

export const TEMPORARY_MAX_AGE_MS = 24 * 60 * 60_000;

/** Temporary reviews left behind for longer than a day (deleted at gateway start). */
export function staleTemporarySessions(records: readonly SessionRecord[], now: number, maxAgeMs = TEMPORARY_MAX_AGE_MS): SessionRecord[] {
  return records.filter((record) => record.temporary && !(Date.parse(record.createdAt) > now - maxAgeMs));
}

/** Exactly `gh pr review <n> -R owner/repo --approve`. */
export function approveArgs(pr: Pick<PullRequestRef, "repository" | "number">): string[] {
  return ["pr", "review", String(pr.number), "-R", pr.repository, "--approve"];
}

export class GhCommandError extends Error {
  override name = "GhCommandError";
}

/** Runs `gh <args>`; rejects with gh's own (bounded) error text. */
export function runGh(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolveRun, reject) => {
    execFile(command, [...args], {
      env: { ...env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_SPINNER_DISABLED: "1", NO_COLOR: "1" },
      timeout: 30_000, maxBuffer: 256 * 1024, encoding: "utf8",
    }, (error, _stdout, stderr) => {
      if (!error) return resolveRun();
      const detail = (stderr || error.message).trim().slice(0, 500);
      reject(new GhCommandError(error.code === "ENOENT" ? "The GitHub CLI (gh) is not installed." : detail || "gh failed."));
    });
  });
}
