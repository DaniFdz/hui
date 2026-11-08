# Prototype

Speed over polish. The sketch is a throwaway instrument and its only output is a decision. No
tests, no abstractions, no build step, and nothing merged.

1. Name the decision the sketch exists to settle: which layout, which interaction, which
   density, or which behavior, timing or approach. No decision means no prototype; route to
   `feature.md`.
   Evidence: one line naming the decision and the two or more options.
2. Build in `/tmp/<slug>/`, never in the checkout: one `index.html` with inline styles and one
   script, or one Node script for a timing question. Serve it from a static server already on
   the machine, for example `python3 -m http.server 4321`, and open it with the browser tool.
   Evidence: the directory path and the command that served it.
3. Put competing variants behind one switcher, each labeled, so the same screen shows every
   option.
   Evidence: the variant names and one capture with the switcher visible.
4. Observe the thing being decided, not the code: capture each variant at 1440×900 and
   390×844, or log the timing, output or render count and paste it.
   Evidence: the captures and the log.
5. Present the options with their tradeoffs and a recommendation, using `present_media` for the
   captures and `show_widget` only when an option is better clicked than described.
   Evidence: the media paths and the reason for the recommendation.
6. Hand the chosen direction to `feature.md`, or to `planner` for the shape, and say plainly
   that the sketch is throwaway. Delete it, or leave it in `/tmp` and never in the tree.
   Evidence: the route taken and the scratch path.

## Reply

The decision the sketch settled, the variants explored, the evidence for each, the tradeoffs,
the recommendation, and the scratch path. Say that nothing in the repository changed.
