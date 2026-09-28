# Browser journey: session registry and gateway restart

This HUI-03 journey exercises only visible controls against real PI processes.
It proves registry metadata, grouped search, a gateway restart, transparent
resume, and delete-without-transcript-deletion.

## Isolated setup

Create a disposable root and start the gateway with every PI/HUI path isolated:

```bash
HUI_E2E_ROOT="$(mktemp -d /tmp/hui-e2e-hui03.XXXXXX)"
mkdir -p "$HUI_E2E_ROOT/home" "$HUI_E2E_ROOT/xdg" \
  "$HUI_E2E_ROOT/pi-agent" "$HUI_E2E_ROOT/pi-sessions" \
  "$HUI_E2E_ROOT/workspace"
HOME="$HUI_E2E_ROOT/home" \
XDG_CONFIG_HOME="$HUI_E2E_ROOT/xdg" \
PI_AGENT_DIR="$HUI_E2E_ROOT/pi-agent" \
PI_CODING_AGENT_DIR="$HUI_E2E_ROOT/pi-agent" \
PI_CODING_AGENT_SESSION_DIR="$HUI_E2E_ROOT/pi-sessions" \
PI_OFFLINE=1 \
node bin/hui.mjs gateway
```

Record the printed URL and reuse exactly that URL after the restart. Open it in
a new managed Browser tab. Never use the operator's existing HUI tab or PI
directories.

## Visible-control journey

1. Create `Alpha session` in group `Sprint 03` with the isolated workspace and
   wait for `Idle`.
2. Create `Beta session` in the same group and wait for `Idle`.
3. Open navigation, pin Alpha, then open it. Use **Rename** to change its title
   to `Alpha renamed` and its group to `Archive 03`.
4. Search the sidebar by `Archive`, then collapse that group. Search by `Alpha`
   and assert the matching row appears; clear the search and assert the group is
   still collapsed.
5. Stop the gateway with `Ctrl+C`. Assert the open session visibly reports
   `Reconnecting…`. Restart the exact setup command so it binds the same URL.
   Assert the same route returns to `Idle` without a page reload or duplicate
   registry row.
6. Open a group's `⋯` menu and assert the OpenClaw action set: **New session
   defaults**, **Rename group**, **New group**, and **Delete group**. Save a cwd
   and runtime default, then use the group's `+` action and assert the New
   Session form is prefilled. Rename the group and verify its rows move
   atomically. Create and delete an empty group. On mobile, assert choosing an
   action closes the navigation drawer before its modal opens.
7. Navigate through the sidebar to **Sessions**. Search by group, open a result,
   and verify **New Session** navigates to the functional creation form.
8. Open Alpha, click **Delete**, press Escape, and assert focus returns to the
   Delete button. Open the dialog again and assert it explicitly says the PI
   transcript remains. Click **Remove from HUI**.
9. Assert Alpha is absent from `sessions.json`, Beta remains, and Alpha's
   isolated PI transcript sentinel/file still exists. Delete Beta through the
   same UI and assert the sidebar reports `0 sessions`.

Inspect Browser page errors and requests. SSE failures while the gateway is
deliberately down, stream aborts during navigation/deletion, and the known
missing-provider `400` from an optional prompt are expected. JavaScript/page
errors, model `409` loops, failed metadata requests, or a failed delete are not.

## Observed execution — 2026-09-22

- Isolated root: `/tmp/hui-e2e-hui03.09TRNb` (trashed after evidence capture).
- URL: `http://localhost:5174/`; Browser tab label: `hui03-e2e`.
- Created two real PI-backed sessions; both reached `Idle`.
- Pin, rename, regroup, group search, collapsed-group search, Sessions search,
  New Session navigation, Escape/focus return and both deletions passed.
- During the deliberate outage the selected session rendered `Reconnecting…`;
  after restarting the gateway at the same URL it returned to `Idle` and the
  registry still contained exactly two rows.
- `POST create/open`, `PATCH`, model discovery and both `DELETE` requests were
  `200`. The only request failures were the deliberate outage's SSE connection
  refusals/stream aborts and one expected unauthenticated prompt `400`.
- Browser page errors: `0`.
- After Alpha deletion, the registry contained only Beta while Alpha's isolated
  transcript sentinel still existed with unchanged contents.

After the final P2 fixes, a second isolated Browser run verified the session
action menu with ArrowDown, End and Escape (including focus return), and verified
the delete dialog with `:modal === true`, initial focus on Cancel, Escape focus
return, successful removal, and zero page errors.

## Cleanup

Close only the disposable Browser tab, stop the isolated gateway, and move the
recorded root to the system trash. Do not remove or mutate any operator data.
