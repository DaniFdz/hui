# Worktree creation progress Browser proof

Date: 2026-09-24

## Journey

1. Started HUI with `npm run dev -- --host 127.0.0.1` and opened New Session
   through the Browser tool.
2. Selected a disposable Git repository with 120 filtered files, entered a
   prompt, enabled `Create Git worktree`, named the branch and submitted through
   the visible controls.
3. Observed the streamed Git checkout percentage in the Web Awesome progress
   bar at desktop and mobile widths.
4. Waited for the progress surface to disappear and confirmed navigation to the
   newly registered session.

## Observed results

- Desktop `1440x900`: rendered `Checking out files` at 43% with the determinate
  bar matching the numeric value.
- Mobile `390x844`: rendered the same state at 35%, with no horizontal overflow.
- Completion navigated to `/sessions/f21edf3d-f624-44b5-addc-962657205d97`
  with the title `Verify mobile worktree progress · HUI`.
- Browser page errors: none.
- The progress overlay remained inside the existing composer geometry at both
  widths. Preparation/finalization use the same component indeterminately; Git's
  checkout and content-filter values are presented only when Git reports them.

The Git source repository and worktrees were disposable validation fixtures.
