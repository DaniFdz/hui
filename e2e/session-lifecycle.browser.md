# Browser journey: PI session lifecycle

This is the first repeatable Browser-tool journey for HUI. The shared tests in
`e2e/tests/sess/` now prove starting, opening and removing a session, and
`launch-errors.e2e.ts` how a new session reports PI's rejection of its first
prompt (SESS-062). What is left here is that a new session asks for its models
once, and how another tab sees a removed session end (SESS-066).

## Isolated setup

Run this from the repository root in a dedicated terminal. Do not reuse the
operator's normal HUI registry or PI directory.

```bash
HUI_E2E_ROOT="$(mktemp -d /tmp/hui-browser-e2e.XXXXXX)"
mkdir -p "$HUI_E2E_ROOT/home" "$HUI_E2E_ROOT/config" \
  "$HUI_E2E_ROOT/pi-agent" "$HUI_E2E_ROOT/pi-sessions" "$HUI_E2E_ROOT/workspace"
HOME="$HUI_E2E_ROOT/home" \
XDG_CONFIG_HOME="$HUI_E2E_ROOT/config" \
PI_AGENT_DIR="$HUI_E2E_ROOT/pi-agent" \
PI_CODING_AGENT_DIR="$HUI_E2E_ROOT/pi-agent" \
PI_CODING_AGENT_SESSION_DIR="$HUI_E2E_ROOT/pi-sessions" \
PI_OFFLINE=1 \
node bin/hui.mjs gateway
```

Record the printed local URL. The expected URL is `http://localhost:5173/`
when that port is free. Keep the server terminal open for the journey.

Use an isolated OpenClaw-managed browser profile. Start it if necessary, open
the printed URL once, and reuse that tab for every action:

```bash
openclaw browser doctor --json
openclaw browser start
openclaw browser open http://localhost:5173/
openclaw browser tabs --json
```

Capture the returned tab reference (for example `t2`) as `TARGET` in the
commands below. Clear the request and page-error logs before beginning:

```bash
openclaw browser requests --target-id "$TARGET" --clear --json
openclaw browser errors --target-id "$TARGET" --clear --json
```

## Visible-control journey

1. Snapshot the page with `openclaw browser snapshot --target-id "$TARGET"
   --format ai`. Fill **Project directory** with the exact isolated path
   `$HUI_E2E_ROOT/workspace`, click **Start session** and take fresh snapshots
   until the session reads `Idle`. Do not call a session API directly. Inspect
   requests filtered by `/models`: exactly one exists, it occurs after the
   session opens, and its status is `200`, never a `409` loop.

Always take a fresh snapshot after navigation or rerender before reusing an
element reference. If a reference is stale, recover with a new snapshot; do
not switch to coordinate clicks.

## Final diagnostics

Inspect the journey's network and browser state:

```bash
openclaw browser requests --target-id "$TARGET" --filter '__hui/sessions' --json
openclaw browser errors --target-id "$TARGET" --json
openclaw browser console --target-id "$TARGET" --level error --json
```

Assert:

- create, open, event stream, model list, delete, and final list requests are
  successful;
- model discovery is one `200` request and never a `409` loop;
- deletion is `200` and the event stream abort caused by deletion is expected;
- the page-error list is empty.

## Cleanup

Close only the tab opened for this journey, stop the isolated server with
`Ctrl+C`, and move the recorded `$HUI_E2E_ROOT` directory to the system trash.
Do not delete or alter any pre-existing session, PI transcript, credential, or
browser tab.

## Observed execution — 2026-09-22

The journey above was executed after the frontend session-race fixes with an
isolated fixture and no operator data:

- fixture root: `/tmp/hui-browser-e2e-review.OkOTRc` (removed after the run);
- HUI registry: isolated through that root's `config/` directory;
- PI agent directory: isolated through that root's empty `pi-agent/` directory;
- workspace: that root's empty `workspace/` directory;
- URL: `http://localhost:5174/`;
- OpenClaw Browser tab: a new managed tab, closed after the run;
- session title: `Browser E2E final verification`.

Visible Browser-tool actions and snapshots:

1. The initial snapshot showed **Home**, `0 sessions`, and the four creation
   controls named in this runbook.
2. Browser fill set the workspace and title; Browser click activated **Start
   session**.
3. The next settled snapshot showed `1 sessions`, the disposable title,
   `pi · ungrouped · Idle`, model **Big Pickle**, and an enabled **Message**
   composer.
4. Browser type entered `Reply with exactly: HUI_BROWSER_E2E_OK`; Browser click
   activated **Send**. The next snapshot showed the user turn, the expected
   missing-credential status, and `Idle`.
5. Browser click activated **Delete** and then **Remove from HUI**. The final
   snapshot showed `0 sessions`, **No sessions yet**, the new-session form,
   and no prior prompt or credential error.

Observed request evidence for the final clean run:

- `POST /__hui/sessions` → `200`;
- `GET /__hui/sessions` → `200`;
- `POST /__hui/sessions/<fixture>/open` → `200`;
- `GET /__hui/sessions/<fixture>/events` opened successfully and was aborted
  when the selected session was deleted;
- exactly one `GET /__hui/sessions/<fixture>/models` → `200`;
- `POST /__hui/sessions/<fixture>/prompt` → `400`, with the expected missing
  `opencode` credential message from the empty PI fixture;
- `DELETE /__hui/sessions/<fixture>` → `200`;
- final `GET /__hui/sessions` → `200`.

Browser diagnostics:

- page errors: empty (`[]`);
- console: one journey-specific failed-resource entry for the expected prompt
  `400`; no model `409`, JavaScript exception, or repeated model request;
- cleanup: disposable session deleted through the UI, tab closed, isolated
  server stopped, and the fixture root removed.

### Combined-tree SSE close verification

The final combined frontend/backend tree was also exercised on 2026-09-22 at
`http://localhost:5174/` with a fresh isolated registry and the disposable
session `Browser E2E SSE close`:

1. Tab A created and opened the session; its snapshot showed `Idle`.
2. Tab B opened the same HUI URL through visible navigation and selected that
   session, establishing a second event stream.
3. Tab A clicked **Delete** and **Remove from HUI**. Its final snapshot showed
   `0 sessions`, a clean Home form, and no session-scoped feedback.
4. Tab B received the terminal stream notification and rendered
   `pi exited — this session is no longer streaming.` without a reload. Both
   tabs reported an empty page-error list.

This second observation proves the durable DELETE and visible SSE-close path;
the browser network recorder labels the completed long-lived stream
`net::ERR_ABORTED`, while the fresh terminal status in Tab B is the observable
application-level evidence that the server sent `closed` before the stream
ended.
