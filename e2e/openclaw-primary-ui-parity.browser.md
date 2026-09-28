# OpenClaw primary UI parity — Browser proof

Validated on 2026-09-23 against OpenClaw 2026.9.4 and the HUI development
server. The reference was opened from its authenticated Brave profile; HUI was
opened through the Browser tool. This proves the ported primary surfaces, not
all retained capability shells.

## Surfaces and measurements

- Chat, desktop 1440×900: 258 px sidebar, 48 px chat header, 1182 px main,
  768×112 composer centred at x=465.
- Chat with desktop sidebar collapsed, at both 1440 px and the 1110 px
  breakpoint edge: the 32 px restore control occupies x=10–42 while the
  session identity starts at x=50. Their measured overlap is 0 px, the full
  session title and runtime metadata remain visible, and expanding restores
  the normal 12 px pane-header inset.
- The chat header contains identity only: Rename, Pin/Unpin and Delete are
  owned by each session's sidebar menu, while New Session is owned by the
  sidebar create controls. Browser opened Rename and Delete through that menu;
  on mobile the drawer closed and released `inert` before the editor/dialog
  became active.
- New Session, desktop 1440×900: 768 px welcome column at x=465; composer at
  y=348, within one pixel of the OpenClaw reference.
- Sessions, desktop: page-owned header and tabs, transcript search, filters and
  dense registry table; the earlier duplicate generic header is absent.
- Settings, desktop: 288 px settings navigation and 760 px content column.
- Chat, New Session, Sessions and Settings at 390×844 and 844×390: document and
  main scroll widths equal their client widths. The mobile Settings drawer
  makes content inert, closes with Escape and restores focus to its trigger.
  Chat keeps its own in-header navigation control and does not inherit the
  desktop collapsed-sidebar inset; the control and session identity have 0 px
  overlap.

## Functional journey

From New Session, Browser entered an isolated project directory and the prompt
`Reply exactly HUI_PARITY_OK`. HUI created a real PI session, stayed in the
`starting` state until PI reported `idle`, sent the pending prompt once, and
rendered the answer in the ported chat surface. A deterministic unit regression
also covers the starting/live/opening gate.

The Browser page-error log was empty after the final navigation. No fixed sleeps
were used as correctness conditions; checks synchronized on rendered state and
runtime status.

## Theme and component-color matrix

Browser selected Catppuccin through Appearance Settings and exercised both
Light and Dark controls rather than injecting CSS variables. Computed styles
were checked on Chat, New Session, Sessions and Settings at 1440×900 and
390×844.

- The active document exposed `data-theme="catppuccin"`, the selected
  `data-theme-mode`, and the matching native `color-scheme`.
- Canvas, sidebar, cards, popovers, text, muted text, borders, inputs, accent,
  primary, secondary, destructive and focus roles all resolved from the active
  Catppuccin mode.
- In dark mode the user bubble resolved to 16% Catppuccin mauve, the composer
  to Surface 0 (`#313244`), its text to Text (`#cdd6f4`), and its resting
  hairline to 9% `text-strong`.
- Focusing the textarea kept the neutral OpenClaw hairline. It did not paint a
  purple browser-style ring around the editor.
- In light mode the canvas resolved to Base (`#eff1f5`), composer to Surface 0
  (`#ccd0da`), text to Text (`#4c4f69`), and the user bubble to 10% mauve.
- Mobile and desktop had zero horizontal overflow. The final Browser page-error
  and error-console logs were empty.

The exact component-to-token map and derivation formulas are recorded in
`docs/openclaw-color-system.md`.

## Proof boundary

The shell and the primary Chat, New Session, Sessions and Appearance Settings
surfaces use the OpenClaw 2026.9.4 hierarchy, tokens, icons and measured
geometry. Other retained capability routes may still be honest placeholders
until their PI/HUI backend iteration is implemented.
