/**
 * The hand-offs an autonomous session never takes itself: merging a pull request, marking one ready for
 * review, and pushing to the default branch. They belong to the operator, who sees the pull request and
 * decides. HUI's tool-call hook refuses the shell command instead of trusting the prompt to hold.
 *
 * The check reads the command TEXT, so it catches `gh pr merge 12 --squash` anywhere in a compound shell
 * line. It cannot see a merge performed by a script the command invokes, a codemode script, or an editor
 * integration: those are out of reach here, and the prompt asks for the same restraint.
 */

const CREATE = /\bgh\s+pr\s+create\b/u;
const MERGE = /\bgh\s+pr\s+merge\b/u;
const READY = /\bgh\s+pr\s+ready\b/u;
const API_MERGE = /\bgh\s+api\b[^\n]*\/merge\b/u;
const PUSH = /\bgit\s+push\b([^\n]*)/u;
const DEFAULT_BRANCH_REF = /^\+?(?:refs\/heads\/)?(?:HEAD:)?(main|master)$/u;

/** The tokens of a `git push` invocation, flags left out, so a refspec can be compared exactly. */
function pushRefs(rest: string): string[] {
  return rest
    .split(/[\s;&|]+/u)
    .map((token) => token.replace(/^['"]|['"]$/gu, ""))
    .filter((token) => token.length > 0 && !token.startsWith("-"));
}

/**
 * Why this shell command is refused in autonomous mode, or undefined when it is allowed. Only the
 * default branch is protected: a feature branch, a force-with-lease push, and every read-only command
 * are the session's own business.
 */
export function prHandoffRefusal(command: string): string | undefined {
  const text = command.trim();
  if (!text) return undefined;
  if (MERGE.test(text) || API_MERGE.test(text) || READY.test(text)) {
    return [
      "HUI refused this: an autonomous session never merges a pull request and never marks one ready for review.",
      "Leave the pull request for the operator: report its link, what you changed, the checks that ran, and what still needs a person. The operator merges it, and decides when a draft is ready.",
    ].join(" ");
  }
  const push = PUSH.exec(text);
  const refs = push ? pushRefs(push[1] ?? "") : [];
  if (refs.some((token) => DEFAULT_BRANCH_REF.test(token))) {
    return [
      "HUI refused this: an autonomous session never pushes to the default branch.",
      "Work on a branch and open a pull request instead; the operator merges it.",
    ].join(" ");
  }
  return undefined;
}

/** The refusal a tool call earns, given the session's mode: only a shell command, only while autonomous. */
export function bashHandoffRefusal(toolName: string, args: unknown, autonomous: boolean): string | undefined {
  if (!autonomous || toolName !== "bash") return undefined;
  const command = (args as { command?: unknown } | undefined)?.command;
  return typeof command === "string" ? prHandoffRefusal(command) : undefined;
}

/**
 * Why opening a pull request is refused in autonomous mode, or undefined when the session has earned it: the check
 * command it declared has passed since the last change it made. Without a declared command the session is told to
 * declare one, which is the only way it can prove anything.
 */
export function prCreateRefusal(state: { command?: string; passedAt?: number }): string | undefined {
  if (state.command !== undefined && state.passedAt !== undefined) return undefined;
  const gap = state.command === undefined
    ? "no check command is declared for this session"
    : `the declared check (${state.command}) has not passed since your last change`;
  return [
    `HUI refused this pull request: ${gap}.`,
    "Declare the command that proves your work with declare_check, run it after your last edit, and open the pull request once it passes.",
  ].join(" ");
}

/** True when the command is a pull request creation, which the verification latch guards. */
export function createsPullRequest(command: string): boolean {
  return CREATE.test(command);
}
