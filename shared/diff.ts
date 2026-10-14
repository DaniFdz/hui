/**
 * The Diff view's wire shapes: what `/__hui/sessions/:id/diff…` answers. The gateway (`server/git-diff.ts`,
 * `server/diff-routes.ts`) produces them; the browser (`src/lib/diff-store.ts`) consumes them. Every `path` is
 * relative to the conversation's working directory (the Files view's root), `/`-separated.
 */

/** What a Diff view compares the working directory against. */
export type DiffComparison = "uncommitted" | "last-commit" | "parent" | "default";

export const DIFF_COMPARISONS: readonly DiffComparison[] = ["uncommitted", "last-commit", "parent", "default"];

export function isDiffComparison(value: unknown): value is DiffComparison {
  return typeof value === "string" && (DIFF_COMPARISONS as readonly string[]).includes(value);
}

/** A local or remote-tracking branch the gateway offers as the base of "Against the previous branch". */
export type DiffBranch = {
  /** Full ref name, e.g. `refs/heads/feature-a` or `refs/remotes/origin/main`: the value a request sends back. */
  ref: string;
  /** Short name for display, e.g. `feature-a` or `origin/main`. */
  name: string;
  remote: boolean;
  /** Commits on HEAD that are not on this branch, when its tip is an ancestor of HEAD. */
  distance?: number;
};

/** How the previous branch was found: Git configuration first (gh's merge base, git-town's parent, a tracked
 * branch of another name), else the nearest branch whose tip is an ancestor of HEAD. */
export type DiffParentSource = "gh-merge-base" | "git-town" | "upstream" | "nearest";

/** `GET …/diff`: whether this conversation's changes can be shown, and which comparisons apply. */
export type DiffInfo =
  | { available: false; reason: string; code: "remote" | "not-repo" | "missing" | "git" }
  | {
      available: true;
      /** The working directory, `~`-abbreviated. */
      root: string;
      /** The working directory relative to the repository's top level (`""` at the top). Diffs cover only it. */
      subdirectory: string;
      /** The checked-out branch's short name; absent on a detached HEAD. */
      branch?: string;
      detached: boolean;
      /** The branch has no commit yet. */
      unborn: boolean;
      /** HEAD's abbreviated commit. */
      head?: string;
      /** Changed or untracked paths under the working directory (what "Uncommitted changes" shows). */
      uncommitted: number;
      lastCommit?: { sha: string; subject: string };
      /** The branch this one is stacked on, when one was found (detached HEAD: never). */
      parent?: DiffBranch & { source: DiffParentSource };
      /** Every branch the operator may pick as the previous branch instead: ancestors of HEAD first, nearest first. */
      branches: DiffBranch[];
      defaultBranch?: { ref: string; name: string };
      /** The comparisons that apply here, in menu order. */
      comparisons: DiffComparison[];
    };

/** `A`dded, `M`odified, `D`eleted, `R`enamed, `C`opied, `T`ype changed (file ↔ link), `U`nmerged. */
export type DiffFileStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U";

export type DiffFile = {
  path: string;
  /** The path before a rename or copy. */
  oldPath?: string;
  status: DiffFileStatus;
  /** Rename or copy similarity, 0-100. */
  similarity?: number;
  additions: number;
  deletions: number;
  binary: boolean;
  oldMode?: string;
  newMode?: string;
  /** The file's unified hunks (from its first `@@`, Git's file headers removed); `""` when only its name or mode
   * changed. Absent when it was not loaded (`truncated: "total"`) or the file is binary. */
  patch?: string;
  /** `"file"`: the patch stops at the per-file limit. `"total"`: the response limit was reached first; ask
   * `…/diff/file` for this one. */
  truncated?: "file" | "total";
};

/** One side of a comparison, for the header. */
export type DiffEndpoint = { label: string; sha?: string };

/** `GET …/diff/changes`. */
export type DiffChanges = {
  comparison: DiffComparison;
  base: DiffEndpoint;
  head: DiffEndpoint;
  /** The working tree (uncommitted and untracked files) is the head side. */
  includesUncommitted: boolean;
  files: DiffFile[];
  additions: number;
  deletions: number;
  /** Some patches were left out to stay within the response limit (their files say `truncated: "total"`). */
  truncated: boolean;
  /** Changed files beyond the listed limit. */
  filesOmitted: number;
  /** Untracked files beyond the limit, left out of the diff. */
  untrackedOmitted: number;
};

/** `GET …/diff/file`: one file of the same comparison, for a file `…/diff/changes` did not load. */
export type DiffFileChanges = { file: DiffFile | null };

/** A patch longer than this many lines opens collapsed in the view. */
export const DIFF_COLLAPSE_LINES = 1_500;
