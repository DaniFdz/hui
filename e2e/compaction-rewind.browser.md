# Browser journey: compaction marker and rewind across it

Verified on 2026-10-02 with the PI 0.87.1 SDK worker, HUI's real gateway and the
deterministic local provider, launched by `e2e/visual-verification.mjs`. No
operator PI credentials, sessions or HUI registry were used.

## Setup

New launcher sessions run on Durable, including their PI extensions. The
first steps describe PI-worker compaction semantics: use `launch … --pi-sessions` for
those, and the default launcher for the Durable journey below. The launcher loads `e2e/fixtures/compaction-extension.ts`, whose `fixture-compact`
command runs PI's own summarizer and resolves once the compaction entry is
written, and sets PI's `compaction.keepRecentTokens` to 400 so a few short turns
have something to summarize. The provider answers PI's summarizer request with
`FIXTURE_SUMMARY`; its request log is `artifacts/provider.jsonl`.

## Visible-control journey and observed results

The shared tests `e2e/tests/chat/compaction.e2e.ts` and `worker-compaction.e2e.ts` cover the
divider, Show summary and rewinds across a summary on PI's worker and on Durable, live
compaction, the queue and Stop on PI's worker, an overflow, Compact now's failure on Durable and
the context meter (CHAT-036, CHAT-038 to CHAT-040), so those steps are gone from here.

On PI's worker (`launch … --pi-sessions`), with turns that mention `E2E_SLOW_COMPACT`, which
makes the provider hold PI's summary until `POST <providerUrl>/control/release-replay`:

1. Send `E2E_SLOW_COMPACT first turn`, then a ~2,000-character `LONG kept …`
   turn. `/comp` lists **/compact** among HUI's commands; complete it, add
   `keep the API decisions` and send. The summarizer request carries the focus text.
2. Open the context meter and choose **Compact now**: PI has nothing new to
   summarize, so a **Compaction failed** divider shows "Nothing to compact
   (session too small)" while idle. It disappears when the next turn starts.

## Durable sessions

Verified on 2026-10-04 with Pi Durable 1.0.1, the default launcher and the same
provider. The fixture model's 200k window keeps Durable's background compaction
from starting by itself, so only `/compact` and **Compact now** compact. Durable
sessions keep Durable's semantics: a manual compaction runs beside the
conversation, which stays idle.

1. Start a session with `COMPACT_ONE first turn`, then send `COMPACT_TWO second
   turn` and a ~2,000-character `COMPACT_THREE kept kept …`. The header reads
   `durable · … · Idle`; no divider appears on its own.
2. Send `/compact keep the API decisions`. The summarizer request carries
   `Additional focus: keep the API decisions` and only `COMPACT_ONE` and
   `COMPACT_TWO`: Durable kept `COMPACT_THREE` verbatim. The N in **Context
   compacted · from N tokens** is Durable's own estimate; the fixture reports two
   tokens per request.
3. In a new session send `E2E_SLOW_COMPACT first turn`, a long turn, then
   `/compact keep the API decisions`: the live **Compacting context…** divider
   with **Cancel compaction**. The header stays `Idle`, the composer reads
   "Send a message…", there is no Stop, and **Compact now** is disabled.
4. Send `SENT_WHILE_COMPACTING`: it is answered at once, and its request holds
   the whole history and no summary. The live divider stays below the new turn.
5. `POST <providerUrl>/control/release-replay`: **Context compacted** follows
   the turn answered meanwhile.
6. Send `E2E_SLOW_COMPACT again` and a long turn, then a bare `/compact` (send
   it with the button; Enter completes the command menu) and press **Cancel
   compaction** while it is held: **Compaction cancelled**, no marker.

## Limits

Automatic threshold compaction is covered by
`server/runtimes/pi-sdk.test.ts` rather than this journey: the fixture model
reports tiny token counts, and lowering PI's reserve would compact every
launcher session. The shared test's `E2E_OVERFLOW` turn covers an overflow. Durable's background compaction (idle session, survives Stop
and Cancel, dropped by `/clear`) and Stop cancelling a manual compaction are
covered by `server/runtimes/durable.test.ts`.
