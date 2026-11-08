# Forensics

The deliverable is a cited diagnosis. Instrument the live process or read the captured
artifact; do not theorize from source.

1. Capture a real signal on the surface that shows the symptom. The gateway takes
   `node --cpu-prof --cpu-prof-dir=/tmp/prof bin/hui.mjs gateway run`, or
   `--heapsnapshot-signal=SIGUSR2` for a heap snapshot. A page takes the browser tool's console
   and a capture of the glitch. A capture handed over after the fact is a fixed dataset; read
   it, do not re-run it.
   Evidence: the artifact path, its format and its size.
2. Reduce the artifact to the smoking gun before reading source: the frames holding the most
   time, the retainer chain from the leaked object, or the loop firing without input. Parse a
   large artifact in an `explorer` child and keep the reduced finding in the lead.
   Evidence: the reduced finding in one paragraph and the query that produced it.
3. Reach a queryable shape when the artifact is large: one row per sample, frame or node into
   sqlite or NDJSON under `/tmp/<slug>/`, then query it instead of paging it.
   Evidence: the script path and the query.
4. Prove the mechanism before believing it. Add one temporary instrumentation line, run a small
   repro against the real process, or diff a paired capture. A frame with no source mapping is
   not yet a diagnosis.
   Evidence: the run that confirms or kills the mechanism.
5. Map the finding back to source: file, symbol, and the line that allocates, schedules or
   blocks.
   Evidence: `file:line` and the frame that reached it.
6. Hand back the diagnosis, not a fix, unless the operator asked for one. Route to `bug-fix.md`
   or `perf.md` once the cause is known.
   Evidence: the route taken, or `none`.
7. Keep the artifacts under `/tmp/<slug>/` and name every path in the reply.
   Evidence: the artifact list.

## Reply

The signal captured and its format, the reduced finding, how the mechanism was proved, the
source location, the artifact paths, and what the artifact cannot show. A finding only one
capture supports is the strongest hypothesis, not a confirmed cause.
