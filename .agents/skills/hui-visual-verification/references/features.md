# HUI verification feature map

Use this as a router into existing journeys, not as a claim that every feature
has been reverified. Paths are relative to the repository root. Read current UI
labels from Browser snapshots; older journey notes record historical observations.

| Change | Journey / fixture | Required observable result |
| --- | --- | --- |
| Basic SDK/chat/tool rendering | `e2e/sdk-backend.browser.md`; default launcher + `E2E_RICH` | Real read tool, response, second prompt accepted, persisted session after reload |
| PI extensions in Durable | `e2e/durable-extensions.browser.md`; default launcher + `E2E_EXTENSION_TOOL`, `$check-status`, `$hui-e2e-question`; separate plain-text session + `$fixture-compact` | Extension tool executes, plugin commands appear, question answers settle desktop/mobile, repeated turns and extension-driven compaction work |
| Compaction / rewind | `e2e/compaction-rewind.browser.md`; default launcher (Durable sessions) + `/compact`, `E2E_SLOW_COMPACT`; PI's worker: `launch … --pi-sessions` + `/fixture-compact` | Earlier turns stay visible with the divider; rewind inside the kept window keeps the summary, behind it sends the original turns; live divider, queued input sent after, failure and Stop-cancel dividers |
| Composer / streaming / queue | `e2e/chat-composer.browser.md`, `e2e/steer-enqueue-fix.browser.md` | Usable composer during held turn; queued vs steer delivery; no false editors |
| Sidebar / groups | `e2e/session-groups.browser.md`, `e2e/sidebar-toolbar.browser.md` | Group/filter/sort changes visible and durable after reload; group Git defaults persist and drive Branch/Worktree launches |
| Generated session titles | `e2e/session-title-generation.browser.md`; default launcher + deterministic utility model | Empty name generates a descriptive 3–6 word title in the first message's language; full title survives desktop/mobile layout |
| Navigation / responsive drawers | `e2e/shell-navigation.browser.md` | Correct route, focus return, inert cleanup and no clipped inner scrollers |
| Models / settings / skills | `e2e/configured-models.browser.md`, `e2e/skill-disable.browser.md` | Selection shown and preserved; disabled skill actually unavailable |
| Built-in providers / auth / model selection | `e2e/providers.browser.md`; default launcher + synthetic API key | Three-brand add modal, grouped auth, HUI-only credentials, added cards, collapsed multi-model selector, disconnected sign-in only, PI custom provider retained, context/output and truthful quota state |
| Multiple sessions / split panes | `e2e/session-multiplexing.browser.md` | Independent histories, composers and simultaneous streams; background concurrency alone is insufficient |
| Attachments / rich output | `e2e/presented-media.browser.md`, `e2e/markdown-formatting.browser.md` | Actual image/file/media rendering and controls; no remote credential-dependent fixtures |
| Image / diagram viewer | `e2e/media-viewer.browser.md`; default launcher + `E2E_RICH_EMBEDS`, `E2E_PRESENT_MEDIA` | Click/Enter opens the viewer; zoom, pan, copy and save work on diagrams and images; exported SVG labels unclipped |
| Backlog start / branch selection | `e2e/kanban.browser.md`; default launcher + synthetic backlog + disposable Git repo | Branch and repository default selected after inspection; one ref preserved across modes; only Worktree asks for a suffix |
| GitHub / Jira | `e2e/github-integration.browser.md`, `e2e/jira-integration.browser.md`; Jira also `launch … --jira-fixture` (connected fake Jira, fixture utility model, sessions *Flaky CI retries* and *Docs cleanup*) | Local fake service records intended interaction; never test writes against operator accounts. Jira create: CI suggests `CI-1`, OPS suggests no parent, *Docs cleanup* names the non-candidate `DOCS-7` |
| Contributions page | `e2e/contributions.browser.md`; `launch … --github-fixture` (fake gh with accounts `hui-e2e`, `hui-e2e-personal` and synthetic activity since 2019/2022) | Calendar and weekly totals match the fixture; account picker, shared Commits/Pull requests switch and year list; non-active account searched with its own token (`gh/search-log`); per-account error and no-account states |
| Contributions → Calendar | `e2e/session-calendar.browser.md`; `launch … --activity-fixture` (synthetic Durable sessions over last week and this week, one subagent) | Remembered Project/Group/Session grouping; date heading opens a full-width Day with day-only totals, Previous/Today/Next and Back to week; merged blocks without inflated totals; focus one item and Show all; cards list/open sessions; night blocks stay on their activity day; a new real session appears; desktop, mobile, light and dark |
| Managed browser tool | `e2e/browser-tool.browser.md`; default launcher + `E2E_BROWSER` (`E2E_BROWSER_SLOW` paces each step by 1.5 s) | Fixture agent opens, types, clicks and reads the fixture page through the headless browser; the chat's live preview streams the page under the browser activity and marks clicks, then keeps the last frame; the browser panel opens from it; Settings → Tools → Browser shows the running process and the tab preview; toggles and executable errors behave |
| Bots tab | `e2e/bots.browser.md`; default launcher (deterministic provider and OptChat compactor; real gateway bot routes, Durable chat, OptChat memory and Automation); a message over 512 bytes gets a compactor line, and one carrying `E2E_HOLD_MEMORY` holds it until `POST /control/release-replay` on the fixture | Settings → Sessions switch shows Sessions \| Bots; a bot created in the dialog opens at `/bots/<id>`, answers in its chat, a routine's Run now arrives as `[routine: <name>]` with a completed run in the panel; the open Memory tab follows the chat by itself (messages, view, lines, pending, summarizer spend, *Summarizing memory…* while a turn waits on a held summary) and no timer reads it; a line zooms down to its whole message; *Open memory page* opens OptChat's page in a new tab; *Gateway default* clears a bot's model and thinking; hide/unhide, archive, Show archived and Restore (also from an archived bot's address); Automations words the routine's schedule; the bot chat never appears in Sessions, search, Kanban, the Sessions page or the palette; desktop, 390×844 drawer and sheet, 844×390 sheet |
| Bots' voice (VoiceStudio) | `e2e/bots-voice.browser.md`; `launch … --voice-fixture` (fake VoiceStudio at `receipt.voiceUrl`, unconnected) + owned headless Brave with a fake microphone (`e2e/fake-speech-wav.mjs`) | Settings → Integrations connects it; the bot dialog's voice picker, speed and Preview; Read aloud and Preview play (player `data-state`/`data-clips`, fixture request log); a voice note lands in the composer; a call hears the fake utterance, sends `[voice] …`, speaks the reply, mutes, minimizes to a bar (a band above other pages, Settings included) and hangs up back to the chat; desktop and 390×844. Live VoiceStudio is never claimed |
| Background watchers | `e2e/watchers.browser.md`; default launcher + `E2E_WATCHER` | Real `watcher` tool calls start detachable commands; compact rows at the end of the transcript report running/done and the latest line (several collapse into one summary line); opening a row shows target, outcome and log tail; Stop, Restart and Dismiss work; nothing floats over the conversation on desktop or mobile |
| Installed package / desktop | `e2e/package.browser.md`, `e2e/desktop-package.browser.md` | Installed archive path verified; browser screenshot is not native macOS/Electron proof |

