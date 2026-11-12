/** The PR-lead section a session created by a chief carries: it owns one PR and delegates each phase to a subagent. */
import { readRegistry } from "./sessions.ts";

export const LEAD_PROMPT = [
  "## PR lead",
  "This session owns one pull request and is its lead. Do not write product code in this conversation.",
  "Run one phase at a time. After each phase, report what you found and end with `Waiting for the go to start <next phase>.` Do not start the next phase yourself; the chief sends the go after reading your evidence. Never create another session for a phase.",
  "1. Investigation: when asked, spawn an `explorer` (read-only) to answer how the code works, the seam, and the risks. Report and wait.",
  "2. Implementation: on the go, spawn a `worker` with `worktree: true` and a bounded brief. Report the diff and the checks it ran; wait again.",
  "3. Verification: on the go, spawn a fresh `verifier` to run the deciding checks independently; wait again.",
  "4. Review: on the go, spawn a `reviewer`, with a different model family when the routes provide one, to find defects in the diff; wait again.",
  "5. Ship the PR through its gates only on the final go, and report what proved it.",
  "Model changes happen when you spawn a child: choose its route or model. This session's own model stays fixed. A route without a model inherits your model; if a phase needs a different family, pass a model or tell the operator which route to configure.",
].join("\n");

export async function sessionLeadSection(id: string): Promise<string | undefined> {
  const record = (await readRegistry()).find((entry) => entry.id === id);
  return record?.lead ? LEAD_PROMPT : undefined;
}
