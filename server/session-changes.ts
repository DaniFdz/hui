/**
 * The Git work a session has prepared, and the operator's one-click shipping
 * of it (commit, push, draft pull request) from the chat's changes card.
 *
 * HUI runs Git and `gh` itself first, like T3 Code's stacked Git actions and
 * Hermes' review pane. A step that Git or GitHub refuses, or anything that
 * breaks unexpectedly past validation, becomes a `ShipStepError` carrying what
 * already happened plus the command and its output, so the route can hand the
 * remainder to the session's own agent instead of guessing. Nothing is
 * stashed, reset, forced or rewritten: commits use `git commit --only` with the
 * selected paths, so unrelated staged or unstaged work in a shared checkout is
 * left exactly as it was.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
  ChangedFile,
  ChangedFileStatus,
  ChangesPullRequest,
  FileDiff,
  SessionChanges,
  ShipAction,
  ShipResult,
} from "../shared/session-changes.ts";
import { EDIT_TOOLS } from "../shared/session-changes.ts";
import type { TranscriptEntry } from "./runtimes/types.ts";
import { pullRequestUrls } from "./pull-requests.ts";
import { worktreeSlug } from "./worktrees.ts";

export type CommandResult = { code: number; stdout: string; stderr: string };
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs?: number },
) => Promise<CommandResult>;
/** Utility-model text generation; rejects when no model is available. */
export type ChangeWriter = (prompt: string) => Promise<string>;

const MAX_FILES = 200;
const MAX_OUTPUT = 4_000_000;
const MAX_DIFF_CHARS = 200_000;
const MAX_WRITER_DIFF = 60_000;
const MAX_UNTRACKED_BYTES = 512 * 1024;
const MAX_MESSAGE = 4_000;
const MAX_TITLE = 200;
const MAX_BODY = 8_000;
const MAX_PR_BODY = 20_000;
const PR_CACHE_MS = 60_000;
/** "No pull request" and failed lookups expire sooner: an agent that opens the
 * pull request itself should not see the card offer to open it again. */
const PR_MISS_CACHE_MS = 15_000;
const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const COMMAND_TIMEOUT_MS = 120_000;
const GH_ENV = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_SPINNER_DISABLED: "1", NO_COLOR: "1" };
const PATH_KEYS = ["path", "file_path", "filePath", "notebook_path"] as const;

export class ShipInputError extends Error {}
/** `prepare` covers anything that failed outside a Git or GitHub command. */
export type ShipStep = "prepare" | "branch" | "commit" | "push" | "pull_request";
/** A ship failed after validation; `result` is what completed. `command` is
 * the command HUI ran (long arguments shortened) and `output` its redacted, bounded output, so the
 * agent that takes over sees what HUI saw rather than a single line. */
export class ShipStepError extends Error {
  readonly step: ShipStep;
  readonly result: ShipResult;
  readonly command?: string;
  readonly output?: string;
  constructor(step: ShipStep, message: string, result: ShipResult, details: { command?: string; output?: string } = {}) {
    super(message);
    this.step = step;
    this.result = result;
    if (details.command) this.command = details.command;
    if (details.output) this.output = details.output;
  }
}

export const runCommand: CommandRunner = (command, args, options) => new Promise((resolveResult) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...GH_ENV, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? COMMAND_TIMEOUT_MS);
  child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += chunk.toString("utf8"); });
  child.once("error", (error) => { clearTimeout(timer); resolveResult({ code: 127, stdout, stderr: error.message }); });
  child.once("close", (code) => { clearTimeout(timer); resolveResult({ code: code ?? 1, stdout, stderr }); });
});

const MAX_HANDOFF_OUTPUT = 4_000;
const MAX_HANDOFF_LINES = 40;
const MAX_COMMAND_ARG = 120;

/** Hides credentials embedded in URLs (`https://user:token@host`). */
export function redactCredentials(text: string): string {
  return text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, "$1***@");
}

/** A shell-like rendering of a command for the hand-off prompt; long
 * arguments (pull request bodies) are shortened. */
export function displayCommand(command: string, args: readonly string[]): string {
  const quote = (value: string) => {
    const shown = value.length > MAX_COMMAND_ARG ? `${value.slice(0, MAX_COMMAND_ARG)}…` : value;
    return /^[\w@%+=:,./-]+$/u.test(shown) ? shown : `'${shown.replace(/\n/gu, "\\n").replace(/'/gu, "'\\''")}'`;
  };
  return redactCredentials([command, ...args].map(quote).join(" "));
}

