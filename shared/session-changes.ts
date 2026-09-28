/**
 * Code a session has prepared in its Git checkout, as shown by the chat's
 * changes card (T3 Code's "ready" card, Hermes' changed-files card). Paths are
 * relative to the repository root. `files` compares the working tree with the
 * branch's merge base, so it is what a pull request would contain once the
 * uncommitted files are committed.
 */
export type ChangedFileStatus = "added" | "modified" | "deleted";

export type ChangedFile = {
  path: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  binary?: true;
  /** Present in `git status`; only these can be selected and committed. */
  uncommitted: boolean;
  /** Written by this session's edit/write tools (loaded transcript only). */
  session: boolean;
};

export type ChangesPullRequest = {
  number: number;
  url: string;
  title: string;
  draft: boolean;
};

export type SessionChanges =
  /** Not a Git checkout; a pending proposal still needs an answer. */
  | { available: false; proposal?: ChangesProposal }
  | {
      available: true;
      /** Current branch; empty on a detached HEAD. */
      branch: string;
      /** Default branch pull requests target, e.g. `main`. */
      base: string;
      isDefaultBranch: boolean;
      /** Push target remote (`origin` when present); absent without remotes. */
      remote?: string;
      upstream?: string;
      /** Commits not on the upstream. Without one: not on the remote-tracking
       * branch or the open pull request's head, else every commit since `base`. */
      unpushed: number;
      behind: number;
      /** Commits since the merge base with `base`. */
      commits: number;
      files: ChangedFile[];
      /** Every changed path. `files` lists at most 200, keeping this session's
       * uncommitted files, then other uncommitted files, then committed ones. */
      totalFiles: number;
      additions: number;
      deletions: number;
      /** Open pull request whose head is this branch, when `gh` could tell. */
      pullRequest?: ChangesPullRequest;
      /** The \`propose_changes\` call waiting for the operator's decision, if any. */
      proposal?: ChangesProposal;
      /** Stable while nothing changes; the card's dismissal key. */
      signature: string;
    };

/** Commit message and pull request text the session's agent proposed through
 * the `propose_changes` tool, while that call waits for the operator's
 * decision. The card prefills its editable fields with them. */
export type ChangesProposal = {
  commitMessage: string;
  prTitle?: string;
  prBody?: string;
  /** How the agent wants the change shipped; the card makes it the primary action. */
  action?: ProposedAction;
  /** The pending PI UI request; the decision answers it. */
  key: string;
};

/** `commit`: add to the current branch (and its open pull request, if any).
 * `pr`: open a new draft pull request. `stack`: open a draft pull request on
 * top of the branch's open one. */
export type ProposedAction = "commit" | "pr" | "stack";
const PROPOSED_ACTIONS: readonly ProposedAction[] = ["commit", "pr", "stack"];

const PROPOSAL_LIMITS = { commitMessage: 4_000, prTitle: 200, prBody: 20_000 } as const;

/** Tools whose successful calls write files in the session's checkout. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "multiedit", "notebookedit"]);

/**
 * `propose_changes` blocks on a PI `input` UI request with this title, exactly
 * like a question, and carries its arguments as JSON in `placeholder`. HUI
 * renders that request as the changes card instead of the question dock and
 * answers it with a {@link ChangesDecision}. Keep in sync with
 * `server/runtimes/changes-proposal-extension.mjs`.
 */
export const CHANGES_DECISION_TITLE = "hui:propose_changes";

type QuestionLike = { id: string; method: string; title?: string; placeholder?: string };

export function isChangesDecision(question: QuestionLike | undefined): boolean {
  return question?.method === "input" && question.title === CHANGES_DECISION_TITLE;
}

