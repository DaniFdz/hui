# Browser journey: shell navigation and responsive drawers

> Trimmed on 2026-10-22: Home, the sidebar's destinations, addresses, Back and
> Forward, leaving Settings, both drawers on a phone (portrait and short
> landscape for the navigation drawer), Escape closing a menu in the navigation
> drawer and then either drawer, widening the window with a drawer open and
> collapsing the sidebar are proven by `e2e/tests/shell/routes.e2e.ts` and
> `e2e/tests/shell/drawers.e2e.ts` (SHELL-001 to SHELL-007, SHELL-011 to
> SHELL-015). The step below is the one no shared test covers yet.

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

Finish by taking a desktop screenshot and checking Browser page errors. Do not
replace visible interactions with direct API calls.
