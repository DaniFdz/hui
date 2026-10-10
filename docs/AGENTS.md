# Documentation Guide

This directory owns implementation planning, API contracts, and measured OpenClaw
surface coverage. Product direction remains in `SPEC.md`; onboarding stays in
`README.md`.

- `guide.md` holds user reference too long for the README landing page (Nix,
  desktop, remote access, providers). `assets/banner.html` is the README banner
  source; regenerate both PNGs with the command in its header comment.
- `map.md` is the short code map: areas, their owning modules and the path of a
  message. Update it when ownership moves or a source directory is added.
- `api.md` is the normative browser/server session contract. Update it with any route,
  event, ownership, status, or lifecycle change.
- `implementation-roadmap.md` tracks iterative work and dependencies. Mark work done
  only after its implementation and required tests, including Browser-tool E2E proof
  for user-visible behavior.
- `control-ui-coverage.md` records measured parity with the referenced OpenClaw version.
  Distinguish cloned structure from implemented PI-backed functionality.
- Document current verified behavior, not intentions as facts. Include commands and
  proof limits when they materially affect reproducibility; never include credentials,
  private paths/data, or generated bundle dumps.
- For documentation-only edits, run `git diff --check` and verify links/code examples
  against the current source. Behavior changes also follow the owning code guide.
