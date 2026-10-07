---
name: visualize
description: "Show an interactive HTML or SVG widget inline in the HUI chat with show_widget: when a widget beats prose, how to write the fragment, theme it, size it for any width, load libraries and verify it. Use before calling show_widget."
license: MIT
metadata:
  tags: "presentation"
---

# Visualize

Adapted from OpenClaw's visualize skill (2026.9.6, MIT) for HUI's `show_widget`.

## When a widget beats text

Use `show_widget` when seeing or manipulating a result helps the user reason
about it: a UI mockup, a simulation, an execution trace stepped through, an
architecture map with selectable parts, a comparison with sliders, a small
dashboard of observed numbers. Use prose, a Markdown table, a `mermaid` block or
a `chart` block when they already explain the answer; they cost far less context.

A widget illustrates. A request to build a feature still needs the change in the
project; show the widget beside it, not instead of it. Distinguish proposed
designs and illustrative data from observed behaviour, and say which it is.

## Write the fragment

- Send the markup itself in `widget_code`: an HTML or SVG fragment with optional
  `<style>` and `<script>`. Never a full document (no `<!doctype>`, `<html>`,
  `<head>`, `<body>`), a Markdown fence or a file path. HUI adds the document,
  the theme, a base stylesheet and its bridges.
- `title` is the card's heading; start the widget with content, not the title.
- Give the root a unique id and scope every style and selector to it.
- Put a useful initial state in the markup; use local JavaScript for selection,
  filters, parameters and animation.
- Insert labels and data with `textContent`, never by interpolating strings
  into markup or code.
- Keep it compact: at most 256 KiB, and the code stays in the conversation's
  context. Aggregate data; load a library instead of inlining it.

Inline scripts are syntax-checked before the widget is shown. A rejection names
the script, line and column in your own code: fix that and call the tool again.

## Theme and layout

The base stylesheet styles headings, paragraphs, links, buttons, inputs, selects,
tables and code. Helper classes: `.card`, `.row`, `.metric`, `.muted`,
`.badge` with `.ok`/`.warn`/`.danger`/`.info`, and `button.primary`.

Color everything with the theme variables, which follow HUI's theme live:
`--surface`, `--card`, `--elevated`, `--text`, `--text-strong`, `--muted`,
`--border`, `--border-strong`, `--accent`, `--accent-fill`, `--accent-fg`, `--ok`,
`--warn`, `--danger`, `--info` (and `--*-subtle` fills), `--radius`, `--font-body`,
`--font-mono`. Do not hardcode colors; keep the page background transparent;
reserve `--accent-fill` for at most one primary action. Canvas drawing needs
computed colors, redrawn when the theme changes (watch `color-scheme` or the
variables on `document.documentElement`).

The frame is as wide as the chat column, down to about 340 px on a phone, and
grows to the widget's height (up to 8000 px). Use fluid widths, wrap rows and
stack columns when narrow; scroll horizontally only for exact geometry. The
expand control shows the same widget full screen; `html[data-display-mode]` says
which.

Label controls, keep them keyboard-operable with visible focus, and make touch
targets large enough. Honor `prefers-reduced-motion`. Pair colors with labels.

## Libraries, fonts and what the frame cannot do

Scripts, styles and fonts may load from `https://cdnjs.cloudflare.com`,
`https://cdn.jsdelivr.net`, `https://esm.sh` and `https://unpkg.com`; stylesheets and
fonts also from Google Fonts and Bunny Fonts. Pin versions, load a library before
the code that uses it (a module script for ESM), and show a readable fallback if
it fails. No library or font is preloaded, and `eval`-based libraries fail.

The widget runs sandboxed in an opaque origin: no `fetch`, XHR or WebSocket, no
remote images or media (use `data:` URLs or draw them), no popups, no top-level
navigation, no cookies or storage, and no access to HUI, its API or this
conversation. Gather data with your own tools and embed what the widget needs. A
click on an http(s) link opens it in a new tab. The widget cannot send prompts
back, and you cannot read its state.

## Verify and deliver

Runtime errors and blocked loads appear on the card, for the user, not for you:
check the code paths you rely on before showing it. Keep the reply short: the
conclusion or the limitation, not a description of the whole widget.
