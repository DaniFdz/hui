import { Type } from "typebox";

/** Title of the PI UI request HUI renders as the changes card. Keep in sync
 * with CHANGES_DECISION_TITLE in shared/session-changes.ts. */
export const CHANGES_DECISION_TITLE = "hui:propose_changes";

/** What the agent learns from the operator's answer (see ChangesDecision). */
export function changesDecisionText(raw) {
  let decision;
  try { decision = raw === undefined ? undefined : JSON.parse(raw); } catch { decision = undefined; }
  switch (decision?.outcome) {
    case "shipped": {
      const url = decision.result?.pullRequest?.url;
      return `The operator shipped the change from HUI's changes card: ${decision.summary}${url ? ` ${url}` : ""} Do not commit, push or open a pull request for it again. Confirm briefly and stop unless the operator asked for more.`;
    }
    case "failed":
      return String(decision.instructions || `HUI could not ship the change: ${decision.summary}`);
    case "iterate":
      return "The operator chose to keep iterating instead of shipping. Nothing was committed or pushed. Stop and wait for their next message; do not commit, push or open a pull request yourself. Call propose_changes again once the requested work is done.";
    case "replied":
      return "The operator dismissed the proposal and wrote to you instead. Nothing was committed or pushed. Follow their message; call propose_changes again when the change is ready.";
    default:
      return "The proposal was dismissed without a decision. Nothing was committed or pushed; do not commit or push it yourself.";
  }
}

/** HUI-owned decision point, like a question: the call shows the chat's
 * changes card and waits until the operator commits, opens or stacks a pull
 * request, or keeps iterating, then returns that decision. HUI runs Git itself;
 * this tool never commits, pushes or opens anything. */
export default function changesProposalExtension(pi) {
  pi.registerTool({
    name: "propose_changes",
    label: "Propose commit and pull request",
    description: "Hand the finished change to the operator and ask how to ship it, like a question: commit to the current branch (and its open pull request), open a new draft pull request, stack a draft pull request on the open one, or keep iterating. HUI shows its changes card with your commit message, pull request text and chosen action as the primary button. The call waits until the operator decides and returns what happened (shipped, failed with instructions, keep iterating or dismissed). HUI does the Git work; this tool never commits, pushes or opens anything itself.",
    promptSnippet: "Ask the operator how to ship finished code (commit, new PR, stacked PR or keep iterating); waits for the answer",
    promptGuidelines: [
      "When the requested code change is implemented in a Git checkout, call propose_changes to hand it over, instead of committing, pushing or opening a pull request yourself or writing a suggested commit message in prose. Do not call it while still investigating or iterating.",
      "The call blocks until the operator answers, so finish first: run the relevant tests and checks, review your diff, and have the commit message and pull request text ready. Nothing you do after calling happens until they decide.",
      "Do not call it when there is nothing left to hand over: you already committed, pushed or opened the pull request yourself because the operator asked, or the checkout has no changes of yours.",
      "The card covers only this session's checkout (its working directory). When the task changed other repositories or checkouts, say so in prBody or your reply, and ship those yourself only if the operator asked; otherwise list them so the operator can decide.",
      "Commit, push or open pull requests yourself only when the operator explicitly asks for it in the current request (permission from an earlier task does not carry over), or when git-selective-staging requires it because files you changed also hold someone else's uncommitted hunks: the card commits whole files.",
      "The call returns the operator's decision. After \"shipped\", do not repeat the commit, push or pull request. After a failure, follow the returned instructions. After \"keep iterating\" or a dismissal, commit and push nothing; continue only with what the operator asks, then call propose_changes again.",
      "Before calling, check whether the current branch has an open pull request: run `gh pr view --json number,title,baseRefName` (an error means there is none). Do not skip this check, even for small changes.",
      "Choose action. Without an open pull request: \"pr\" to open one for review (HUI creates a branch first when you are on the default branch), or \"commit\" when the change should only be added to the current branch. With an open pull request: \"commit\" only for work that is part of what that pull request already does (review feedback, fixes to its changes, finishing its described scope); \"stack\" for a new feature, section or behavior it does not contain that needs its unmerged code (it would not work on the base branch), even if it reuses that pull request's code or styles. Adding new scope to an open pull request is not \"commit\".",
      "With an open pull request, decide between commit and stack from what it actually contains: read its description and diff (`gh pr view --json body`, `gh pr diff --name-only`, then the relevant parts of `gh pr diff`), not only its title or your memory of it.",
      "commitMessage follows the repository's conventions (inspect recent `git log` subjects): an imperative subject of at most 72 characters, optionally a blank line and a short body explaining why.",
      "For pr and stack, give prTitle (short, imperative) and prBody (Markdown: what changed, why, and exactly which checks ran; never claim a check you did not run) for the new pull request.",
    ],
    parameters: Type.Object({
      action: Type.Union([Type.Literal("commit"), Type.Literal("pr"), Type.Literal("stack")], {
        description: "commit: add to the current branch and its open pull request; pr: open a new draft pull request; stack: open a draft pull request on top of the open one.",
      }),
      commitMessage: Type.String({ minLength: 1, maxLength: 4_000 }),
      prTitle: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      prBody: Type.Optional(Type.String({ maxLength: 20_000 })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!ctx?.hasUI) {
        return {
          content: [{ type: "text", text: "No operator interface is attached, so nothing was shown or shipped. Tell the operator the change is ready and include the proposed commit message; do not commit or push it yourself." }],
          details: { ...params, decision: { outcome: "unavailable" } },
        };
      }
      // Resolves with HUI's JSON answer, or undefined when the run is stopped.
      const raw = await ctx.ui.input(CHANGES_DECISION_TITLE, JSON.stringify(params), signal ? { signal } : undefined);
      let decision;
      try { decision = raw === undefined ? { outcome: "dismissed" } : JSON.parse(raw); } catch { decision = { outcome: "dismissed" }; }
      return {
        content: [{ type: "text", text: changesDecisionText(raw) }],
        details: { ...params, decision },
      };
    },
  });
}
