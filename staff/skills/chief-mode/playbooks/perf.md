# Performance

You own the numbers. Do not read source in place of measuring.

1. Build and measure a baseline on the built app, not the dev server: `npm run build`, then
   the gateway. For anything a session open, a transcript or a list sends, follow
   `e2e/remote-loading.browser.md` with its slow-link proxy.
   Evidence: the number, its unit, and the artifact path.
2. Name what limits the number before touching code (bytes down, requests, frames redrawn,
   rows built, event-loop time). A ceiling claimed without a run is a guess.
   Evidence: one sentence naming the limit and the run that shows it.
3. Trace it. The gateway takes
   `node --cpu-prof --cpu-prof-dir=/tmp/prof bin/hui.mjs gateway run`, the page takes the
   browser tool's console and performance entries, and a repeated sample takes a script a
   `watcher` can rerun. Reduce a large profile in an `explorer` child and keep the finding.
   Evidence: the profile path and the hot frames.
4. Apply the mantras in order and stop at the first that meets the target: do not do it, do
   not do it again, do it less, do it later, do it when nobody is looking, do it concurrently,
   do it cheaper.
   Evidence: the mantra chosen and the work it removes.
5. Check the performance rules in `AGENTS.md` that own this path. A fix that breaks one is not
   a fix; a new kind of slowness adds a row and a test at the boundary that owns it.
   Evidence: the rule and its enforcing test.
6. Delegate the smallest change the trace justifies to one `worker`, with the measurement
   method in the brief.
   Evidence: the diff and the worker's numbers.
7. Re-measure with the same command, state, link and viewport. Interleave the two sides when
   the number is noisy, and never compare two unlike scenarios.
   Evidence: baseline and after, both with units, and the delta.
8. Verify what the operator sees: the conversation opens, the list scrolls, the frame draws, at
   1440×900 and 390×844.
   Evidence: browser captures and the rendered state.
9. Run `opening-a-pr.md`, with one primary number in `## Verification` as before and after,
   plus the profile path.
   Evidence: the pull request URL and `gh pr checks <number>`.

## Reply

Baseline, after, delta, what limited the number, the artifact paths, and what the number does
not prove.
