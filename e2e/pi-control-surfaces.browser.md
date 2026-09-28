# PI control surfaces — Browser E2E evidence

Validated against the running HUI gateway on 2026-09-23. Read-only coverage used
the installed PI configuration; mutation coverage used an isolated PI agent
directory and a deterministic PI wrapper, never the operator's PI files.

## Desktop

At 1440×1000, navigate directly to each route and wait for
`Reading PI and HUI state…` to disappear:

- `/connection`
- `/config`
- `/model-providers`
- `/model-setup`
- `/skills`
- `/plugins`
- `/plugin`
- `/skill-workshop`
- `/memory-import`
- `/worktrees`

Observed for every route:

- the page-owned OpenClaw-style header rendered once;
- PI/HUI data replaced the loading state;
- no alert was present;
- `document.documentElement.scrollWidth - innerWidth` was `0`;
- Workshop, memory and worktree mutation controls were absent.

The live model projection reported the PI default, authenticated provider names
and 50 models without returning a credential value. Connection reported HTTP +
SSE, Full Access, gateway uptime and distinguished one registered session from
zero live runtimes. The Worktrees `Sessions` control was exposed as a keyboard-
operable link and navigated to `/sessions`.

## Package and skill mutation flows

With `PI_CODING_AGENT_DIR`, `HOME`, `XDG_CONFIG_HOME` and `PATH` pointed at a
disposable fixture, Browser exercised visible controls for:

- installing `https://pi.dev/packages/demo-package`, observing the disabled
  working state, `OK`, and the refreshed installed row;
- requesting removal, seeing the inline Cancel/Remove confirmation, confirming,
  and observing `OK` plus the removed row;
- submitting a non-pi.dev package URL and receiving an `Error` alert;
- installing a skill URL, observing the disabled agent-running state, then `OK`
  only after the fixture wrote a discoverable `SKILL.md`;
- a second skill run that exited successfully but discovered no new skill,
  which correctly rendered `Error` rather than a false success.

The package controls were also present under `/settings/plugins`; the Skills
form was present under both capability and Settings routes. At 390×844 the
forms stayed inside the viewport with zero horizontal overflow.

## Mobile and Settings

Using an iPhone 13 viewport (390×664), validate:

- `/settings/connection`
- `/settings/models`
- `/settings/plugins`
- `/settings/skills`
- `/settings/memory`
- `/worktrees`

All six pages rendered without alerts or horizontal overflow. The five Settings
routes retained their responsive settings drawer and Worktrees retained the app
shell drawer behavior.

A controlled PI refresh failure was then injected after Plugins had loaded.
Settings kept the last good package projection visible and rendered a retryable
`Refresh failed` alert beside it, proving that one failed source neither blanks
the other control surfaces nor masquerades as a successful refresh. After the
failure was removed, activating **Retry** issued a forced reload and cleared the
alert while retaining the package view.

## Transport and browser health

The Browser request log showed successful `200` responses for `/__hui/pi`,
`/__hui/health`, `/__hui/workspaces` and `/__hui/sessions`. Browser page errors
and error-level console messages were both empty at the end of the run.

## Security boundaries exercised by automated tests

The companion deterministic tests prove that:

- workspace memory symlinks cannot escape the registered workspace;
- OpenClaw-owned memory is excluded;
- NUL-delimited Git worktree paths are parsed without truncation;
- package URLs redact userinfo and query strings;
- package catalog URLs accept only clean `https://pi.dev/packages/<name>`
  values and resolve removal labels back to one exact configured source;
- package/skill mutations are serialized and a successful skill-agent exit
  without a newly discovered skill remains an error;
- the PI model probe uses no session, extensions, skills or context files.
