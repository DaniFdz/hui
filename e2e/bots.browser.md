# Bots tab browser verification

Date: 2026-10-05. The full journey ran against `feat/bots-ui` at `093f1a9`
(stacked on `feat/bots` at `67ad1e8`); after rebasing onto `feat/bots` at
`fc8df08` (backend and CLI commits only) a shorter smoke ran again (see the end).
Both were launched with `e2e/visual-verification.mjs` and
driven with the Browser tool (OpenClaw's managed profile attached to an owned
headless Brave on CDP port 18800). Only the model provider is mocked
(`e2e/pi-provider-fixture.mjs` answers every turn with "Fixture response.");
HUI, the gateway's `/__hui/bots` routes and event stream, Pi Durable,
Automation and the browser are real. This build has no OptChat memory (PR 1 is
not stacked under `feat/bots` yet), so the gateway answers the memory routes
with 503. No operator transcript, credential or account was used.

## Reproduce

1. From the checkout: `node e2e/visual-verification.mjs launch --branch
   feat/bots-ui`, then `doctor` on the receipt (before and after the Browser
   work). On a host whose environment sends HTTP through a proxy
   (`HTTP_PROXY` with `NODE_USE_ENV_PROXY=1`), unset those variables for the
   launcher: its ownership check talks to its own loopback instance.
2. Open the receipt's `browserUrl` at 1440×900. The fresh instance has the
   Bots tab off.

## Observed (1440×900 unless noted)

1. Before the switch the sidebar toolbar reads SESSIONS with Filter & sort and
   New group, as before, and no tab strip renders.
2. Settings → Sessions → Bots → **Show the Bots tab** turned on; the footer
   read "Settings saved locally" and the instance's `settings.json` held
   `"bots":{"showTab":true}`.
3. Back in the app the toolbar became the **Sessions | Bots** tablist. Bots →
   "No bots yet", the explanation and a New bot button; the tab survives in
   `hui.sidebar-tab`. ArrowLeft/End moved selection and focus between the tabs
   with a visible focus ring.
4. The toolbar's + opened **New bot**. Scout, 🔭, Research assistant and
   instructions were typed; Create bot closed the dialog only once the gateway
   answered and opened `/bots/<id>`: header "🔭 Scout · Research assistant ·
   Idle", the empty chat "Say hi to Scout / Research assistant" and the
   Routines panel.
5. "Hi Scout, what can you do?" was sent from the composer; the reply "Fixture
   response." streamed in, signed "Scout". User messages offer Reply and Copy
   but no Rewind. The roster row turned to "Fixture response." through
   `/__hui/bots/events` about a second later.
6. The slash menu listed /btw, /reload, /side, /update and PI's commands, no
   /clear or /compact. "/clear" + Enter showed the error toast "A bot keeps one
   permanent chat, so /clear is not available here…" and kept the draft. (While
   checking the menu the Browser `type` action replaced the "/" draft and a
   stray ordinary message "clear" was sent; it stays in the transcript.)
7. Routines: Inbox digest, "Summarize my inbox in three lines.", Daily (the
   default) at 08:00 → Add routine listed "Daily at 08:00 · next 10/6/2026,
   8:00:00 AM" and collapsed the form; the Routines tab counted 1. **Run now**
   put "[routine: Inbox digest] Summarize my inbox in three lines." and its
   reply in the chat; Latest runs read "Inbox digest · Completed · Run now ·
   10/5/2026, 8:29:35 PM · Fixture response.".
8. Memory → "OptChat memory is not available in this build of HUI." with Retry
   (the gateway's 503 text). Zooming and the memory page could not run here.
9. A second bot, Ledger without an emoji, showed its initial on a palette
   color; the roster orders by latest activity.
10. Row menu → **Edit bot…** opened the dialog with Scout's values; Title →
    "Research lead" → Save closed it after the PATCH; the header and
    `GET /__hui/bots` then read Research lead, the roster "Saved Scout.".
11. Row menu → **Hide** on Ledger: "Show hidden (1)" appeared; it listed Ledger
    with a Hidden tag; **Unhide** returned it and the toggle went away.
12. Sessions tab: "No sessions yet."; session search "Scout": "No matching
    sessions." — while `GET /__hui/sessions` listed both bot chats (Ledger,
    Scout) in `ungrouped`. Kanban showed no bot chat, the command palette had
    no result for "Scout", `/sessions` counted 0 sessions, and Automations
    labelled the task "Bot · Scout" with no bot chat among its targets.
13. An ordinary session started from New session in the fixture workspace
    appeared under OTHER, alone.
14. Row menu → **Archive…** on Scout: the confirmation (focus on Cancel) →
    Archive removed it from the roster and showed "Archived “Scout”. Its chat
    and memory are kept." with Restore; `GET /__hui/automation` showed the
    routine disabled. **Restore** brought Scout back ("Restored Scout. Its
    routines stay paused until you turn them on.") with the routine switch off.
15. 390×844: the bot chat's header has the navigation button, avatar, name and
    role; the drawer shows the tab strip and roster with the main region inert;
    the panel toggle opens a 380 px sheet with a backdrop and focus on the
    selected tab, and Escape closes it and returns focus to the toggle; the New
    bot dialog fits the width and scrolls. 844×390: the sheet docks on the right
    and its body scrolls. The document never got wider than the viewport.
16. Browser page errors: none. The console's errors were the browser's
    failed-request lines for 503 memory reads, repeated every three seconds while
    the Memory tab stayed open; the commit after the run stops polling a memory
    the gateway reports unavailable.

## Evidence

Screenshots of both runs (desktop 1440×900, mobile 390×844 and landscape
844×390: switch, empty roster, New bot dialog, chat with reply and Routines,
Memory, hidden roster, Sessions without bot chats, archive confirmation, drawer,
sheet) were captured from the running instances and inspected; they are kept
outside the repository and are not committed.

## Limits and gaps

- No OptChat in this build: the Memory panel's stats, line zoom down to a
  message and Open memory page were not exercised in the browser. Their parsing
  and requests are unit-tested (`src/lib/bot-memory.test.ts`,
  `src/lib/bots.test.ts`); rerun steps 8 once `feat/bots` includes PR 1.
- Headless Brave reports no hover, so touch-sized controls show; touch input
  itself was not emulated.
- The provider is deterministic; no real model or memory compactor was used.