## Fixture selection

- **Default:** `visual-verification.mjs` uses the existing local Anthropic-compatible
  provider and real Pi Durable with PI extensions. `--pi-sessions` selects the
  PI SDK worker instead. The model's answer is deterministic; the app, runtime,
  tools, routing and persistence are real.
- **Seeded state:** feature fixtures create a reproducible transcript or registry.
  Useful for menus, errors and layout. A seeded tool call does not prove a model
  chose/executed the tool. Use the feature recipe's isolated directories/ports.
- **External/native:** require an explicitly suitable environment and permissions.
  Leave these claims unverified when only local fixtures were exercised.

The generic launcher's doctor applies only to instances it owns. For a specialized
fixture, record/check its checkout HEAD, isolated configuration, PID, bound port
and exact URL explicitly; do not claim the generic doctor certified that fixture.

### Provider identity and OpenCode Go quota follow-up

Launch `--quota-fixture` for synthetic Codex emails in OAuth-shaped credentials,
Claude profile identity and OpenCode Go 5-hour/weekly/monthly response windows.
Quota transport is synthetic; the product fetch/parser and snapshot identity
extraction are real. Verify email headings/accessible reorder labels, fallback
labels for API keys, refresh, persistent reorder and long-email wrapping at
1440×900 and 390×844. The Go rolling fixture is **0.5%**, not 50%.
No real OAuth session, subscription or billable inference is used by this fixture.

API behavior was cross-checked against
[T3 Code OpenCode Go usage](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/openCodeUsageLimits.ts),
[CodexBar OpenCode Go](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/OpenCodeGo/OpenCodeGoUsageFetcher.swift)
and [CodexBar Claude OAuth profile](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Claude/ClaudeOAuth/ClaudeOAuthUsageFetcher.swift).
These are undocumented upstream APIs; missing or failed responses stay explicit.
