# Independent font preferences Browser proof

Date: 2026-09-24

## Environment

- HUI dev server from this worktree at `http://localhost:5178`
- Isolated `XDG_CONFIG_HOME=/tmp/hui-font-e2e.jtgsv2`
- OpenClaw Browser host profile
- Desktop viewport: 1440 x 900
- Mobile emulation: iPhone 13, 390 x 664 CSS px at DPR 3

No real HUI registry, PI transcript or operator settings were read or changed.

## Journey

1. Opened `/settings/appearance` through the Browser tool.
2. Opened the visible **Chat prose font** picker and selected **Lora**.
3. Opened the visible **Interface font** picker and selected **Geist**.
4. Read `GET /__hui/settings` from the page with the normal `x-hui: 1`
   client header. It returned `fontUi: "geist"` and
   `fontChat: "lora"`.
5. Inspected resolved styles:
   - `--font-body` and the preview caption resolved to Geist.
   - `--font-chat` and the prose preview resolved to Lora.
   - `--chat-font-smoothing` resolved to `auto` for the serif chat face.
6. Reloaded the direct Appearance route. Both selections and resolved stacks
   remained unchanged, proving persistence rather than an optimistic-only UI.
7. Waited for `document.fonts.ready`; `document.fonts.check()` returned true
   for Geist and Lora. Browser request inspection showed status 200 for their
   self-hosted WOFF2 files.
8. Emulated iPhone 13, inspected the selected **Lora** control, and measured no
   horizontal overflow: document/main `scrollWidth === clientWidth === 390`
   and the Typography section `366 === 366`.
9. Browser page errors: 0. Browser console errors: 0.
