# Third-party notices

## OpenClaw Control UI

Parts of HUI's browser interface are adapted from the OpenClaw Control UI
version 2026.9.5, source commit
`ec9c1a13db8938e5a3eaa51fca2e981cde2395a9`. The original shell/icon port
also contains portions from 2026.9.4 (`3a9d69db306cd7f081e06254cb89c4bcc14a7107`).

The versioned stylesheet manifest and explicit native-control adaptations are
documented in `src/styles/openclaw-reference/README.md`. Provider SVG assets in
`public/provider-icons/` are copied from the same upstream release; their brand
names and marks remain the property of their respective owners.

The shared SVG geometry, `public/file-icons/`, attachment file-icon renderer,
media-extension helper and textarea resize/overflow controller are also ported
from 2026.9.5. Provenance is recorded in their source headers and
`src/lib/openclaw-icon-geometry.json`.
The Rosé and Miami stylesheets, accent-contrast function and session-title hover
marquee are also copied from that release. Message context-copy presentation is adapted
from its chat transcript interactions; HUI retains its own clipboard callback
and native-popover lifecycle.
The self-hosted typography catalogue is copied from the same release. Every
font remains under the SIL Open Font License 1.1, with its upstream OFL text
stored beside the corresponding assets in `public/fonts/`.
The conversation-position rail adapts the same release's marker/preview anatomy,
keyboard behavior and pinned stylesheet to HUI's visible PI transcript projection.
Interactive Markdown code-block markup, reveal/wrap controls and their Lit
resize-observer lifecycle are adapted from the same source release.
Read/command tool rows, terminal output, command highlighting and display-only
shell parsing are ported from that release's chat components and
`src/agents/tool-display-exec-shell.ts`. HUI keeps PI execution and normalized
transcripts; the display parser never executes commands.
The select picker, anchored-popup geometry, hub tabs, switch wrapper and
tab-list accessibility adapter are also ported from 2026.9.5. HUI keeps its
own registration, English labels, navigation, persistence and PI callbacks.
Agent widgets port OpenClaw 2026.9.6's `show_widget`: its fragment contract,
widget theme token names, base stylesheet and helper classes, CDN allowlist and
inline-script scanner (`shared/widgets.ts`, `server/runtimes/widget-code.mjs`),
and the two-frame sandbox page after its MCP App sandbox host
(`server/widget-sandbox.ts`). HUI parses scripts with V8 instead of acorn and
uses its own bridges. The bundled `visualize` skill is adapted from OpenClaw's
skill of the same name.

Source: https://github.com/openclaw/openclaw

MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## AgentsInTheCloud

HUI's Work pane (`src/components/work-pane.ts`, `src/lib/work-pane.ts`,
`src/lib/shortcut-binding.ts`, `src/views/panel-selector.ts`) ports the Work
pane design of AgentsInTheCloud at commit `6caa5d4`: its vocabulary
(`CONTEXT.md`: Work pane, Work view, Work view reference, More), the pane
structure of `apps/web/src/server/workspace-presentation.ts` (tab strip of Work
views with close controls, a launcher menu, an empty state listing launchers
with their shortcuts, a resizer and phone destinations), the shortcut binding
notation and display of `apps/web/src/shortcut-binding.ts`, and the AltGr rule
of `apps/web/src/client/workspace-shortcuts.ts`. HUI reimplements them in Lit
with its own state, registry and styles; no AgentsInTheCloud markup or
stylesheet is copied.

Source: https://github.com/lucasmeijer/AgentsInTheCloud

MIT License

Copyright (c) 2026 Lucas Meijer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Web Awesome

HUI uses `@awesome.me/webawesome` 3.12.0, including its default theme and the
selected tab, select, popup, switch and dropdown components. Their transitive
dependency licenses remain included in their npm packages.

Source: https://github.com/shoelace-style/webawesome

MIT License

Copyright (c) 2025 Fonticons, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
