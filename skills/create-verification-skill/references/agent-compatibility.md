# Agent compatibility

## Discovery

Inspect the active host's configured skill roots or use its supported listing
command. Directory conventions are not interchangeable. Keep project source in
the repository's existing convention, or `.agents/skills/verify-<app>/` when none
exists, and link that file from `AGENTS.md`/contributor guidance for explicit use.
Verify automatic discovery separately from the ability to open a file.

- **OpenClaw:** check `openclaw skills list`/`openclaw skills info --help` to
  confirm the relevant agent and discovered file. The active workspace is not
  necessarily the application's checkout. Use the configured workspace loader
  or an explicit repository-file reference; do not assume a skill in an arbitrary
  worktree enters every session's catalog. Author managed live skills through
  Skill Workshop when available; ordinary repository-owned skills use repository
  edits and review, even when they share a name with a managed skill.
- **HUI / PI:** HUI's enabled built-in generator is available to HUI-owned
  sessions. For the generated project verifier, inspect PI's active resource
  discovery paths and project instructions. Do not confuse HUI bundling with
  installing into global PI state or assume `.agents/skills` is auto-scanned.
- **Codex, Claude Code, Cursor or another host:** inspect its current discovery
  settings and supported skill directories. Reuse canonical source via a
  supported registration/reference; add a compatibility copy only when the
  loader requires it and document how that copy stays in sync. Validate loading
  rather than assuming symlinks or another host's frontmatter flags work.

Do not require a slash-command syntax that the host lacks. Naming the skill and
reading its file is a valid explicit invocation; automatic discovery needs proof.

## Browser or desktop UI

Use the active agent's browser/computer tools when available. On OpenClaw, the
Browser tool provides status, tabs, snapshot, act, errors and screenshot; inspect
the current tool schema, keep the same owned target and re-observe after state
changes. On another host, use its equivalent capabilities or the repository's
existing browser harness. No Cursor-specific browser or cloud agent is required.

Use semantic controls and real input. Read-only evaluation can inspect rendered
state, network or geometry; DOM mutation does not demonstrate a user action.
If only an external browser harness is available, record that adapter explicitly.
When the runtime lacks a required capability, retain partial results and state
the precise missing proof; respect the host's tool restrictions.

## Other surfaces

For a CLI, retain command, stdout, stderr and exit code. A TUI needs a real owned
PTY or terminal session, input events and resulting terminal state. For services,
exercise public endpoints and observable persistence/side effects. For libraries,
run a minimal consumer against the built artifact, not only a private helper.
Choose only adapters needed by the project; a CLI verifier needs no browser.
