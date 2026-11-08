# Multi-phase or multi-PR plan

The plan is the deliverable. An owner runs it box by box and the operator audits it from the
evidence. Do not implement here.

1. Stop and say so when the change is one or two files with an obvious approach. A plan for
   that is cost without a decision.
   Evidence: the sentence delivered instead of a plan.
2. Settle every open question by prototype before writing the plan, and keep each sketch's
   path and captures. Ask the operator only about a product or preference call that no run can
   settle, and give options.
   Evidence: each question, the run that settled it, and the answer.
3. Explore in parallel: one `explorer` per area, returning file pointers, conventions, test
   commands and entry points. No inlined dumps.
   Evidence: the walkthroughs and the commands they name.
4. Write the plan to `work/<task>.md`, one section per pull request, each with depends on,
   files, build, what the operator sees, verify unit, verify live, verify perf, review gate and
   merge. Fill every field or delete it with a reason.
   Evidence: the section list.
5. Draw the dependency graph and the review-gated set. One pull request is one coherent change;
   a stack child targets its parent branch and the root targets `main`.
   Evidence: the graph and each `gh pr create --base <branch>` line.
6. Open every verification block with the rule: tests alone are not enough, and a pull request
   is verified only when its unit, live and perf boxes are checked.
   Evidence: the sentence in each block.
7. Make each live lane one concrete scenario on the real surface with the browser tool, a saved
   capture and a pass predicate, plus one regression lane running the same journey on the base
   branch. A perf lane names the metric, the probe, the baseline measured first, and the number
   that fails.
   Evidence: one line per lane with its capture path.
8. Name the execution playbook: `chief-mode` with `feature.md` or `bug-fix.md` per pull
   request, and who opens and merges each one. The operator lands them unless the plan says
   otherwise.
   Evidence: the named playbook and the merge owner.
9. Hand back with the plan path and stop. Execution starts on the operator's explicit go.
   Evidence: the path and the operator's reply.

## Reply

The plan path, the pull request IDs with their dependencies and the review-gated ones, what the
prototypes settled, what stays unproven, and the open decisions for the operator.
