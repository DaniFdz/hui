# Bots tab browser verification

Date: 2026-10-05. `feat/bots-ui` rebased onto `feat/bots` at `dfde0e8`, where
OptChat memory is wired: the memory routes answer for real, a same-origin link
opens the memory page and `""` clears a bot's model and thinking. The full
journey below ran at `d3cecb3` and again, with the screenshots kept for review,
at the commit that adds this record (documentation only since `d3cecb3`). Both
runs were launched with `e2e/visual-verification.mjs` and driven with the
Browser tool (OpenClaw's managed profile on a headless Brave that another
agent's labeled tab shared; that tab was left alone). Only the model provider is
mocked (`e2e/pi-provider-fixture.mjs`): every turn answers "Fixture response.",
and OptChat's compactor gets one short line per summary, `<kind>:
FIXTURE_MEMORY <first E2E_/OPT_ marker>`, held while the message carries
`E2E_HOLD_MEMORY` until `POST /control/release-replay` on the fixture. HUI, the
gateway's `/__hui/bots` routes and event stream, Pi Durable, OptChat,
Automation and the browser are real. No operator transcript, credential or
account was used.

The first version of this journey (at `093f1a9`, before OptChat was wired) saw
the Memory tab only as the gateway's 503 text; this one supersedes it.

## Reproduce

1. From the checkout: `node e2e/visual-verification.mjs launch --branch
   feat/bots-ui`, then `doctor` on the receipt (before and after the Browser
   work). On a host whose environment sends HTTP through a proxy
   (`HTTP_PROXY` with `NODE_USE_ENV_PROXY=1`), unset those variables for the
   launcher: its ownership check talks to its own loopback instance.
2. Open the receipt's `browserUrl` at 1440×900. The fresh instance has the
   Bots tab off.
3. Messages over 512 bytes are summarized by a compactor call; shorter ones are
   their own summary lines. The long message below (667 characters) is
   "OPT_NOTES Notes for later, keep them word for word: ", then "the blue door
   opens at nine and the archive closes at five; " ten times, then
   `E2E_HOLD_MEMORY`.
4. Browser-tool notes: in code mode the snapshot text does not reach the cell,
   so refs come from a labeled snapshot's `annotations` and actions use role
   selectors (`role=button[name='Create bot']`). The Settings switch is a
   `wa-switch`; click its host (`wa-switch:has-text('Show the Bots tab')`),
   whose inner input reports as covered.

## Observed (1440×900 unless noted)

1. Before the switch the sidebar toolbar reads SESSIONS with Filter & sort and
   New group, as before, and no tab strip renders.
2. Settings → Sessions → Bots → **Show the Bots tab** on; the footer read
   "Settings saved locally".
3. The toolbar became the **Sessions | Bots** tablist; Bots → "No bots yet",
   the explanation and a New bot button.
4. The toolbar's + opened **New bot**: its Model and Thinking pickers start on
   *Gateway default*. Scout, 🔭, Research assistant and instructions were
   typed, Model *HUI SDK Fixture* and Thinking *High* picked; Create bot closed
   the dialog once the gateway answered and opened `/bots/<id>`: "Scout ·
   Research assistant · Idle", "Say hi to Scout" and the Routines panel.
5. "Hi Scout, what can you do?" from the composer: "Fixture response." streamed
   in, signed "Scout".
6. Routines: Inbox digest, "Summarize my inbox in three lines.", Daily at 08:00
   → Add routine listed "Daily at 08:00 · next …". **Run now** put "[routine:
   Inbox digest] Summarize my inbox in three lines." and its reply in the chat;
   Latest runs read "Inbox digest · Completed · Run now · … · Fixture
   response.".
7. **Memory**: Messages 4, View 0.1/128 KB, Lines 4, Pending summaries 0,
   "Summarizer since the gateway started: No model calls yet" (short messages
   are their own lines), and the view's four `id+1` lines, e.g. "2+1 user:
   [routine: Inbox digest] Summarize my inbox in three lines.".
8. With the Memory tab open, the long message was sent. Without Refresh, the
   panel moved to 6 messages and 6 lines with pending summaries and
   "(not summarized yet: zoom it)" lines. "Anything new today?" then waited
   for its memory: *Summarizing memory…* in the panel, in the header ("Research
   assistant · Summarizing memory…") and in the roster row. Releasing the held
   compactor reply (fixture control) let that turn answer, and the panel moved
   by itself to 8 messages, 8 lines, 0 pending, "1 call · 1 token in, 1 out",
   with line 4+1 reading "user: FIXTURE_MEMORY OPT_NOTES".
9. Clicking 4+1 expanded it (`aria-expanded="true"`) to "message 4" with the
   whole original message, word for word, ending in `E2E_HOLD_MEMORY`.
10. **Open memory page** opened a new tab at `/__hui/bots/<id>/memory/html`:
    "OptChat memory of Scout" with "View · 8 lines", "ROOT · 8 messages" and
    each tree level; no 403.
11. With the Memory tab open and the bot idle, the browser's network log showed
    no memory read for 9 s: nothing polls it.
12. A second bot, Ledger (Bookkeeper, no emoji), showed its initial on a
    palette color; the roster orders by latest activity.
13. Row menu → **Edit bot…** on Scout showed Model *HUI SDK Fixture* and
    Thinking *High*; both set to *Gateway default* → Save closed the dialog
    after the PATCH and the roster read "Saved Scout."; `GET /__hui/bots/scout`
    then had neither `model` nor `thinking`, and Edit opened on *Gateway
    default* for both.
14. Row menu → **Hide** on Ledger: "Show hidden (1)" listed it with a Hidden
    tag; **Unhide** returned it and the toggle went away.
15. Sessions tab: "No sessions yet."; session search "Scout": "No matching
    sessions.".
16. Row menu → **Archive…** on Scout: the confirmation (focus on Cancel) →
    Archive removed it from the roster, showed the "Archived “Scout”" toast and
    **Show archived (1)**. Turned on, it listed Scout (avatar, role) with
    **Restore**; Restore brought Scout back to the roster with "Restored Scout.
    Its routines stay paused until you turn them on.", dismissed the toast and
    removed the toggle; `GET /__hui/automation` showed the routine disabled.
17. Automations: the routine's row read "Inbox digest · Bot · Scout · Daily at
    08:00".
18. With Ledger archived, loading its `/bots/<id>` address showed "Ledger is
    archived. Its chat and memory are kept; restore it to open the chat again."
    with Restore, and neither its chat nor the panel; Restore opened its chat.
19. 390×844: the bot chat's header has the navigation button, avatar, name and
    role; the drawer shows the tab strip and roster with the main region inert;
    the panel toggle opens the Memory tab as a 380 px sheet with focus on the
    selected tab; the New bot dialog fits the width and scrolls. 844×390: the
    sheet docks on the right and its body scrolls. The document never got wider
    than the viewport.
20. Browser page errors: none. Console errors: none.

## Evidence

Screenshots of the final run (desktop 1440×900, mobile 390×844 and landscape
844×390: roster with two bots, chat with a reply and a routine run beside the
Routines panel, Memory with its stats and a line zoomed to its message, the
memory page, the New bot dialog, the Settings switch, Show archived, drawer and
sheets) were captured from the running instance and inspected; they are kept
outside the repository and are not committed.

## Limits and gaps

- A view keeps one line per message until it outgrows its 128 KB budget, so the
  browser zoomed a message line straight to its message. Opening a summary of
  several messages into its two halves is covered by
  `src/lib/bot-memory.test.ts` (parsing) and `server/bot-routes.test.ts` (the
  route), not by this journey.
- The fixture reports one token each way and no cost, so the cost the panel
  shows once a provider reports one is unit-tested only.
- A reconnect's cached first frame (`isNewBotsFrame`) is unit-tested; no
  reconnect was forced in the browser.
- Headless Brave reports no hover, so touch-sized controls show; touch input
  itself was not emulated.
- The provider is deterministic; no real model or compactor model was used.

## Agents | Bots at the top (2026-10-06)

The owner asked for Hermes's layout, then for the switch above everything
else, because the two tabs give the sidebar different contents. At `9492644`
it moved from the sessions toolbar to just under the header buttons and its
first tab was renamed Agents; at `8d1a1b5` it became the first thing in the
sidebar, a full-width tab bar over a divider, in sentence case. Checked at
`8d1a1b5` on the launcher with `--pi-sessions` (doctor before and after;
cleanup closed every port), with two bots created through `POST /__hui/bots`
(Scout 🔭, Ledger) and one session started from Home's composer, in headless
Chromium through CDP: one browser with a fine, hovering pointer at 1440×900
and a separate touch-like one at 390×844.

1. Agents, the default: the tab bar is the sidebar's first element (two
   119×36 px tabs at 14 px over the divider), then the header buttons (New
   session, *Search sessions*, Collapse sidebar), the navigation, the SESSIONS
   toolbar and the session list.
2. Bots: no navigation and no New session; the header keeps *Search bots* and
   Collapse sidebar, then a BOTS header with its **+** (New bot) and the
   roster (Ledger, Scout). The lists are one tab panel, labelled by the
   selected tab.
3. A bot's page keeps the Bots tab. ArrowLeft on the focused tab selects
   Agents and moves focus to it; ArrowRight goes back to Bots.
4. 390×844: the drawer opens on the same tab bar with 44 px tabs; a tapped
   tab keeps no hover tint; the document stays 390 px wide.
5. With *Show the Bots tab* off, no tab bar renders and the sidebar starts
   with its header buttons, as on `main`.
6. Browser page errors: none. Console errors: none.

## The collapse toggle in one place (2026-10-06)

The owner reported that the restore control sat on top of a bot's avatar and
that toggling the sidebar meant moving the mouse a long way. He also asked to
drop the header's New session and Search buttons, which he never uses.

Measured first on the preview at `d344ad4` (headless Chromium through CDP, fine
pointer, 1440×900). The collapse toggle sat at (217, 54) and the restore control
at (10, 10), a 207 px left and 44 px up move. On a bot page the restore control
covered the bot's 28 px avatar: the bot chat runs in an embedded pane app, so
the session header's collapsed padding never reached it.

Checked at `4480d18` on the launcher with `--pi-sessions` (doctor before and after;
cleanup closed every port), with two bots created through `POST /__hui/bots`
(Ledger, and Scout 🔭) and one session started from Home's composer:

1. The sidebar's top row is Collapse sidebar, then the Agents | Bots tabs: one
   48 px row whose labels share the chat header's centre line. The header has
   no other control.
2. Every route was checked: Home, the session, both bots, Contributions,
   Automations, Kanban, Plugins and Skills. On each, the toggle and the restore
   control both sit at (10, 10), 28×28, so there is no mouse travel. Nothing
   visible lies under the restore control, it is the topmost element at its
   centre, and a second click on the same spot re-expands the sidebar.
3. Focus moves to Expand sidebar on collapse and back to Collapse sidebar on
   expand.
4. With the Bots tab off the top row holds only Collapse sidebar, at the same
   spot, with the same results on every route.
5. 390×844, in a separate touch-like browser: the drawer opens on the tab bar,
   without the toggle. With the Bots tab off it starts with the navigation at
   the drawer's top padding (fixed in `4da7cb3` and checked on a fresh launcher
   at that commit). The document stays 390 px wide.
6. Browser page errors: none. Console errors: none.
