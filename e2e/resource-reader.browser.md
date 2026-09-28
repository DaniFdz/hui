# PI resource reader

Verified on 2026-09-24 with the OpenClaw Browser tool against an isolated HUI
configuration and disposable PI resources.

## Journey and result

- Opened the user-reachable Skills capability and selected **Read** on an
  inventoried skill. HUI rendered its `SKILL.md` in the native document modal.
- Opened Plugins and selected **Read** on a local package. HUI rendered the
  package `README.md` and kept the package row visible behind the modal.
- Opened a direct extension through its separate **Read** action. HUI displayed
  the JavaScript source as literal code; it did not execute the extension.
- Closed the modal and confirmed focus returned to the originating action.
- Repeated visual inspection at 1440×900 and with iPhone 13 emulation. The first
  mobile pass exposed the inherited stacked-header alignment; the scoped fix was
  hot-reloaded and the final pass kept title and 44 px close control in one row.
- Browser runtime errors: none.
- A long README regression pass confirmed the modal panel is bounded to the
  viewport and `.md-preview-dialog__body` owns the vertical scroll on desktop
  and mobile; scrolling reached the visible **End marker** without moving the
  fixed header.
- Reopened the `agent-reach` skill after removing the browser-default heading
  margin. Its title and `SKILL.md` path shared the same left edge at desktop and
  mobile widths, with the intended 6 px and 4 px vertical gaps respectively.
- Used the new copy action and confirmed its accessible label and icon changed
  from **Copy SKILL.md** to **Copied**. The mobile copy and close controls both
  measured 44×44 px.
- Replaced each visible **Read** label with the pinned OpenClaw eye icon across
  Skills and Plugins in both Settings and Capabilities. Every icon-only button
  retained a resource-specific accessible label and title, opened the reader,
  and measured 44×44 px on the 390×844 mobile pass without horizontal overflow.
- Centered the rendered/source chip vertically in its metadata strip: the final
  desktop and 390×844 passes measured 12 px above and 13 px below after border
  rounding, while its left edge stayed aligned with the title and file name.
- Increased only the reader eye action's trailing space so its measured gap to
  the enable toggle is 12 px on desktop and mobile.
- The post-restart regression rerun used the same connected Chromium over CDP
  because the OpenClaw browser wrapper was temporarily unavailable in
  `attachOnly` mode; the rendered desktop/mobile screenshots and DOM scroll
  measurements were still captured from the live app.

The server boundary was also exercised by focused tests for skill Markdown,
package README discovery, direct extension source, and rejection of ids outside
the current inventory. Missing package docs and the 256 KiB truncation path are
covered by the server implementation contract rather than a separate Browser
journey.

## Fixture

The disposable PI directory contained:

- `skills/reader-demo/SKILL.md`;
- a local `fixture-plugin` package with `README.md`, `package.json` and one
  declared extension;
- one configured `direct-extension.mjs`.

HUI ran through Vite on `http://localhost:5187` with
`PI_CODING_AGENT_DIR` and `XDG_CONFIG_HOME` pointed at the fixture. No operator
PI settings, sessions or credentials were changed.

## Checks

- Focused reader/config/view tests: 30 passed.
- Focused eye-icon and inventory view tests: 17 passed.
- `npm test`: 524 passed, no skips.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed before browser proof.
