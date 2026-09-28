# OpenClaw color parity

HUI follows the semantic color contract shipped by OpenClaw Control UI
2026.9.4. Components consume roles; theme files provide the source colors;
`src/lib/shadcn-theme.ts` derives the remaining roles exactly once.

Reference sources in the OpenClaw repository:

- `ui/src/styles/base.css` — default light/dark palettes and semantic roles.
- `ui/src/pages/config/custom-theme-import.ts` — tweakcn/shadcn theme mapping.
- `ui/src/styles/app-sidebar.css` — navigation surfaces.
- `ui/src/styles/chat/grouped.css` — message bubbles.
- `ui/src/styles/chat/text.css` — chat text and reasoning.
- `ui/src/styles/chat/composer.css` — composer and pickers.
- `ui/src/styles/chat/tool-cards.css` — tool activity and results.
- `ui/src/styles/settings.css` and `sessions.css` — settings and session tables.

## Component map

| HUI / OpenClaw region | Color role or exact expression |
| --- | --- |
| Page canvas | `--bg` |
| Quiet page section | `--bg-accent` |
| Elevated surface | `--bg-elevated` |
| Hovered navigation / row | `--bg-hover` or `--panel-hover` |
| Code and tool-result ground | `--bg-muted` |
| Cards and forwarded message bubbles | `--card` / `--card-foreground` |
| Composer and picker menus | `--popover` / `--popover-foreground` |
| Sidebar | `color-mix(in srgb, var(--bg) 96%, var(--bg-elevated) 4%)` |
| Sticky translucent chrome | `--chrome` / `--chrome-strong` |
| Body copy | `--text` |
| Titles and high-emphasis controls | `--text-strong` |
| Chat Markdown | `--chat-text` |
| Metadata, placeholders, inactive controls | `--muted` |
| Hairlines | `--border` |
| Strong / hovered hairlines | `--border-strong` / `--border-hover` |
| Form inputs | `--input` |
| User message bubble | `--accent-subtle` |
| Active navigation and permission state | `--accent` |
| Accent-filled button text | `--accent-foreground` |
| Primary action | `--primary` / `--primary-foreground` (never `--accent`) |
| Secondary action | `--secondary` / `--secondary-foreground` |
| Destructive action and errors | `--destructive`, `--danger`, `--danger-subtle` |
| Focus outline | `--focus-ring`, derived from `--ring` and `--bg` |
| Text selection | fixed neutral `--selection-bg` / `--selection-fg`, not the theme accent |
| Menu selected row | 8% `--text` via `--menu-selected`, not the theme accent |
| Overlay border / shadow | neutral `--overlay-border` / `--overlay-shadow` |
| Chat composer surface | `--popover` |
| Chat composer border, resting | `color-mix(in srgb, var(--text-strong) 16%, transparent)` in light and `9%` in dark |
| Chat composer border, focused | resting hairline mixed `94%` with `--text-strong` |
| Composer secondary controls | `color-mix(in srgb, var(--text-strong) 65%, var(--popover))` |
| Composer control hover | `color-mix(in srgb, var(--text) 7%, transparent)` |
| Assistant message | transparent surface, `--chat-text` |
| Reasoning block | `--muted`; 4% neutral white in dark or neutral ink in light |
| Tool activity label | `--muted` |
| Tool result panel | `--bg-muted`, `--border`, `--muted` |
| Attachments | `--bg-muted`, `--border`, `--text` |
| Queue | composer surface; 6% `--text-strong` divider |
| Session runtime states | HUI-owned `--status-*` colors, intentionally independent of decorative themes |
| Backdrops and shadows | neutral translucent black, intentionally independent of themes |
| Provider / product marks | their brand colors, intentionally independent of themes |

## Theme derivation

The theme loader consumes the standard shadcn source roles (`background`,
`foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`,
`destructive`, `border`, `input`, and `ring`) and produces OpenClaw's full
semantic set. Important derived roles are:

- `--bg-accent`: 88% background + 12% card.
- `--bg-hover`: 68% muted surface + 32% background.
- `--bg-content`: 92% background + 8% card.
- `--panel-hover`: 76% card + 24% muted surface.
- `--border-strong`: 72% border + 28% text.
- `--accent-subtle`: 10% accent in light, 16% in dark.
- `--accent-glow`: 18% accent in light, 30% in dark.
- `--danger-subtle`: 8% destructive in light, 12% in dark.
- `--focus`: 14% ring in light, 22% in dark.

HUI has no legacy color aliases. The former `--bg-raised`, `--bg-sunken`,
`--fg`, `--fg-strong`, `--fg-muted` and `--focus-ring-color` names were
replaced by `--card`, `--bg`/`--bg-accent`, `--text`, `--text-strong`,
`--muted` and `--ring`. An imported theme's `sidebar` color is not mapped.

## Exact placement rule

The theme accent is deliberately sparse, matching OpenClaw's implementation:

- `--bg` paints the application canvas, transcript and ordinary chrome.
- `--card` paints cards; `--popover` paints composers, menus and floating surfaces.
- `--border`/`--border-strong` paint resting and hovered hairlines.
- `--accent` marks active navigation, permissions and small selection indicators.
- `--primary` alone fills submit/send actions.
- `--ring` appears only on keyboard focus; text inputs keep their component-owned
  neutral border instead of receiving a permanent accent outline.

This distinction matters for imported palettes where `accent`, `primary`, and
`ring` may be three different colors. Collapsing them is a parity defect even
when a built-in theme happens to give them the same value.
