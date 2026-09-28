# Moving sessions between groups

Verified on 2026-09-24 with the OpenClaw Browser tool against an isolated HUI
Vite service at `http://localhost:5189/`. The browser used a disposable registry
under `/tmp/hui-session-move-yWHeGY`; no operator HUI registry, PI transcript or
credential was read or changed.

## Fixture

Registry version 2 contained the custom groups `Inbox`, `Research` and
`Shipping`, plus three synthetic PI session records. `Drag me between groups`
and `Move me from the menu` started in `Inbox`; `Ungrouped reference` started in
OTHER. The runtime did not need to start for this metadata-only journey.

## Browser journey

1. At 1440×900, drag **Drag me between groups** from INBOX onto the RESEARCH
   group header. The row leaves INBOX and renders under RESEARCH.
2. Open **Actions for Move me from the menu** and select **Move to SHIPPING**.
   The row renders under SHIPPING and the polite status reports
   `Moved Move me from the menu to SHIPPING.`
3. Reload the application. Both rows remain in their destination groups.
   Inspection of the isolated registry confirms `group: "Research"` and
   `group: "Shipping"`, with registry version 2 unchanged.
4. Emulate iPhone 13, open the navigation drawer and the session action menu.
   Every custom group plus OTHER is available as a touch/keyboard menu action;
   the current group is disabled. The menu remains within the viewport and is
   scrollable with the session list behind it.

The Browser tool recorded zero runtime errors and zero error-level console
messages.

## Automated checks

- `npm test -- src/views/shell.test.ts src/lib/sessions-store.test.ts`: 34 passed.
- `npm test`: 478 passed, no skips.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed before the final diff review.
