# Sidebar groups and Filter & Sort

Verified on 2026-09-24 using the OpenClaw Browser tool against the running HUI
Vite service. All registry and PI data lived in a disposable temporary root.
The real PI runtime used the deterministic local provider, without operator
credentials or a paid model call.

## Fixture and reproduction

Create a temporary root (`HUI_GROUPS_RUN`) containing `xdg/hui`, `pi-agent`,
`pi-sessions`, `workspace`, `other-project` and `browser` directories.

Seed `xdg/hui/sessions.json` with version 2, an empty `groups` array and these
three synthetic records. All have `group: ""`, `tool: "pi"`, `source: "hui"`,
and timestamps in ISO format at 12:00 UTC on the listed dates:

| ID | Title | Directory under fixture root | Created | Updated | Pinned |
| --- | --- | --- | --- | --- | --- |
| pin | Pinned note | workspace | 2026-09-20 | 2026-09-20 | true |
| alpha | Alpha recently created | other-project | 2026-09-23 | 2026-09-21 | false |
| zulu | Zulu recently updated | workspace | 2026-09-21 | 2026-09-24 | false |

Seed HUI settings with `theme: "catppuccin"` and use Browser color-scheme
emulation. Set up the local Anthropic-compatible model as described in
[session-launch.browser.md](session-launch.browser.md), using port 43157,
provider `hui-e2e`, model ID `fixture` and name `Local fixture`. Point PI's
default provider/model to this fixture and keep packages/extensions/skills empty.
The API key is only the literal fixture marker, not an operator credential.

Start the provider and gateway in separate terminals from the checkout, with
an environment stripped of provider credentials (retain PATH/HOME/USER/LANG):

```sh
HUI_E2E_PROVIDER_PORT=43157 \
HUI_E2E_WORKSPACE="$HUI_GROUPS_RUN/workspace" \
HUI_E2E_PROVIDER_LOG="$HUI_GROUPS_RUN/provider.jsonl" \
node e2e/fixtures/pi-provider-fixture.mjs

XDG_CONFIG_HOME="$HUI_GROUPS_RUN/xdg" \
PI_CODING_AGENT_DIR="$HUI_GROUPS_RUN/pi-agent" \
PI_CODING_AGENT_SESSION_DIR="$HUI_GROUPS_RUN/pi-sessions" \
PI_OFFLINE=1 NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1 \
node --input-type=module -e 'import {createServer} from "vite"; const server=await createServer({server:{hmr:false,host:"127.0.0.1",port:5188,strictPort:true}}); await server.listen(); server.printUrls();'
```

Use an owned headless Chromium profile under the fixture root, with CDP on
18800, and navigate via Browser to `http://localhost:5188/`. Stop only owned
provider/gateway/browser/PI processes afterwards; leave fixture data available
for inspection. No operator registry or transcripts are modified.

## Browser journeys and observed results

The shared tests in `e2e/tests/sess/` (`sidebar-filters.e2e.ts`, `session-groups.e2e.ts` and `group-defaults.e2e.ts`)
now prove creating groups, search, sort, grouping, the status filter, Hide empty groups and the group Git defaults.
What is left here is the keyboard and the menu's layout on small screens (SESS-041).

1. On iPhone 13 emulation (390×664 CSS px, DPR 3), open navigation and the Filter & sort menu.
   **End** scrolls the last option, Never, into view; Enter applies it. Escape
   closes the menu, returns focus to Filter & sort and leaves the drawer modal.
2. Select **Hide empty groups → Always** using End/ArrowUp/Enter, then **When filtering** the same way.
3. Repeat the menu inspection at 844×390 landscape; the menu flips above the
   trigger, remains in bounds and scrolls. Resize the open drawer to desktop:
   the drawer state clears and main is not left inert. Desktop menu selection
   also works with Home/ArrowDown/Enter.

The portrait menu measured x=40…264, y=225…654 with scrollable content (737 px
content, 427 px client height). Landscape measured x=232…456, y=10…187. There
was no horizontal overflow in the document, main, sidebar or menu. Screenshots
were visually inspected. Browser recorded **zero runtime errors and zero
error-level console messages**.

## Proof limits and checks

All five live status values, pin precedence, duplicate project-directory names,
invalid saved preferences, empty-group policies and source-data non-mutation
are covered by focused unit tests. Project grouping is by exact directory, not inferred Git-repository identity.
Owners, archival state, message previews and system-session classifications are
not exposed because this registry does not supply them.

- `npm test -- src/lib/session/sidebar-sessions.test.ts src/views/shell.test.ts src/views/home.test.ts src/views/sessions.test.ts`: 66 passed.
- `npm test`: 369 passed, no skips.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Group Git defaults journey

Use `visual-verification.mjs` with a disposable repository on `feature/current`,
its `origin/HEAD` pointing to `main`, and a `release/1.0` branch at a distinct
commit. Create a group through the UI, then open **New session defaults**.
Operate the Working directory, Environment and Base branch selectors from the
keyboard on desktop, portrait and landscape, with no clipping and no new page
or console errors.
