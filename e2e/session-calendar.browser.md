# Contributions → Calendar

Run against `node e2e/visual-verification.mjs launch --branch <branch>
--activity-fixture`. `e2e/activity-fixture.ts` seeds the isolated store before
the gateway starts: eleven synthetic Durable sessions in six groups, worked
through the week before the current one (parallel sessions on Monday, Wednesday
and Thursday, a Wednesday night block from 10:40 PM to 1:55 AM) and two blocks
in the last few hours, plus one subagent session, which the calendar leaves out.
No operator session or PI transcript is read.

## Journeys

1. Sidebar **Contributions**, then the **Calendar** tab: the heading shows the
   current week (Monday to Sunday), *This week* and *Next week* are disabled,
   today's column is tinted with a line at the current time, and the recent
   *Calendar week view* blocks are drawn (or sit on Sunday night of the week
   before when it is earlier than 5 AM on Monday). Reloading keeps the tab.
2. **Previous week**: "Sep 28 – Oct 4"-style heading with 11 sessions, 22
   blocks and "up to 2 at once". Overlapping blocks (Monday morning, Wednesday
   afternoon) share their column in lanes. *Webhook double charge* runs in
   Wednesday's column from 10:40 PM past the 12:00 AM label to 1:55 AM.
3. The side panel reads "31h 10m across 11 sessions", a bar split by session,
   "Parallel sessions counted once · 34h 05m of session time" and every session
   with its time, *Pricing page redesign* (5h 45m) first. *Hours per day* labels
   Wednesday (7h 25m) as the busiest. The 9th to 11th sessions use the shaded
   colors, so no two share a color.
4. Click the Wednesday night block: the card beside it shows *Webhook double
   charge*, "Wed, Sep 30 · 10:40 PM – 1:55 AM · 3h 15m", the *checkout-api*
   chip, `claude-opus-5-5`, the first message "Store processed webhook event
   ids and add the failing test" and "4h 40m this week". Escape closes it and
   returns focus to the block. Clicking a session in the side list dims every
   other session's blocks until clicked again.
5. **Open session** in the card opens `/sessions/e2e-activity-2` with the
   seeded transcript.
6. Real activity: start a new session in the receipt's workspace and send
   `E2E_RICH`. Back on the Calendar tab, **Refresh** lists it in this week with a
   block at the current time and its first message in the card.
7. 390×844: the heading, summary and week buttons wrap; the grid scrolls
   sideways with the hour labels pinned and starts at today's column; the card
   opens below the block at the grid's width; the side panels follow the grid.
   Repeat 2–4 in dark and light (Settings → Appearance).

`?from=` empty, `1e3`, `0x10`, negative or more than 31 days apart return 400
(`server/session-activity.test.ts`).