/** The proposal a pending `propose_changes` request carries. */
export function changesProposalFromDecision(question: QuestionLike | undefined): ChangesProposal | undefined {
  if (!question || !isChangesDecision(question)) return undefined;
  let source: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(question.placeholder ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    source = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const text = (key: keyof typeof PROPOSAL_LIMITS) => {
    const value = source[key];
    return typeof value === "string" ? value.replace(/\r\n?/gu, "\n").trim().slice(0, PROPOSAL_LIMITS[key]) : "";
  };
  const commitMessage = text("commitMessage");
  if (!commitMessage) return undefined;
  const prTitle = text("prTitle").replace(/\s+/gu, " ");
  const prBody = text("prBody");
  const action = PROPOSED_ACTIONS.find((value) => value === source["action"]);
  return {
    commitMessage,
    ...(prTitle ? { prTitle } : {}),
    ...(prBody ? { prBody } : {}),
    ...(action ? { action } : {}),
    key: question.id,
  };
}

/** The operator's answer to a pending `propose_changes` call, returned to the
 * agent as the tool result. `shipped`: HUI committed, pushed or opened the pull
 * request. `failed`: HUI stopped at a step and the agent finishes it following
 * `instructions`. `iterate`: the operator wants more work before shipping.
 * `replied`: the operator wrote a message instead of choosing. */
export type ChangesDecision =
  | { outcome: "shipped"; summary: string; result: ShipResult }
  | { outcome: "failed"; summary: string; instructions: string; result: ShipResult }
  | { outcome: "iterate" }
  | { outcome: "replied" };

/** One-line confirmation of what HUI did. */
export function shipSummary(result: ShipResult): string {
  const parts: string[] = [];
  if (result.stackedOn?.pushed) parts.push(`pushed ${result.stackedOn.branch}`);
  if (result.createdBranch) parts.push(`created ${result.createdBranch}`);
  if (result.commit) parts.push(`committed ${result.commit.sha.slice(0, 7)} “${result.commit.subject}”`);
  if (result.pushed) parts.push("pushed");
  if (result.pullRequest) parts.push(`${result.pullRequest.existing ? "pull request" : "opened draft pull request"} #${result.pullRequest.number}${result.stackedOn ? ` stacked on #${result.stackedOn.number}` : ""}`);
  const text = parts.join(", ") || "Nothing to do";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export type ReadyChanges = Extract<SessionChanges, { available: true }>;

/** `stacked_pr` commits on a new branch created from a branch that already has
 * an open pull request and opens a draft pull request based on that branch. */
export type ShipAction = "commit" | "commit_push" | "draft_pr" | "stacked_pr";
export const SHIP_ACTIONS: readonly ShipAction[] = ["commit", "commit_push", "draft_pr", "stacked_pr"];

/** What the card sends to ship; empty fields are written by the utility model. */
export type ShipInput = {
  action: ShipAction;
  files: readonly string[];
  message?: string;
  prTitle?: string;
  prBody?: string;
};

export type ShipResult = {
  branch?: string;
  /** Branch HUI created: from the default branch for a draft PR, or on top of
   * the pull request branch for a stacked one. */
  createdBranch?: string;
  /** The branch and pull request a stacked pull request is based on. */
  stackedOn?: { branch: string; number: number; pushed?: true };
  commit?: { sha: string; subject: string };
  pushed?: boolean;
  pullRequest?: { number: number; url: string; existing?: true };
};

export type ShipResponse =
  | { outcome: "completed"; result: ShipResult; changes: SessionChanges }
  /** HUI could not finish; the session's agent was asked to do it instead. */
  | { outcome: "delegated"; error: string; result: ShipResult; changes: SessionChanges };

export type FileDiff = { path: string; diff: string; truncated: boolean };

/** The card lists at most this many rows before "Show all": two whole rows and
 * half of the third, which hints that the list continues. */
export const COLLAPSED_FILE_ROWS = 2.5;

/** Card order: the uncommitted files this session wrote (what gets committed),
 * then other uncommitted files, then files already committed on the branch;
 * alphabetical within each. Independent of the selection, so rows never jump. */
export function orderChangedFiles(files: readonly ChangedFile[]): ChangedFile[] {
  const rank = (file: ChangedFile) => (file.uncommitted ? (file.session ? 0 : 1) : 2);
  return [...files].sort((left, right) => rank(left) - rank(right) || left.path.localeCompare(right.path));
}

/** The card is a pending decision, like a question: it shows exactly while
 * the session's agent waits in a `propose_changes` call, whatever the checkout
 * holds, and disappears once the operator ships or keeps iterating. */
export function changesReady(changes: SessionChanges | undefined): changes is ReadyChanges {
  return Boolean(changes?.available && changes.proposal);
}

/** The card's primary action: the agent's proposed one when the checkout
 * allows it, otherwise Open draft PR without a pull request and Commit & push
 * with one. */
export function proposedShipAction(changes: ReadyChanges): ShipAction {
  const action = changes.proposal?.action;
  if (!changes.remote) return "commit";
  const pr = changes.pullRequest;
  if (action === "stack" && pr && changes.branch && changes.files.some((file) => file.uncommitted)) return "stacked_pr";
  return action === "commit" || pr ? "commit_push" : "draft_pr";
}

/** Files the card preselects. Once the session wrote any listed file (even one
 * already committed), only its own uncommitted files are preselected, so a
 * shared checkout's other work is never swept into a commit; a session with no
 * recorded edits preselects every uncommitted file. */
export function defaultShipSelection(changes: SessionChanges | undefined): string[] {
  if (!changes?.available) return [];
  const uncommitted = changes.files.filter((file) => file.uncommitted);
  if (!changes.files.some((file) => file.session)) return uncommitted.map((file) => file.path);
  return uncommitted.filter((file) => file.session).map((file) => file.path);
}
