# Browser journey: compaction marker and rewind across it

Verified on 2026-10-02 with the PI 0.87.1 SDK worker, HUI's real gateway and the
deterministic local provider, launched by `e2e/visual-verification.mjs`. No
operator PI credentials, sessions or HUI registry were used.

## Setup

New launcher sessions run on Durable, which loads no PI extensions: run steps
1–8 with `launch … --pi-sessions`, and the Durable journey below with the
default launcher. The launcher loads `e2e/compaction-extension.ts`, whose `fixture-compact`
command runs PI's own summarizer and resolves once the compaction entry is
written, and sets PI's `compaction.keepRecentTokens` to 400 so a few short turns
have something to summarize. The provider answers PI's summarizer request with
`FIXTURE_SUMMARY`; its request log is `artifacts/provider.jsonl`.

## Visible-control journey and observed results

1. Start a session in the printed workspace with `COMPACT_ONE`, then send
   `COMPACT_TWO` and a ~2,000-character `COMPACT_THREE kept kept …`. Each gets
   `Fixture response.`
2. Type `/fixture-compact`, complete it from the command menu and Send. When the
   command settles, a **Context compacted · from N tokens** divider follows the
   last turn; all three turns stay visible above it. **Show summary** expands
   `FIXTURE_SUMMARY`. The divider is a `separator` with that accessible name.
3. Rewind on `COMPACT_THREE` (inside PI's kept window). Its text returns to the
   composer; `COMPACT_ONE`, `COMPACT_TWO` and the divider remain. Send
   `AFTER_KEPT`: the provider request holds the summary and the new prompt only,
   none of the summarized turns.
4. Rewind on `COMPACT_TWO` (summarized). The divider disappears and the text
   returns to the composer. Send `AFTER_CUT`: the provider request holds the
   original `COMPACT_ONE` turn and no summary.

## Live compaction

Turns that mention `E2E_SLOW_COMPACT` make the provider hold PI's summary until
`POST <providerUrl>/control/release-replay` (fixture control, not UI proof).

5. Send `E2E_SLOW_COMPACT first turn`, then a ~2,000-character `LONG kept …`
   turn. `/comp` lists **/compact** among HUI's commands; complete it, add
   `keep the API decisions` and send. A live **Compacting context…** divider
   with the folding glyph replaces the working indicator; the header says
   Running and Stop is offered. The summarizer request carries the focus text.
6. Send `TYPED_DURING_COMPACTION`: it joins the queue above the composer as a
   follow-up instead of failing. Release the hold: the divider becomes the
   **Context compacted** marker and the queued message is sent and answered.
7. Open the context meter and choose **Compact now**: PI has nothing new to
   summarize, so a **Compaction failed** divider shows "Nothing to compact
   (session too small)" while idle. It disappears when the next turn starts.
8. Send `E2E_SLOW_COMPACT again`, another long turn, then `/compact`, and press
   Stop while it is held: **Compaction cancelled**, no marker is written.

## Durable sessions

Verified on 2026-10-03 with Pi Durable 1.0.1, the default launcher and the same
provider. The fixture model's 200k window keeps Durable's background compaction
from starting by itself, so only `/compact` and **Compact now** compact.

1. Start a session with `COMPACT_ONE first turn`, then send `COMPACT_TWO second
   turn` and a ~2,000-character `COMPACT_THREE kept kept …`. The header reads
   `durable · … · Idle`; no divider appears on its own.
2. Send `/compact keep the API decisions`. A **Context compacted · from N
   tokens** divider follows the last turn, all three turns stay above it, and
   **Show summary** expands `FIXTURE_SUMMARY`. The summarizer request carries
   `Additional focus: keep the API decisions` and only `COMPACT_ONE` and
   `COMPACT_TWO`: Durable kept `COMPACT_THREE` verbatim. N is Durable's own
   estimate; the fixture reports two tokens per request.
3. Rewind on `COMPACT_THREE`: its text returns to the composer and
   `COMPACT_ONE`, `COMPACT_TWO` and the divider stay. `AFTER_KEPT`'s request
   holds the summary and the new prompt only.
4. Rewind on `COMPACT_TWO`: the divider disappears. `AFTER_CUT`'s request holds
   `COMPACT_ONE` and no summary.
5. In a new session send `E2E_SLOW_COMPACT first turn`, a long turn, then
   `/compact keep the API decisions`: the live **Compacting context…** divider,
   Running and Stop. `TYPED_DURING_COMPACTION` joins the queue as a follow-up;
   after `POST <providerUrl>/control/release-replay` the marker appears and the
   queued message is sent and answered.
6. **Compact now** summarizes again: Durable rewrote its system prompt entry
   after the summary, and that entry alone exceeds `keepRecentTokens: 400`.
   Pressed again right away it shows **Compaction failed** with "Nothing to
   compact (session too small)".
7. Send `E2E_SLOW_COMPACT again` and a long turn, then a bare `/compact` (send
   it with the button; Enter completes the command menu) and press Stop while
   it is held: **Compaction cancelled**, no marker.

## Limits

Automatic threshold and overflow compaction are covered by
`server/runtimes/pi-sdk.test.ts` rather than this journey: the fixture model
reports tiny token counts, and lowering PI's reserve would compact every
launcher session.
