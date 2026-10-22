# Browser journey: shell navigation and responsive drawers

> Trimmed on 2026-10-22: Home, the sidebar's destinations, addresses, Back and
> Forward, leaving Settings, both drawers on a phone (portrait and short
> landscape for the navigation drawer), widening the window with a drawer open
> and collapsing the sidebar are proven by `e2e/tests/shell/routes.e2e.ts` and
> `e2e/tests/shell/drawers.e2e.ts` (SHELL-001 to SHELL-007, SHELL-011,
> SHELL-012, SHELL-014, SHELL-015). The steps below are the ones no shared test
> covers yet.

This journey exercises only navigation and read-only pages; it does not create,
mutate, or delete PI data.

## Setup

Start HUI with `node bin/hui.mjs gateway`, open the printed localhost URL in an
OpenClaw-managed Browser tab, and reuse that tab throughout the journey. Clear
page-error logs before beginning.

## Desktop journey (1440x900)

1. Assert all 26 retained capability buttons are present. Assert Agents,
   Approval, Approvals, Apps, Channels, Cloud Workers, Custodian, Device,
   Devices, Lobsterdex, Meetings and Portals are absent.

## Narrow journey

Repeat at 390x844 and at landscape 844x390:

1. Open the navigation drawer, open a session's or a group's menu inside it and
   press Escape. Assert the menu closes and focus returns to its button; press
   Escape again and assert the drawer closes, `inert` is removed from the main
   region and focus returns to **Open navigation** on the same route.
2. Open `/settings/models` and its drawer, then press Escape. Assert the drawer
   closes, focus returns to **Open settings navigation** and the route stays
   `/settings/models`.

Finish by taking desktop and narrow screenshots and checking Browser page
errors. Do not replace visible interactions with direct API calls.