/** The tail of a command's output: the lines that explain a failure (a moved
 * repository's new URL, a hook's message) are often not the first error line. */
export function commandOutput(result: CommandResult): string {
  const text = [result.stderr, result.stdout].map((part) => part.trim()).filter(Boolean).join("\n");
  const lines = text.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim());
  return redactCredentials(lines.slice(-MAX_HANDOFF_LINES).join("\n")).slice(-MAX_HANDOFF_OUTPUT).trim();
}

function firstLine(result: CommandResult, fallback: string): string {
  const lines = `${result.stderr}\n${result.stdout}`.split("\n").map((line) => line.trim()).filter(Boolean);
  const useful = lines.find((line) => /^(?:error|fatal|!|x |remote: error)/iu.test(line)) ?? lines[0];
  return redactCredentials(useful ?? fallback).slice(0, 400);
}

function stepError(step: ShipStep, message: string, command: string, args: readonly string[], output: CommandResult, result: ShipResult): ShipStepError {
  return new ShipStepError(step, message, result, { command: displayCommand(command, args), output: commandOutput(output) });
}

/** Files the session's own edit/write tools changed, as absolute paths. */
export function sessionEditedPaths(entries: readonly TranscriptEntry[], cwd: string): Set<string> {
  const paths = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "tool" || entry.failed || entry.output === undefined) continue;
    if (!EDIT_TOOLS.has(entry.name.toLowerCase())) continue;
    const args = entry.args;
    if (!args || typeof args !== "object" || Array.isArray(args)) continue;
    for (const key of PATH_KEYS) {
      const value = (args as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        paths.add(isAbsolute(value) ? resolve(value) : resolve(cwd, value));
        break;
      }
    }
  }
  return paths;
}

/** Splits NUL-separated `git status --porcelain=v1 -z --no-renames`. */
export function parseStatus(output: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const record of output.split("\0")) {
    if (record.length < 4) continue;
    entries.set(record.slice(3), record.slice(0, 2));
  }
  return entries;
}

/** `git diff --numstat -z --no-renames`: `added\tdeleted\tpath\0`, `-` for binary. */
export function parseNumstat(output: string): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (const record of output.split("\0")) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/su.exec(record);
    if (!match) continue;
    const binary = match[1] === "-";
    stats.set(match[3]!, { additions: binary ? 0 : Number(match[1]), deletions: binary ? 0 : Number(match[2]), binary });
  }
  return stats;
}

/** `git diff --name-status -z --no-renames`: `S\0path\0`. */
export function parseNameStatus(output: string): Map<string, ChangedFileStatus> {
  const parts = output.split("\0");
  const statuses = new Map<string, ChangedFileStatus>();
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const code = parts[index]!.charAt(0);
    const path = parts[index + 1]!;
    if (!path) continue;
    statuses.set(path, code === "A" ? "added" : code === "D" ? "deleted" : "modified");
  }
  return statuses;
}

async function untrackedStats(path: string): Promise<{ additions: number; binary: boolean }> {
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return { additions: 0, binary: false };
  try {
    const buffer = Buffer.alloc(MAX_UNTRACKED_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) return { additions: 0, binary: true };
    let lines = 0;
    for (const byte of bytes) if (byte === 10) lines += 1;
    if (bytesRead > 0 && bytes[bytesRead - 1] !== 10) lines += 1;
    return { additions: lines, binary: false };
  } finally {
    await handle.close();
  }
}

/** An open pull request for a branch and the commit GitHub has as its head. */
type PullRequestLookup = { pullRequest?: ChangesPullRequest; headOid?: string };

type Snapshot = {
  view: SessionChanges;
  root: string;
  /** Commit the listed files are compared against. */
  compareBase: string;
  uncommitted: Map<string, string>;
};

function commitMessageFallback(paths: readonly string[]): string {
  const names = paths.map((path) => path.split("/").at(-1) ?? path);
  const listed = names.slice(0, 3).join(", ");
  return `Update ${listed}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`.slice(0, 72);
}

