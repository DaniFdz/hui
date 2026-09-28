# Provenance

Adapted from Lauren Tan's pstack `create-verification-skill` in
[cursor/plugins](https://github.com/cursor/plugins/tree/ecc249f1e306fc64ddf83c7bed16cacf7c2239db/pstack/skills/create-verification-skill),
revision `ecc249f1e306fc64ddf83c7bed16cacf7c2239db` (reviewed 2026-09-26).
The original [MIT license](LICENSE) is retained. The feature-map examples derive
from that revision and are illustrative, not runnable dependencies. They clarify
external evidence storage and restore browser results before the search capture.

This adaptation retains repository inspection, Launch/Doctor/Drive/Evidence/
Cleanup/Helpers, the feature map and an end-to-end proof. It replaces Cursor-only
output paths with repository-owned canonical source and explicit host discovery;
adds capability-based adapters for OpenClaw, HUI/PI and other agents; distinguishes
fixture/backend proof; and documents transient PR image delivery through `gh`.
It does not require `/maintain-verification-skill` or any other pstack component.

Unlike the upstream manual-only entry, this adaptation is discoverable for the
narrow generator task. Enabling it makes it available; it does not create a
verifier on startup or replace an existing project verification workflow.