/** Strips code fences, quotes and chatter a model may wrap around a message. */
export function normalizeCommitMessage(value: string): string {
  const text = value.replace(/^```[a-z]*\n?|```\s*$/giu, "").replace(/^\s*(?:commit message\s*:\s*)/iu, "").trim();
  const [subject = "", ...rest] = text.split("\n");
  const cleanSubject = subject.replace(/^["'`]+|["'`]+$/gu, "").trim().slice(0, 100);
  const body = rest.join("\n").trim();
  return (body ? `${cleanSubject}\n\n${body}` : cleanSubject).slice(0, MAX_MESSAGE);
}

export function parsePullRequestDraft(value: string): { title: string; body: string } | undefined {
  const match = /\{[\s\S]*\}/u.exec(value);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const title = typeof parsed["title"] === "string" ? parsed["title"].replace(/\s+/gu, " ").trim().slice(0, MAX_TITLE) : "";
    const body = typeof parsed["body"] === "string" ? parsed["body"].trim().slice(0, MAX_BODY) : "";
    return title ? { title, body } : undefined;
  } catch {
    return undefined;
  }
}

export type SessionChangesOptions = {
  run?: CommandRunner;
  gh?: string;
  now?: () => number;
};

export class SessionChangesService {
  readonly #run: CommandRunner;
  readonly #gh: string;
  readonly #now: () => number;
  readonly #pullRequests = new Map<string, PullRequestLookup & { state: string; freshUntil: number }>();
  readonly #shipping = new Set<string>();

  constructor(options: SessionChangesOptions = {}) {
    this.#run = options.run ?? runCommand;
    this.#gh = options.gh ?? "gh";
    this.#now = options.now ?? Date.now;
  }

  #git(cwd: string, args: readonly string[]) {
    return this.#run("git", ["--literal-pathspecs", ...args], { cwd });
  }

  async inspect(cwd: string, sessionPaths: ReadonlySet<string> = new Set()): Promise<SessionChanges> {
    return (await this.#snapshot(cwd, sessionPaths))?.view ?? { available: false };
  }

  async #snapshot(cwd: string, sessionPaths: ReadonlySet<string>, freshPullRequest = false): Promise<Snapshot | undefined> {
    const directory = await realpath(cwd).catch(() => "");
    if (!directory) return undefined;
    const top = await this.#git(directory, ["rev-parse", "--show-toplevel"]);
    const head = await this.#git(directory, ["rev-parse", "--verify", "HEAD"]);
    if (top.code !== 0 || head.code !== 0) return undefined;
    const root = await realpath(top.stdout.trim()).catch(() => top.stdout.trim());
    const headSha = head.stdout.trim();

    const [current, remotes, upstreamRef] = await Promise.all([
      this.#git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
      this.#git(root, ["remote"]),
      this.#git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
    ]);
    const branch = current.code === 0 ? current.stdout.trim() : "";
    const remoteNames = remotes.code === 0 ? remotes.stdout.split("\n").map((name) => name.trim()).filter(Boolean) : [];
    const remote = remoteNames.includes("origin") ? "origin" : remoteNames[0];
    const upstream = upstreamRef.code === 0 ? upstreamRef.stdout.trim() : "";

    let base = "";
    if (remote) {
      const remoteHead = await this.#git(root, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);
      if (remoteHead.code === 0) base = remoteHead.stdout.trim().slice(remote.length + 1);
    }
    if (!base) {
      for (const candidate of ["main", "master"]) {
        if ((await this.#git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`])).code === 0) { base = candidate; break; }
      }
    }
    base ||= branch || "HEAD";
    const remoteBase = remote ? `refs/remotes/${remote}/${base}` : "";
    const baseRef = remoteBase && (await this.#git(root, ["rev-parse", "--verify", "--quiet", remoteBase])).code === 0 ? remoteBase : base;
    const mergeBase = await this.#git(root, ["merge-base", "HEAD", baseRef]);
    const compareBase = mergeBase.code === 0 ? mergeBase.stdout.trim() : headSha;

    let unpushed = 0;
    let behind = 0;
    if (upstream) {
      const counts = await this.#git(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
      const [left, right] = counts.stdout.trim().split(/\s+/u).map(Number);
      behind = Number.isFinite(left) ? left! : 0;
      unpushed = Number.isFinite(right) ? right! : 0;
    }
    const commitCount = await this.#git(root, ["rev-list", "--count", `${compareBase}..HEAD`]);
    const commits = Number(commitCount.stdout.trim()) || 0;
    // A branch pushed without `--set-upstream` (`git push origin <branch>`, as
    // agents usually do) still has a remote-tracking ref; its sha also keys the
    // pull request cache, so a push refreshes it.
    const tracking = remote && branch && !upstream
      ? await this.#git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch}^{commit}`])
      : undefined;
    const trackingSha = tracking?.code === 0 ? tracking.stdout.trim() : "";
    const lookup = remote && branch && branch !== base
      ? await this.#pullRequest(root, branch, freshPullRequest, `${headSha}\0${upstream}\0${trackingSha}`)
      : {};
    const pullRequest = lookup.pullRequest;
    if (!upstream && remote && branch) {
      // Without an upstream, the commits since the last known push: the
      // remote-tracking ref, or the open pull request's head when the checkout
      // does not track the branch (narrow fetch refspecs). Neither: all of them.
      const known: number[] = [];
      for (const pushed of [trackingSha, lookup.headOid]) {
        const count = pushed ? await this.#commitsSince(root, pushed, headSha) : undefined;
        if (count !== undefined) known.push(count);
      }
      unpushed = known.length ? Math.min(...known) : commits;
    }

    const [status, numstat, nameStatus] = await Promise.all([
      this.#git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]),
      this.#git(root, ["diff", "--numstat", "-z", "--no-renames", compareBase]),
      this.#git(root, ["diff", "--name-status", "-z", "--no-renames", compareBase]),
    ]);
    const uncommitted = parseStatus(status.stdout);
    const stats = parseNumstat(numstat.stdout);
    const statuses = parseNameStatus(nameStatus.stdout);
    const own = new Set<string>();
    for (const path of sessionPaths) {
      // The worktree root Git reports is resolved; a session's paths may go through
      // a symlink (macOS /var or /tmp, a linked home), so resolve them too.
      const resolved = resolve(directory, path);
      const canonical = await realpath(resolved).catch(() => resolved);
      const relativePath = relative(root, canonical);
      if (relativePath && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)) own.add(relativePath.split(sep).join("/"));
    }

    // The cap keeps what matters for shipping: this session's uncommitted files,
    // then other uncommitted files, then files already committed on the branch.
    const rank = (path: string) => (uncommitted.has(path) ? (own.has(path) ? 0 : 1) : 2);
    const paths = [...new Set([...statuses.keys(), ...uncommitted.keys()])]
      .sort((left, right) => rank(left) - rank(right) || left.localeCompare(right));
    const files: ChangedFile[] = [];
    for (const path of paths.slice(0, MAX_FILES)) {
      const code = uncommitted.get(path);
      let fileStatus = statuses.get(path) ?? (code?.includes("D") ? "deleted" : code === "??" || code?.includes("A") ? "added" : "modified");
      let additions = stats.get(path)?.additions ?? 0;
      const deletions = stats.get(path)?.deletions ?? 0;
      let binary = stats.get(path)?.binary ?? false;
      if (code === "??") {
        fileStatus = "added";
        const counted = await untrackedStats(resolve(root, path));
        additions = counted.additions;
        binary = counted.binary;
      }
      files.push({
        path,
        status: fileStatus,
        additions,
        deletions,
        ...(binary ? { binary: true as const } : {}),
        uncommitted: code !== undefined,
        session: own.has(path),
      });
    }
    const signature = createHash("sha256")
      .update([headSha, upstream, String(unpushed), status.stdout, numstat.stdout, pullRequest?.url ?? ""].join("\0"))
      .digest("hex")
      .slice(0, 16);
    return {
      root,
      compareBase,
      uncommitted,
      view: {
        available: true,
        branch,
        base,
        isDefaultBranch: Boolean(branch) && branch === base,
        ...(remote ? { remote } : {}),
        ...(upstream ? { upstream } : {}),
        unpushed,
        behind,
        commits,
        files,
        totalFiles: paths.length,
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
        ...(pullRequest ? { pullRequest } : {}),
        signature,
      },
    };
  }

  /** Commits on HEAD that `pushed` lacks; undefined when it is not a local commit. */
  async #commitsSince(root: string, pushed: string, headSha: string): Promise<number | undefined> {
    if (pushed === headSha) return 0;
    if (!OBJECT_ID.test(pushed)) return undefined;
    const result = await this.#git(root, ["rev-list", "--count", `${pushed}..HEAD`]);
    const count = Number(result.stdout.trim());
    return result.code === 0 && result.stdout.trim() && Number.isFinite(count) ? count : undefined;
  }

  /** `state` is the local and pushed branch position; a new commit or push
   * looks the pull request up again instead of trusting the cache. */
  async #pullRequest(root: string, branch: string, fresh: boolean, state = ""): Promise<PullRequestLookup> {
    const key = `${root}\0${branch}`;
    const cached = this.#pullRequests.get(key);
    if (!fresh && cached && cached.state === state && cached.freshUntil > this.#now()) return cached;
    const result = await this.#run(this.#gh, [
      "pr", "list", "--head", branch, "--state", "open", "--limit", "5", "--json", "number,url,title,isDraft,headRefOid",
    ], { cwd: root, timeoutMs: 10_000 });
    const lookup: PullRequestLookup = {};
    if (result.code === 0) {
      try {
        const list = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
        const first = Array.isArray(list) ? list.find((item) => typeof item["url"] === "string" && typeof item["number"] === "number") : undefined;
        if (first) {
          lookup.pullRequest = { number: first["number"] as number, url: first["url"] as string, title: String(first["title"] ?? ""), draft: first["isDraft"] === true };
          const headOid = typeof first["headRefOid"] === "string" ? first["headRefOid"].toLowerCase() : "";
          if (OBJECT_ID.test(headOid)) lookup.headOid = headOid;
        }
      } catch { /* An unreadable answer is the same as no answer. */ }
    }
    this.#pullRequests.set(key, { ...lookup, state, freshUntil: this.#now() + (lookup.pullRequest ? PR_CACHE_MS : PR_MISS_CACHE_MS) });
    return lookup;
  }

  /** Unified diff of one listed file against the compared base. */
  async diff(cwd: string, path: string): Promise<FileDiff> {
    const snapshot = await this.#snapshot(cwd, new Set());
    if (!snapshot || !snapshot.view.available) throw new ShipInputError("This session is not in a Git checkout.");
    const file = snapshot.view.files.find((candidate) => candidate.path === path);
    if (!file) throw new ShipInputError(`No change to show for ${path}.`);
    const untracked = snapshot.uncommitted.get(path) === "??";
    const result = untracked
      ? await this.#git(snapshot.root, ["diff", "--no-color", "--no-index", "--", "/dev/null", path])
      : await this.#git(snapshot.root, ["diff", "--no-color", "--no-renames", snapshot.compareBase, "--", path]);
    // `--no-index` exits 1 when the files differ, which is the expected case.
    if (result.code !== 0 && !(untracked && result.code === 1)) throw new Error(firstLine(result, "git diff failed"));
    const truncated = result.stdout.length > MAX_DIFF_CHARS;
    return { path, diff: truncated ? result.stdout.slice(0, MAX_DIFF_CHARS) : result.stdout, truncated };
  }

  async ship(options: {
    cwd: string;
    action: ShipAction;
    files: readonly string[];
    message?: string;
    /** Operator-edited (or agent-proposed) pull request text; empty is drafted by the writer. */
    prTitle?: string;
    prBody?: string;
    branchPrefix: string;
    sessionPaths?: ReadonlySet<string>;
    writer?: ChangeWriter;
  }): Promise<ShipResult> {
    const snapshot = await this.#snapshot(options.cwd, options.sessionPaths ?? new Set(), true);
    if (!snapshot || !snapshot.view.available) throw new ShipInputError("This session is not in a Git checkout.");
    if (this.#shipping.has(snapshot.root)) throw new ShipInputError("Another commit or pull request is already running in this checkout.");
    this.#shipping.add(snapshot.root);
    try {
      return await this.#ship(snapshot, options);
    } finally {
      this.#shipping.delete(snapshot.root);
      for (const key of this.#pullRequests.keys()) if (key.startsWith(`${snapshot.root}\0`)) this.#pullRequests.delete(key);
    }
  }

  async #ship(snapshot: Snapshot, options: Parameters<SessionChangesService["ship"]>[0]): Promise<ShipResult> {
    const view = snapshot.view;
    if (!view.available) throw new ShipInputError("This session is not in a Git checkout.");
    const files = [...new Set(options.files)];
    const unknown = files.filter((path) => !snapshot.uncommitted.has(path));
    if (unknown.length) throw new ShipInputError(`These files have no uncommitted changes: ${unknown.slice(0, 5).join(", ")}`);
    const wantsPush = options.action !== "commit";
    const stacking = options.action === "stacked_pr";
    if (options.action === "commit" && !files.length) throw new ShipInputError("Select at least one file to commit.");
    if (wantsPush && !view.remote) throw new ShipInputError("This repository has no remote to push to.");
    if (wantsPush && !view.branch) throw new ShipInputError("Check out a branch before pushing; HEAD is detached.");
    if (options.action === "commit_push" && !files.length && view.unpushed === 0) throw new ShipInputError("Nothing to commit or push.");
    if (stacking && !view.pullRequest) throw new ShipInputError("Stacking needs an open pull request on this branch.");
    if (stacking && !files.length) throw new ShipInputError("Select the files for the stacked pull request.");
    if (options.action === "draft_pr" && view.pullRequest) {
      return { branch: view.branch, pullRequest: { number: view.pullRequest.number, url: view.pullRequest.url, existing: true } };
    }
    if (options.action === "draft_pr" && !files.length && view.commits === 0 && !view.isDefaultBranch) {
      throw new ShipInputError(`This branch has no commits beyond ${view.base}.`);
    }

    const result: ShipResult = { branch: view.branch };
    // Anything unexpected past validation is still a failed step: the route
    // hands it to the agent with what completed instead of a bare 500.
    let step: ShipStep = "prepare";
    try {
      return await this.#runSteps(snapshot, options, files, result, (next) => { step = next; });
    } catch (error) {
      if (error instanceof ShipStepError || error instanceof ShipInputError) throw error;
      throw new ShipStepError(step, error instanceof Error ? error.message : String(error), result);
    }
  }

  async #runSteps(
    snapshot: Snapshot,
    options: Parameters<SessionChangesService["ship"]>[0],
    files: readonly string[],
    result: ShipResult,
    enter: (step: ShipStep) => void,
  ): Promise<ShipResult> {
    const view = snapshot.view;
    if (!view.available) throw new ShipInputError("This session is not in a Git checkout.");
    const stacking = options.action === "stacked_pr";
    const wantsPush = options.action !== "commit";
    const wantsPullRequest = options.action === "draft_pr" || stacking;
    const root = snapshot.root;
    let message = options.message?.trim().slice(0, MAX_MESSAGE) ?? "";
    if (files.length && !message) message = await this.#commitMessage(root, snapshot, files, options.writer);

    let branch = view.branch;
    let pullRequestBase = view.base;
    let draftBase = snapshot.compareBase;
    if (stacking) {
      // The parent's unpushed commits belong to its pull request; pushing them
      // first keeps them out of the stacked pull request's diff.
      const stackedOn: NonNullable<ShipResult["stackedOn"]> = { branch: view.branch, number: view.pullRequest!.number };
      result.stackedOn = stackedOn;
      if (view.unpushed > 0) {
        enter("push");
        const args = view.upstream ? ["push"] : ["push", view.remote!, `HEAD:refs/heads/${view.branch}`];
        const pushed = await this.#git(root, args);
        if (pushed.code !== 0) throw stepError("push", `Could not push ${view.branch} before stacking: ${firstLine(pushed, "git push failed")}`, "git", args, pushed, result);
        stackedOn.pushed = true;
      }
      pullRequestBase = view.branch;
      draftBase = (await this.#git(root, ["rev-parse", "HEAD"])).stdout.trim();
    }
    if ((options.action === "draft_pr" && view.isDefaultBranch) || stacking) {
      enter("branch");
      const subject = message.split("\n", 1)[0] || (await this.#git(root, ["log", "-1", "--format=%s"])).stdout.trim();
      const stem = `${options.branchPrefix}${worktreeSlug(subject || "changes")}`;
      let candidate = stem;
      for (let suffix = 2; (await this.#git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`])).code === 0; suffix += 1) {
        candidate = `${stem}-${suffix}`;
      }
      const args = ["switch", "-c", candidate];
      const created = await this.#git(root, args);
      if (created.code !== 0) throw stepError("branch", `Could not create branch ${candidate}: ${firstLine(created, "git switch failed")}`, "git", args, created, result);
      branch = candidate;
      result.branch = candidate;
      result.createdBranch = candidate;
    }

    if (files.length) {
      enter("commit");
      const untracked = files.filter((path) => snapshot.uncommitted.get(path) === "??");
      if (untracked.length) {
        const args = ["add", "--intent-to-add", "--", ...untracked];
        const intent = await this.#git(root, args);
        if (intent.code !== 0) throw stepError("commit", firstLine(intent, "git add failed"), "git", args, intent, result);
      }
      const args = ["commit", "--only", "-m", message, "--", ...files];
      const committed = await this.#git(root, args);
      if (committed.code !== 0) {
        // Leave new files untracked again, exactly as they were before the attempt.
        if (untracked.length) await this.#git(root, ["reset", "--quiet", "--", ...untracked]);
        throw stepError("commit", firstLine(committed, "git commit failed"), "git", args, committed, result);
      }
      const sha = (await this.#git(root, ["rev-parse", "HEAD"])).stdout.trim();
      result.commit = { sha, subject: message.split("\n", 1)[0] ?? "" };
    }

    if (wantsPush) {
      const hasUpstream = Boolean(view.upstream) && !result.createdBranch;
      const needsPush = !hasUpstream || Boolean(result.commit) || view.unpushed > 0;
      if (needsPush) {
        enter("push");
        const args = hasUpstream ? ["push"] : ["push", "--set-upstream", view.remote!, `HEAD:refs/heads/${branch}`];
        const pushed = await this.#git(root, args);
        if (pushed.code !== 0) throw stepError("push", firstLine(pushed, "git push failed"), "git", args, pushed, result);
        result.pushed = true;
      }
    }

    if (wantsPullRequest) {
      enter("pull_request");
      const existing = (await this.#pullRequest(root, branch, true)).pullRequest;
      if (existing) {
        result.pullRequest = { number: existing.number, url: existing.url, existing: true };
        return result;
      }
      const title = options.prTitle?.replace(/\s+/gu, " ").trim().slice(0, MAX_TITLE) ?? "";
      const body = options.prBody?.trim().slice(0, MAX_PR_BODY) ?? "";
      const draft = title
        ? { title, body }
        : await this.#pullRequestDraft(root, draftBase, options.writer);
      const args = ["pr", "create", "--draft", "--base", pullRequestBase, "--head", branch,
        ...(draft ? ["--title", draft.title, "--body", body || draft.body || draft.title] : ["--fill"])];
      const created = await this.#run(this.#gh, args, { cwd: root, timeoutMs: 60_000 });
      const reference = created.code === 0 ? pullRequestUrls(created.stdout)[0] : undefined;
      if (!reference) throw stepError("pull_request", firstLine(created, "gh pr create printed no pull request URL"), "gh", args, created, result);
      result.pullRequest = { number: reference.number, url: reference.url };
    }
    return result;
  }

  async #commitMessage(root: string, snapshot: Snapshot, files: readonly string[], writer?: ChangeWriter): Promise<string> {
    const fallback = commitMessageFallback(files);
    if (!writer) return fallback;
    const tracked = files.filter((path) => snapshot.uncommitted.get(path) !== "??");
    const created = files.filter((path) => snapshot.uncommitted.get(path) === "??");
    const diff = tracked.length ? (await this.#git(root, ["diff", "--no-color", "HEAD", "--", ...tracked])).stdout : "";
    const recent = (await this.#git(root, ["log", "-n", "10", "--format=%s"])).stdout.trim();
    try {
      const answer = await writer([
        "Write a Git commit message for the change below.",
        "Return only the message: an imperative subject line of at most 72 characters in English,",
        "optionally followed by a blank line and a short body. No quotes, code fences or commentary.",
        "",
        "Recent subjects, for style:",
        recent || "(none)",
        "",
        created.length ? `New files: ${created.join(", ")}` : "",
        "Diff:",
        diff.slice(0, MAX_WRITER_DIFF) || "(only new files)",
      ].join("\n"));
      return normalizeCommitMessage(answer) || fallback;
    } catch {
      return fallback;
    }
  }

  /** `mergeBase` is the commit the branch forked from, so the log and diffstat
   * are exactly what the pull request will contain. */
  async #pullRequestDraft(root: string, mergeBase: string, writer?: ChangeWriter): Promise<{ title: string; body: string } | undefined> {
    if (!writer) return undefined;
    const log = (await this.#git(root, ["log", "--format=%s%n%n%b%n---", `${mergeBase}..HEAD`])).stdout;
    const stat = (await this.#git(root, ["diff", "--stat", mergeBase, "HEAD"])).stdout;
    try {
      return parsePullRequestDraft(await writer([
        "Draft a GitHub pull request for the commits below.",
        "Return only JSON: {\"title\": \"...\", \"body\": \"...\"}.",
        "The title is imperative and at most 72 characters; the body is short Markdown with a",
        "Summary section and a Testing section that states only what the commits show.",
        "",
        "Commits:",
        log.slice(0, MAX_WRITER_DIFF / 2) || "(none)",
        "",
        "Diffstat:",
        stat.slice(0, 8_000),
      ].join("\n")));
    } catch {
      return undefined;
    }
  }
}

const ACTION_LABELS: Record<ShipAction, string> = {
  commit: "commit",
  commit_push: "commit and push",
  draft_pr: "open a draft pull request for",
  stacked_pr: "open a stacked draft pull request for",
};

/** A Markdown fence longer than any backtick run inside `text`. */
function fenced(text: string, info = ""): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${info}\n${text}\n${fence}`;
}

/** The prompt that hands a failed ship to the session's agent: what the
 * operator asked for, what HUI ran and saw, what already happened and what is left. */
export function delegationPrompt(options: { action: ShipAction; files: readonly string[]; message?: string; prTitle?: string; prBody?: string; error: ShipStepError }): string {
  const done: string[] = [];
  const { result } = options.error;
  const parent = result.stackedOn?.branch;
  if (result.stackedOn?.pushed) done.push(`- Pushed \`${parent}\` (pull request #${result.stackedOn.number}).`);
  if (result.createdBranch) done.push(`- Created and switched to branch \`${result.createdBranch}\`.`);
  if (result.commit) done.push(`- Committed ${result.commit.sha.slice(0, 7)} "${result.commit.subject}".`);
  if (result.pushed) done.push("- Pushed the branch.");
  const remaining: string[] = [];
  if (options.action === "stacked_pr" && !result.createdBranch) remaining.push(`create a new branch from \`${parent ?? "the current branch"}\``);
  if (!result.commit && options.files.length) remaining.push("commit the files listed below (only those files)");
  if (options.action !== "commit" && !result.pushed) remaining.push("push the branch");
  if (options.action === "draft_pr") remaining.push("open a **draft** pull request with a clear title and description");
  if (options.action === "stacked_pr") remaining.push(`open a **draft** pull request with \`--base ${parent ?? "the parent branch"}\` and a clear title and description`);
  return [
    `HUI tried to ${ACTION_LABELS[options.action]} this session's changes from the changes card and stopped at the ${options.error.step.replace("_", " ")} step:`,
    "",
    `> ${options.error.message}`,
    "",
    options.error.command ? `Command HUI ran:\n\n${fenced(options.error.command, "sh")}\n` : "",
    options.error.output ? `Its output:\n\n${fenced(options.error.output, "text")}\n` : "",
    done.length ? `Already done:\n${done.join("\n")}\n` : "",
    `Please diagnose the failure (for example a remote that moved to another URL or organization, missing credentials or a rejecting hook), fix what is safe to fix, then ${remaining.join(", ") || "finish the operation"}. Do not force-push, rewrite history or include unrelated changes; ask me if that seems necessary.`,
    options.files.length ? `\nFiles:\n${options.files.map((path) => `- \`${path}\``).join("\n")}` : "",
    options.message ? `\nRequested commit message:\n\n${options.message}` : "",
    options.action !== "commit" && options.action !== "commit_push" && options.prTitle ? `\nRequested pull request title: ${options.prTitle}` : "",
    options.action !== "commit" && options.action !== "commit_push" && options.prBody ? `\nRequested pull request description:\n\n${options.prBody}` : "",
  ].filter((line) => line !== "").join("\n");
}
