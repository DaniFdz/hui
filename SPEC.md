# SPEC — HUI owns the sessions

Specifications for the dashboard, session ownership and installed gateway.

---

# Part 1 — Dashboard shell

Copy OpenClaw's Control UI layout, adapted to operating pi sessions.

## What the layout is

| OpenClaw region | HUI |
|---|---|
| `sidebar-agent-card` — identity card at the top | removed; HUI has no agent identity selector |
| `sidebar-brand` — brand line with actions | new session then session search on the left; collapse on the right |
| `sidebar-nav` — page destinations | Contributions, Automations, Plugins, Skills, then Settings; no Home entry. Other retained pages stay reachable by URL and the command palette; dropped OpenClaw routes are absent |
| `sidebar-online` / session sections — collapsible groups of rows | groups, flattened, with session rows |
| `sidebar-footer-bar` — identity + connection state | removed; Settings is the last sidebar destination |
| main region — header, body, composer | session header, transcript, composer |

## Behaviour

- Transcript messages expose Copy and Reply; Reply appends an editable Markdown
  quote to the existing draft and focuses the composer without sending it.
  Message footers show relative time with an exact-date tooltip. A measured
  completion time takes precedence over the original message creation time.
- Completed model calls expose output tokens and measured duration with a
  disclosure for input/cache tokens and reported cost. Tool blocks show measured
  execution duration. PI usage belongs to the entire model call (including
  reasoning), displayed once on its last text/reasoning block (or last tool call when no text exists). Missing values
  remain absent; HUI never estimates per-fragment tokens or historical duration.
  Live timings survive browser reconnects, not a PI runtime/gateway restart.

- Session search lives in the fixed sidebar header, including the mobile drawer.
  Search expands directly below the header and filters the session list; it is
  not duplicated in the Sessions toolbar or a bottom footer. Settings is the last
  primary-navigation destination, not a header button.
- Appearance includes the native OpenClaw Miami palette in light, dark and
  system modes. Theme, accent, interface-font and chat-prose-font preferences
  persist in HUI settings. The two font selectors expose OpenClaw's ten choices
  independently, while code retains its dedicated monospace stack. Choosing
  Miami does not replace a custom preference.
- Gateway settings shows labeled green/red connection states and an amber
  initial loading state. Health refreshes every three seconds while that page
  is visible. Failed checks label cached runtime values as last known; retry
  and subsequent successful checks restore the connected state. Uptime uses
  compact days/hours/minutes (seconds only below one minute).
- On macOS, Gateway settings adds **Power**, bounded by the gateway process:
  **Keep Mac awake** (a saved choice, on by default, like `caffeinate -i`) and
  **Stay awake with the lid closed** (like `sudo pmset -a disablesleep 1`),
  marked as needing administrator permission. The lid switch is never saved:
  every gateway start begins with it off and without a password prompt; turning
  it on asks for a password; turning it off, stopping the gateway or a gateway
  crash restores normal sleep. After a reboot left it on, it starts on with a
  note until turned off, which asks to restore sleep. While the Mac is held awake
  with the lid closed, a top notice says so and offers **Turn off**; dismissing
  it lasts until it turns on again or the page reloads. Each switch shows what
  the gateway actually holds (Off, Pending, Active, Failed with its reason).
- Groups are flat: one label per group.
- Groups collapse; the choice is remembered in the browser.
- The group menu's **New session defaults** stores directory, runtime and optional
  Git environment/base ref. A detected repo defaults to **Branch** and its default
  branch; **New worktree** applies to each new session independently. The suffix
  is chosen at launch, never shared by the group. Saving defaults does not mutate
  Git. New sessions opened from the group inherit them, but choosing a different
  directory resets Git choices; legacy groups need no migration.
- In custom-group mode, sessions can be moved between groups by dragging a row
  onto a group or with the row menu's keyboard-accessible **Move to group**
  submenu. The row menu follows OpenClaw's action hierarchy: pin, rename,
  unread, archive, icon, group placement, copy, open and delete. Archived
  sessions leave the sidebar and remain restorable from Sessions, whose table
  opens on **All** (then Active, Archived) and whose filter popover narrows by
  live status and groups rows by custom group or project directory; these are
  browser-only view choices. While the row
  menu is open, its displayed P/R/U/A/D keys activate their actions immediately
  rather than using typeahead (D still opens the delete confirmation). Modified
  shortcuts, held-key repeats, text inputs and nested submenus retain native
  keyboard behavior. Successful archiving shows a dismissible toast with Restore,
  which restores the session tree through the existing archive API. The toast
  expires after 15 seconds of inactivity, pauses on hover/focus, and retains a
  retryable error if restoration fails. No toast is shown before archive succeeds;
  those flags
  and appearance choices are HUI metadata and never modify PI's transcript.
  The appearance picker includes OpenClaw's preset grid and custom-emoji entry;
  custom values use the same bounded session-icon metadata contract.
  Project grouping remains a read-only projection and never becomes a drop target.
- OpenClaw's **Assign to** is absent because PI has no multi-user ownership
  model. **Fork conversation** is absent until PI exposes a transcript-branching
  RPC; HUI never copies or rewrites PI's JSONL to imitate a fork.
- In custom-group mode, custom groups are reordered by dragging a group header
  above or below another group, or with the group menu's keyboard-accessible
  **Move group up** / **Move group down** actions. The order persists in the HUI
  registry; OTHER always stays last and is not draggable.
- The Sessions toolbar always exposes **New group**, including an empty registry
  or a list containing only ungrouped sessions. Group labels display in uppercase;
  the ungrouped section is **OTHER**, after custom groups in their saved order. Stored labels remain
  unchanged, including their original casing.
- **Filter & sort** groups sessions by custom group, project directory or not at
  all; sorts by creation time, last update, name or development stage
  (Investigation to Done, recency breaking ties); filters by live HUI status;
  and hides empty groups always, never or only while filtering. Pinned sessions
  remain first. These browser-local preferences do not mutate the registry.
  Project groups are directory projections, not editable custom groups. Only
  HUI-backed options are shown; owner and archive filters are not simulated.
- `⌘K` / `Ctrl+K` opens a keyboard-navigable command palette over retained
  routes, Settings areas and HUI sessions.
- Session rows use the reference's title/text/aside hierarchy. Running sessions
  show its animated glyph; waiting and error sessions show attention indicators.
  Ownerless idle PI sessions do not invent an avatar or status decoration.
  Live health is process-owned and never persisted in the registry; unread
  state is persisted so it survives a gateway restart. A settled background
  session shows the reference accent-colored unread dot until its conversation
  is opened.
- A session that created GitHub pull requests shows one state-colored pull
  request mark per PR beside its title (open green, draft gray, merged purple,
  closed red). The marks form a strip whose newest mark sits at the trailing
  edge; when more exist, the next one shows half-visible and faded to signal
  that the strip scrolls. Hovering the title narrows the strip to the newest
  mark so the title and row actions have room; hovering or focusing the strip
  widens it to at most half of the space beside the row actions, so the title
  keeps the other half, and the mouse wheel (or a swipe on touch) scrolls through every PR.
  It returns to the newest mark once pointer and focus leave. Hover or keyboard focus
  opens a card directly below the mark (above it near the viewport bottom) with
  `owner/repo#number`, the state, title and the Markdown description. The
  pointer can move from the mark onto the card and scroll a long description
  without it closing; activating the mark opens the PR on GitHub in a new tab. PRs are
  detected only from a `gh pr create` (or create-pull-request tool) result in
  the live transcript; state and text come from the shared GitHub previews (`gh api`), cached
  in memory and never persisted. Unconfirmed PRs render neutral, never guessed.
- Sessions linked to Jira Cloud work items show a Jira mark in the leading status
  column (aligned with child status glyphs; live attention/running status wins),
  colored by status category. Hover opens a card with the key, type, status,
  summary and a scrollable Markdown description; clicking opens Jira. The
  session menu offers "Create Jira work item…": the default project from
  Settings → Integrations → Jira is preselected but changeable, the parent defaults to the
  utility model's pick from open parent-level items, and the summary and
  description are drafted by the utility model; new items are assigned to the
  connected account by default. Edits are never overwritten by
  the draft. "Link Jira work item…" links an existing item: it lists recently
  viewed work items and searches Jira by key, pasted URL or summary text.
  Once a session is linked, those two items are hidden; the sidebar menu's
  "Open in" and "Copy" submenus gain the latest linked item, and the Kanban card
  menu offers "Open in Jira" and "Copy Jira link".
  Settings → Integrations → Jira walks the operator through creating an Atlassian
  API token; HUI verifies it and keeps it server-side only.
- Agents record bugs or problems found along the way with `suggest_task`
  instead of fixing them inline or burying them in prose, and when the operator
  asks for one ("let's add a follow-up for this"). Unlike OpenClaw's
  instruction prompt, a card describes the problem (what happens, where,
  evidence) and a proposed fix only when one is known; otherwise the fix reads
  "Not known yet". The open session shows a *Suggested task · in <directory>*
  card in the transcript's top-right gutter (OpenClaw's task suggestion design,
  stacked with a position counter when there are several): title, problem
  preview, collapsible directory with Markdown Problem / Proposed fix, Copy and
  Dismiss. *Start in a new session* creates a session in that directory whose
  first turn is the problem plus the fix, or a request to confirm the root
  cause first; its arrow menu, as in OpenClaw, also offers *Start in a new
  worktree* (same, in a fresh Git worktree) and *Start in this session*; *Create Jira task* opens the Jira dialog prefilled from the card. Either action resolves the card. Cards live only in gateway memory
  and disappear on restart.
- Settings → Integrations → GitHub shows the gateway's GitHub CLI account.
  *Connect GitHub* runs `gh auth login --web` on the HUI machine and shows the
  one-time code (with Copy) and a link to `github.com/login/device`, following
  OpenClaw's device-code layout; once GitHub confirms, the section turns
  Connected. Without `gh` on the gateway's PATH it shows "GitHub CLI required"
  with an install link instead of a sign-in button. The token stays in gh.
- Contributions (first sidebar destination) has two tabs, *GitHub* (default)
  and *Calendar*; the browser remembers the choice, and GitHub is read only
  once its tab is shown. The GitHub tab charts the GitHub activity of every
  account signed in to `gh` on the HUI machine: a GitHub-style calendar (a
  square per local day, month and Mon/Wed/Fri labels, Less→More legend, hover
  for the day's count) and a bar per week (hover for the week's count). One *Commits* / *Pull requests*
  switch (default commits) drives both charts: commits authored on default
  branches, as GitHub search indexes them, or pull requests opened. An *Account*
  picker narrows both to one login (default *All accounts*). The browser
  remembers both choices; a remembered login that is no longer signed in shows
  *All accounts* until it returns. GitHub's year list
  beside the charts (a scrolling row on narrow screens) picks *Last 12 months*
  (default) or a calendar year, from this year back to the oldest account's
  creation; the current year leaves its future days blank.
  Data comes from GitHub search, not the contribution calendar API,
  which is empty for Enterprise Managed Users. Accounts other than the active
  one are read with their own `gh` token, used only on the gateway. Results are
  cached for 15 minutes; *Refresh* reads again. Reaching GitHub's search rate
  limit waits about a minute instead of failing. An account that fails shows
  its error above the charts while the others still render, and a year that
  fails to load leaves the previous one selected; with no account, the page
  links to Settings → Integrations.
- The Calendar tab opens on one week (Monday first, *Previous week* / *This
  week* / *Next week*, never past the current week, and *Refresh*) of the
  operator's HUI sessions: subagent sessions are left out, archived ones
  included. Selecting a non-future date heading opens that day as one
  full-width column. *Previous day* / *Today* / *Next day* navigate days,
  never past the current activity day; *Back to week* shows the week containing
  the selected day. Grouping is retained, as is item focus when that item has
  activity in the new period. Titles, counts, totals, session breakdowns and
  card totals refer only to the selected day or week; the *Hours per day*
  chart appears only in Week. Loading disables date navigation; a failed
  request keeps the previous period and shows the error. The date/view is not
  saved between visits. A session was worked on from one message to the next until 30
  minutes pass without one. *Group by* (remembered by the browser) chooses what
  the grid draws as one color: *Project* (default), the Git repository a session
  ran in, which its worktrees and subdirectories share (`~` for the home
  directory, a folder's own name outside Git); *Group*, the sidebar group
  (*Other* when ungrouped); or *Session*. A project's or group's sessions merge
  visually into one block wherever they are at most 30 minutes apart. The
  recorded activity totals remain unions of the original session blocks;
  visual joining never adds idle time, and grouping never changes the total.
  A day runs from
  5 AM to 5 AM, so late-night work stays in the column of the day it began; the
  hour axis covers 9 AM to 6 PM and every block. Colors come from the session
  palette, then the same colors shaded, busiest in the selected period first, repeating after sixteen.
  Overlapping blocks share their day in side-by-side lanes and widen into lanes
  nothing beside them uses; a block too narrow for its name shows only its
  color, and a one-message block is drawn 30 minutes tall.
  Today's column is tinted with a line at the current time. Activating a block
  opens a card beside it (below it on narrow screens) with its name, day,
  start–end and recorded activity for that day's part, and its total for the selected day or week.
  Under *Session* it shows the
  session's project, group and model, the operator's first message in the block
  and *Open session*; under *Project* or *Group* it lists the block's sessions,
  most time first, with their recorded time in that day's part and first message,
  in a scrollable list, each opening its session. Escape or a click elsewhere closes it. The
  heading shows the week, how many sessions and blocks it had and, when more
  than one, the most sessions running at once. Beside the grid (below it on
  narrow screens), the total working time counts parallel sessions once
  ("29h 25m across 5 projects", a bar split by color, and the summed session
  time); every project, group or session follows with its time, most first.
  Hovering one dims the others' blocks; activating it focuses the grid on only
  that item, with full-width day blocks, and, for a project or group, lists its
  sessions with their time, each opening its session. *Show all* or activating
  the same item again restores the overview. *Hours per day* charts each day's working
  time and labels the busiest. Only Durable conversations are read; sessions
  still on PI's worker appear once `hui doctor --fix` moves them. A rewind
  continues the session on a copy of the history before that point, so the
  time spent on the abandoned branch leaves the calendar.
- Chat messages unfurl GitHub repositories, pull requests and issues (URLs or
  `owner/repo#N`) as cards after the message, at most three per message like
  Slack: PRs show state, title, description snippet, author and diff stats;
  issues show state, labels and comments; repositories show description,
  language, stars and forks. Facts come from the same `gh` login as PR badges;
  without it the card still links to GitHub and says why there is no preview.
  Hovering a PR card shows its full description in the PR badge hovercard.
  Settings → Appearance → Chat → *GitHub link previews* turns embeds off.
- The session multiplexer follows OpenClaw 2026.9.5: columns contain vertically
  stacked panes. Drag a sidebar session to any pane's left/right edge to add a
  column, top/bottom edge to add a row, or center to replace that pane's session.
  The preview uses the original 30% edge bands and half-pane indicator. Same-
  session splits are allowed. **Open split view**, **Split down**, **Split right**
  and **Close session pane** operate on the focused pane; keyboard-accessible
  menus remain available. Pointer or keyboard focus selects the pane and route.
  Each view retains its transcript, composer, draft, queue and detailed stream.
  Column and row dividers support pointer resizing, arrow keys (2%, Shift 5%)
  and Home/End (15%/85%). Layout, focus and weights are browser-local, not registry
  data; the URL identifies the active session. Below 1100px only the active pane
  is visible, with the other panes still mounted; sidebar selection changes focus.
  Any pane can close without stopping its runtime or remounting survivors.
- Existing chat and terminal panes can be repositioned by dragging their header
  or move handle. Edges relocate the pane into a column or stack; center drops
  swap both panes. Self-drops and cancellation do nothing. Pane identity,
  cached views, drafts, scroll, streams and terminal connections survive moves;
  the moved pane keeps focus. Arrow keys on **Move panel** provide a keyboard
  path beside neighboring panes. The layout persists in the existing browser
  format. Moving is desktop-only, like edge splitting; narrow screens retain
  the active-pane presentation and do not expose an unusable drag handle.
- Settled user messages expose copying in the original context-menu position
  (right-click or keyboard context key/Shift+F10), not an extra footer action.
  Assistant responses retain the footer copy button. Settled user-message
  footers reveal **Rewind** on hover or keyboard focus, matching OpenClaw; the
  session header does not duplicate that action. Rewind remains available while
  a turn is running and stops that work before changing branches. Activating it
  acts immediately: HUI resolves that visible message against PI's real append-only
  entry tree, moves the active leaf to the point before the selected user
  message, removes that message from the active transcript and restores its
  full text to the focused composer for editing. The abandoned branch remains
  recoverable from PI's tree. The transcript is the whole active branch (PI's,
  or a Durable conversation's history since its latest `/clear`): a
  compaction appears as a divider with its expandable summary and never hides
  earlier messages. On PI, rewinding inside the window the summary kept
  verbatim keeps that summary on the new branch instead of compacting again,
  and while it compacts the divider shows it live in place of the working
  indicator, messages sent wait in the queue until it ends, and Stop cancels
  it. A Durable session keeps Durable's semantics: its manual and background
  compactions run beside the conversation, which stays idle, so messages are
  sent at once and a run carries on below the live divider; a manual one has
  its own Cancel on that divider, and a fork holds only the history up to its
  point. A failure or cancellation stays visible with its reason until the
  next turn. `/compact [focus]` and the
  context meter's Compact now start one. Continue invokes PI's native
  prompt-free continuation primitive; only when the branch already ends with a
  completed assistant response does HUI send an explicit continuation prompt.
  Reply and fork remain absent rather than simulated.
- Markdown code fences retain the reference's reveal and word-wrap controls;
  copying remains a confirmed clipboard operation with a retryable failure. All
  HUI copy actions prefer the Clipboard API and fall back to a temporary native
  selection when HTTP/LAN origins cannot access it. The latest assistant copy
  action remains directly reachable on touch layouts without a preparatory tap.
- Markdown pipe tables render semantic column headers and inline formatting,
  honor column alignment, and scroll horizontally inside a keyboard-focusable
  viewport on narrow screens. Fenced Markdown remains literal code.
- Bare `http(s)`, `www` and email references render as safe links without
  consuming sentence punctuation or adjacent CJK text. GFM task-list items use
  read-only checkbox controls; inline code and fenced code remain literal. The
  transcript renderer follows OpenClaw's `markdown-it` stack for CommonMark
  nesting, block quotes, strikethrough, pipe tables and disclosure blocks. Raw
  author HTML is escaped, remote images remain click-to-open placeholders and
  inline data images are the only image sources rendered directly.
- Fenced `mermaid` blocks render as isolated diagrams through a lazy-loaded
  parser configured with strict security. Fenced `chart` blocks render bounded,
  self-contained Vega-Lite JSON with inline data only; external URL/href fields
  are rejected. Inline `$…$` and delimiter-line `$$…$$` math use lazy-loaded
  KaTeX, while GitHub-style NOTE/TIP/IMPORTANT/WARNING/CAUTION blockquotes become
  semantic callouts. Invalid rich blocks fail inside their own surface and never
  replace the surrounding response. An isolated
  bare HTTPS X/Twitter status URL becomes a rich-post facade; it contacts X only
  after explicit user consent. Labeled links, inline URLs and unsupported X URLs
  remain ordinary safe links. An isolated canonical HTTPS Slack message or
  channel permalink becomes a static link card in either participant's message;
  HUI neither authenticates to Slack nor reads private content. Raw SVG and
  generic iframes remain escaped.
- Transcript images (inline data images, image attachments and presented
  images) and rendered Mermaid diagrams or charts open in a full-screen viewer
  on click, Enter/Space or the embed's expand control. The viewer zooms with the
  wheel, pinch, buttons or `+`/`-`/`0`/`1`, pans by drag or arrow keys, and
  offers Copy image (PNG), Save (the original image, or SVG for diagrams) and
  Copy source for diagrams. Modified clicks keep native link behavior.
- Read and command activity rows use the original manual disclosure anatomy.
  Commands retain their full input in the expanded terminal while the row uses
  the original bounded, shell-aware preview. Tool output copying uses the
  context menu; HUI does not fabricate a workspace-file or side-panel action.
- The desktop transcript has OpenClaw's left conversation-position rail: one
  marker per visible user/assistant message, a bounded text preview, current and
  visible-position feedback, and click/keyboard jumps. Collapsed activity is not
  indexed. Arrow keys and Home/End browse without scrolling the conversation;
  Enter/Space jump, Escape returns focus, and Tab leaves the rail. Long rails
  scroll independently without dropping markers. Jumps pause live auto-follow;
  **Scroll to latest** restores it. The rail is hidden when the transcript is
  too narrow/short or lacks the original left gutter, including mobile layouts.
  This is browser-only presentation; PI transcripts and the API are unchanged.

---

# Part 2 — Session ownership

**HUI owns the sessions.** The OpenClaw shape is a
gateway that owns sessions plus a UI that talks to it; HUI is both.

## Why this is now possible

pi ships an SDK, and its own docs name the use case: *"Build a custom UI (web,
desktop, mobile)"*.

```ts
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory() });
session.subscribe((event) => { /* text_delta, tool_execution_start, … */ });
await session.prompt("…");
session.steer(text);      // queue while streaming
session.followUp(text);   // deliver when it stops
session.messages;         // history
session.isStreaming;
session.sessionFile;
```

There is also `pi --mode rpc`, a JSONL protocol over stdin/stdout described as
being "for embedding the agent in other applications, IDEs, or custom UIs".

So a session no longer has to be a tmux pane running a TUI. It can be an object
HUI holds, with events HUI streams to the browser.

## Installed gateway

HUI ships a local npm archive with compiled CLI/server/SDK worker, built web
assets, themes and a pinned dependency shrinkwrap. Production uses Node directly;
Vite and the desktop launcher remain source-development tools. `hui gateway`
provides start/stop/restart/status/logs and foreground run; `hui ui` opens or
prints the existing gateway URL without starting another process. The default
binding is `127.0.0.1:4173`. `HUI_GATEWAY_HOST` and `HUI_GATEWAY_PORT` configure
startup/restart defaults (also inherited by the desktop shell); explicit CLI flags
win. Invalid environment defaults are rejected before stopping a gateway.
`--allow-host <name>`, repeatable, and `HUI_GATEWAY_ALLOWED_HOSTS` list the extra
host names accepted in the `Host` header, which is what a reverse proxy fronting
the loopback gateway needs. Both are persisted with the binding while a gateway
is restarted or updated. `allowHosts` in `gateway/config.json` is read on every
start, with `"tailnet"` resolved to the Tailscale DNS name; a malformed file
refuses startup. Without
configured defaults, restart retains the previous binding. A specific IP or Tailscale binding is explicit;
wildcard exposure is refused. The UI still has Full Access and no login.

Lifecycle control uses a separate loopback socket with a random private token,
instance identity and serialized CLI operations. State/logs live in HUI's
`gateway/` config subdirectory. A stored PID alone is never enough to authorize
a signal. Normal stop/restart refuses work a restart would lose: active turns
and questions of sessions on PI's SDK worker, booting runtimes, follow-ups HUI
still holds, open terminals and in-flight mutations; `--force` explicitly
interrupts them. A Pi Durable run does not block: Durable resumes it when the
gateway reopens its store, and a tool call the stop cut short reaches the model
as an interrupted result rather than running twice. Shutdown waits for the
owned process to exit before replacement, preserving the one-writer boundary.
Restart preserves registry/transcript files and Durable's in-flight work.

`hui update --from <trusted local.tgz> [--sha256 <digest>]` stages a managed
release, probes it against disposable HUI/PI state, then selects it atomically
and restarts an idle running gateway. Failure restores the previous selection
and gateway; `--rollback` is handled by the original installed launcher. A
stopped gateway stays stopped. Update metadata and retained releases live under
`$XDG_DATA_HOME/hui/updates/<installation-hash>` (default `~/.local/share`). They
do not change the HUI registry or PI transcript/config formats. Source-linked,
Nix-store and Homebrew installations must use their owning update workflow.
`hui update` resolves the latest stable release in the public GitHub repository
using GitHub's public API, downloads its bounded archive and SHA-256
sidecar, and reuses that transaction. `--check` is read-only. Releases must have a
matching stable tag, package version and checksum; no automatic downgrade occurs.
Tag-triggered CI validates and publishes the archive and checksum. A missing or
inaccessible release is reported explicitly, never treated as up-to-date.
`hui update --nightly [--check]` uses the rolling `nightly` prerelease instead.
CI runs the full checks on every `main` commit, stamps the package as a
prerelease of the next patch (`X.Y.Z+1-nightly.<UTC commit time>.g<sha7>`) and
replaces that prerelease's single archive and checksum. A nightly installs
whenever it differs from the running build, so asking for it is the explicit
opt-in to leave stable; a plain `hui update` returns to stable once a stable
release is newer than the installed nightly. The browser updater stays on the
stable channel.
While the app is visible and online, HUI checks for releases on opening and
hourly. A non-modal banner announces a confirmed newer stable version and opens
the existing update dialog through **Review update**. Checks never install,
restart or call a model. The gateway shares an hourly in-memory cache across
tabs, including unsuccessful checks; an explicit check bypasses its freshness.
Background failures stay quiet. Dismissing a banner hides only that version
until reload; a different version can appear. No host task or persisted setting
is added, and source-development servers do not query GitHub automatically.
There is no npm publication or boot-service registration in this iteration.
Browser and package proof is in `e2e/package.browser.md` and `e2e/update.browser.md`.

## Ownership

Two stores, with one writer each:

| What | Owner | Where |
|---|---|---|
| Groups, names, which tool, cwd, HUI's own metadata | **HUI** | `~/.config/hui/sessions.json` |
| The conversation itself | **pi** | `~/.pi/agent/sessions/<cwd>/*.jsonl` |

HUI does not reimplement transcripts. It asks pi to resume a session file.

The available model catalog combines HUI-managed built-in connections with PI's
custom providers. Settings → Models starts with **Add provider** and a modal
limited to OpenCode Go, OpenAI and Claude. Each brand groups its available account,
API-key or native CLI login methods. After sign-in, HUI adds the connection with
no models selected (or preserves an existing selection). Added cards load quota
independently and expose multiple models in a collapsed searchable dropdown.
Disconnected cards show only sign-in, not quota or model controls. The model
dropdown shows per-model context/output limits,
and provider-reported subscription quota/reset windows where supported. Built-in
credentials and selections live in the HUI-owned `providers/` directory under
its XDG config root; adding or removing them never rewrites PI configuration.
HUI-managed providers support up to 20 named accounts in explicit priority order.
New logins add accounts; reconnect targets exactly one existing account. Model
selection remains shared by the provider. Each account has its own credentials,
quota display and removal action. Account headings prefer the email reported by
Codex OAuth credentials or Claude’s OAuth profile, falling back to the stored
label when unavailable. Emails are display-only: accounts with the same email
remain separate. OpenCode Go API-key connections show their reported 5-hour,
weekly and monthly limits. Their connection dialog requires a name and explains
below the input that OpenCode does not report an account name or email. Reconnect
prefills the existing label. Subscription/usage status and all reported
hourly, weekly, monthly and model/feature-specific limits stay visible per
account, including reset times. Unknown plan or billing status stays explicitly
not reported; stored credentials do not prove an active subscription. SDK requests use the first ready account;
quota/rate-limit rejection before any output moves to the next account, bounded
by one attempt per account. Partial output, tool calls, aborts and unrelated errors
are not replayed. Cooldowns persist across workers/restarts; reported reset times
or Retry-After are respected, with a one-minute retry cooldown when unavailable.
The highest-priority ready account is reconsidered for every new request.
A HUI selection overrides only the matching provider; an empty HUI model list
selects nothing. Remaining PI models follow the operator's `models.json`
provider/model selection using the `model-name` extension's rules. HUI owns three routes over that catalog: **primary** starts
normal sessions, **fallback** retries a primary failure only when no useful output
or tool activity has occurred, and **utility** runs cheap, fast, tool-free calls
for concise (3–6 word, at most 60 character) new-session names in the prompt's language, generated worktree branch names and `/btw`. These settings never rewrite PI files.
Missing or malformed PI selection files preserve the normal available catalog; see
`docs/api.md` for empty-list and default-model semantics.

PI is the only session runtime. The native Claude Code CLI runtime was removed;
Claude models remain available through PI's Anthropic provider. Registry records
that still name another runtime fail closed with an error instead of being
resumed as PI.

## Shared terminals

Appearance → Typography includes a separate terminal font with editable local
family names and Nerd Font suggestions. The preference persists as `fontTerminal`
(default: JetBrains Mono), applies to open panes without restarting the shell,
and falls back to a bundled monospace font when unavailable on the browser device.
Nerd Font icons (Private Use Area and IEC power code points) always render from a
bundled Symbols Nerd Font Mono face placed after the chosen font, so prompt icons
work in the browser and the desktop app whether or not the local font matches.


The chat header's **Open terminal** opens an interactive shell in the session's
directory/worktree, in the same resizable column/stack layout as chat. Terminal
panels can create/select additional shells, split right/down, and hide without
ending their processes. **End terminal** explicitly terminates the shell and its
descendants. On narrow screens an active-panel selector switches between chat
and terminal while preserving hidden views. Opening a terminal does not call PI.

HUI owns these PTYs and their bounded in-memory output, separately from PI's
RPC/SDK and transcripts. Browser reload and disconnection preserve shell state
while the gateway runs. Gateway restart does not: stale panels report unavailable
and require an explicit new terminal. Ordinary gateway stop/restart/update refuses
active terminals; a forced stop cleans them up. Removing a conversation also ends
its terminals. No tmux dependency, automatic shell recreation or durable terminal
log is introduced.

The HUI-owned **terminal** tool follows OpenClaw's `list`, `read`, `input`,
`resize`, `close` contract and shares exactly the operator-opened PTYs of the
calling conversation. Other conversations, including subagents, cannot access
them through this tool. `input` is exact text/control input, not a shell-command
wrapper; successful submission does not mean the command has finished. Reads are
bounded ANSI-stripped output replay, not screenshots or an emulated screen grid.
The existing Full Access contract applies, without a new approval surface.

Ghostty Web renders the terminal; `@lydell/node-pty` owns the shell; `ws` carries
input/output/size changes. These dependencies and the additive browser-local
terminal pane metadata were authorized with the shared-terminal feature. PI
configuration and HUI's durable registry format remain unchanged.

## Managed browser

HUI gives agents a dedicated browser through the HUI-owned **browser** tool,
modeled on OpenClaw's managed `openclaw` profile. The gateway launches one
Chromium-family process (Chrome, Brave, Edge or Chromium, auto-detected or an
absolute executable path) with its own user-data directory under
`$XDG_CONFIG_HOME/hui/browser/profile`. It never attaches to, reads or drives the
operator's own browser, windows, cookies or passwords.

It is **headless by default**: no window, Dock icon or focus change, so it never
interrupts the operator. Settings → Tools → Browser can turn the tool off, switch
to a visible window for watching the agent work, set the executable, start or
stop the process, and list open tabs with an on-demand preview captured from the
headless page. Changing the mode or executable stops a running browser; the next
agent action launches it with the new configuration. Turning the tool off removes
it from new or restarted sessions and refuses calls from running ones.

The browser starts lazily on the first page an agent opens and stops once its
last agent tab closes (the next page launches it again), or with the gateway.
HUI drives it over Chrome DevTools Protocol on a private pipe
(`--remote-debugging-pipe`), so no debugging port is opened and the browser exits
when the gateway does. Tabs belong to the conversation that opened them, like
shared terminals; popups join their opener's conversation. Removing a
conversation or stopping its turn closes its tabs, including one an interrupted
call was still opening, and tabs close after 10 minutes without a browser call
from their conversation, so no headless page outlives the work it served.
Agents read pages as accessibility snapshots with
element refs, act on those refs with real input events, and can read text,
console output and screenshots. Page content is untrusted tool output. The
existing Full Access contract applies without a new approval surface; downloads
are disabled and only http, https, file and about:blank URLs open.

While the agent uses the browser, the chat shows a **live preview** under that
browser activity: the agent's current tab as it repaints, its title and URL, a
marker where it clicks and its latest action. Only the conversation's latest
browser activity carries a preview. It streams while the agent's turn runs and
the preview is on screen, then keeps its last frame; a preview that appears idle
(a reopened conversation, a reload) takes one fresh frame of the tab if it is
still open, and nothing is shown when no page is left to show. Selecting the
preview, or the globe button in the conversation header, opens the **browser
panel**: a larger live view beside the chat (the same multiplexer as terminal
panes, and the narrow-screen panel selector) that follows the agent's tab or
watches another of the conversation's tabs until Follow agent. Both are
read-only. Frames come from a CDP screencast that runs only while someone
watches and only when the page repaints (at most about ten frames a second).
Headless tabs each get their own window, so conversations never hide each
other's pages.

No new dependency is added: HUI speaks CDP directly. Browser settings are an
additive `browser` block in `settings.json`; the browser pane is an additive
`browser: true` flag in the browser-local split layout. PI transcripts and the
registry format are unchanged.

## Live chat projection

PI's JSONL remains the durable authority, while the gateway owns a temporary
projection of the turn currently streaming. That projection includes text,
thinking, correlated tool calls, queue state and pending extension-UI questions.
Every event stream connection (SSE, or the WebSocket each browser view uses)
begins with one atomic snapshot; reconnecting during a turn therefore cannot
lose the prefix already emitted. At `agent_end`, the
projection is replaced with PI's refreshed transcript rather than persisted by
HUI as a competing conversation store. If that refresh fails, HUI retains the
completed projection and reports the error instead of replacing it with stale
history; PI remains the durable authority for the next successful refresh.

Sessions run independently inside the long-lived gateway. Navigating from one
chat to another never stops its turn, and separate sessions may be running or
waiting at the same time. The browser keeps one lightweight multiplexed status
stream for the whole registry so background rows continue to reflect
`starting`, `running`, `waiting`, `idle`, and `error`. Each mounted chat pane
keeps one detailed session stream for its transcript, tool, model, queue and
question frames. Each pane caches three visited session views (including
the current view), retaining extra views only while they hold an unsaved queue
edit. Cached and narrow-hidden views stay mounted until evicted or
the pane closes. Sessions only listed in the sidebar do not broadcast every
token to the browser. Closing a view releases its subscription, not its runtime.

The Sessions page also projects ephemeral runtime cost: loaded runtime count,
best-effort process-tree RSS, measured startup duration and the heaviest loaded
session. Per-row memory and startup values come from the same gateway sample.
Unsupported or failed measurements remain explicitly unavailable. HUI never
persists process ids or resource telemetry, and cold sessions have no invented
runtime cost.

Before handing a prompt to a runtime, HUI persists a temporary recovery marker
and the originating prompt in its own registry. The journal is necessary because
PI may not create its JSONL until the first turn settles; it is never returned in
session views and a normal settle or explicit Stop clears it. If the process,
gateway or machine disappears first, gateway startup reopens the runtime and
starts a replacement turn with the journaled request. The recovery instruction
requires the agent to inspect transcript and workspace state before acting, so
an unknown tool outcome is verified rather than blindly replayed. Three failed
admissions leave the existing **Continue run** action as an explicit fallback;
the budget resets once a backend turn starts. Raw attachment payloads are not
copied into the journal.

A run that ends on a runtime or provider error keeps the error row in its
activity disclosure, and the composer also raises it as an OpenClaw-style error
card above the input until the next turn starts. The card offers **Continue**,
which sends a plain continuation prompt through the normal prompt path, plus copy
and dismiss. Dismissal lasts only for the page load, so a reload shows the
unresolved error again; the notice comes from PI's refreshed transcript, not
from separate HUI state.

Failed chat actions, including rejected continuation requests, show a dismissible
error toast instead of an inline page note. Session-launch validation remains
inline in its form.

Busy composer actions are explicit: **Steer** enters PI's steering queue before
the next model call; **Follow up** runs only after the current agent run settles.
On coarse-pointer devices, plain Enter remains a line break, tapping Send steers
by default, and holding Send exposes Follow up as an **Enqueue** action. Desktop
uses plain Enter or Send to steer and Command/Ctrl+Enter to enqueue.
When PI consumes either queue, HUI projects that instruction into the transcript
immediately so a slow response never appears without its causal user message.
A normal prompt remains rejected while busy. PI RPC exposes select, confirm,
input and editor requests, so Question is an adapted PI surface rather than a
disabled OpenClaw placeholder.

An extension question itself acknowledges the originating prompt. PI only
answers that prompt RPC after the extension handler returns, so HUI releases the
HTTP submission when the question appears and uses the delayed response as the
settle signal. This keeps a human-paced dialog from timing out or leaving the
composer permanently busy.

Uploaded files are HUI-owned transport artifacts, not transcript data. They are
validated and written under HUI's config directory with immutable paths. A
rejected prompt/queue operation removes only the files created for that request;
HUI never edits or deletes PI's transcript. Browser and gateway share the same
limits: eight attachments, 12 MB per item, 16 MB decoded total, and safe bounded
display names (including ordinary spaces and Unicode, but never paths or control
characters). PI's RPC image shape has no filename field, so HUI sends a validated,
versioned attachment manifest inside the user message. PI remains the durable
writer; on replay HUI removes that transport marker and restores the original
image/file display names and order.

Image attachments on transcript messages render as bounded thumbnails (about
240 px) that open full size in a new tab and fall back to the file card if the
bytes cannot load. Their `url` is an opaque gateway route that reads the image
from PI's in-memory history; local paths and PI storage are never exposed and
PI's persisted format is unchanged. Optimistic user messages use the local data
URL until PI's history replaces them.

The composer accepts pasted browser images as native model input. PNG, JPEG,
GIF and WebP can form an image-only prompt; every other pasted or selected file,
including video, is an immutable file attachment that requires accompanying
text so the agent can inspect its path with an available tool.

Agent output uses HUI's `present_media` tool instead of raw HTML, local-path
Markdown or base64 model prose. The tool copies up to eight requested local
files into HUI-owned immutable storage and returns opaque same-origin media
capabilities in PI's durable tool result. PNG, JPEG, GIF, WebP and AVIF render
as images; MP4, WebM, OGV and MOV use the browser's native video player; MP3,
WAV, OGG, M4A, AAC and FLAC use its native audio player; every other format is
a download card. Audio/video container recognition does not imply codec support,
so native playback failure remains visible and the original file stays
downloadable. The active tool's prompt guidance states this exact matrix and the
rule that a local path alone is not an attachment. Remote Markdown images remain
click-to-open placeholders.

HUI's turn-time presentation guidance is generated from one compact capability
catalog. It advertises Mermaid, self-contained Vega-Lite charts, KaTeX math,
GitHub-style callouts, the consent-gated X/Twitter facade and static Slack link
cards without describing them as tools. Real PI tools remain a separate, live
list built from PI's
selected names, snippets and deduplicated guidelines. This does not grant network
access or make arbitrary HTML, SVG, scripts or iframes renderable.

Unsent composer state is scoped per HUI session and stored in browser IndexedDB,
following OpenClaw's durable-draft model. Text and attachments survive navigation
between chats; a successful send retires only that session's draft, while a
rejected send restores its exact payload ahead of any newer draft.

Typing `$` at the beginning of a chat draft searches skills and plugin actions.
Typing `/` opens one grouped menu containing HUI commands, plugin actions,
skills, prompt templates, and absolute filesystem prefixes, with visible section separators.
Selecting a skill/action inserts the same `$name` alias from either menu; name
collisions retain the runtime-qualified skill name. Templates keep `/name`.
The owning runtime resolves a leading alias against its current command catalog,
not an installation path. Unknown dollar tokens and dollar signs inside prose
remain literal; this is leading-command syntax, not inline skill expansion.
Existing slash invocations remain supported. PI remains responsible for skill
expansion and extension execution, including queue and settle behavior.

Arrow keys navigate across groups, Enter/Tab complete without sending, and Escape
dismisses. Catalog and path loading/error/retry states are independent. New
Session offers **Start session & browse commands**, preserving the draft without
a model call, alongside available path results. HUI does not advertise PI's
terminal-only commands or plugins without callable actions.

Typing `@`, `./`, `../`, `~/`, or an absolute path after whitespace opens the
local-path menu. An explicit nested absolute prefix such as `/home/` uses only
path completion, avoiding command ambiguity. Directories keep navigation open;
files close the menu. New Session resolves relative paths against its selected
project directory. Filesystem results remain bounded and read-only.

HUI does expose `/clear` for an idle active session. It keeps the HUI session
row and its metadata, asks PI to start a fresh native session, and atomically
replaces the stored PI session pointer. The prior PI transcript is not deleted.
The command itself is not written to either transcript, accepts no arguments or
attachments, and is rejected while work, queued follow-ups or questions remain.
The HUI-owned `/update` command is always available, including before a session
exists. Submitting it creates or opens a dedicated **HUI update** session in
**OTHER**, keeps `/update` (or `/update --check`) in that session's composer,
and opens the update dialog without sending a prompt to PI. The draft remains
after the dialog closes, so a failed update can be retried in the same session.
The command is still not added to the PI transcript. `/update --check` is
read-only; `/update` offers an explicit install action for the checked version.
A detached updater verifies and activates the release, then the dialog
reconnects and offers to reload the new web assets. Active work blocks
activation; there is no force option in the chat flow. HUI reserves `/update`
over runtime command-name collisions and rejects invalid arguments/attachments
rather than forwarding them to the model.
Skills/templates can use the existing queue; extension commands run when idle.
An extension that completes without a model turn must also unlock the composer.

`/btw <question>` and its `/side` alias open an ephemeral side rail. HUI sends a
bounded visible transcript snapshot to the configured utility model with tools and
thinking disabled. The question and answer never enter PI's durable session or
the main transcript, so they cannot influence later turns. Examples include
`/btw which file are we editing?` and `/btw summarize the current task in one sentence`.

HUI also supplies PI with a session-scoped `progress_card` presentation tool.
PI persists its ordinary tool call in the transcript; HUI projects only the
latest validated call into a collapsible Task progress card attached above the
composer. An empty call clears the card. HUI never infers plan state from prose.
Session rows retain OpenClaw’s single-line layout. Hover or keyboard focus opens
the ported OpenClaw 2026.9.5 hovercard: session age, workspace, current unfinished
step/count and agent notepad. Idle unfinished plans show the original paused clock;
completed plans have no heads-up. Notes-only cards have no invented percentage.
Touch does not gain an extra progress button absent from the original. Background sessions
refresh while the page is visible. After a gateway restart, progress returns when
the session is reopened and its runtime restores the transcript.

## Session-born subagents

HUI supplies regular PI sessions with the OpenClaw-style coordination tools
`sessions_spawn`, `sessions_list`, `sessions_history`, `sessions_send` and
`subagents` (`list`, `steer`, `kill`). A spawn creates an ordinary HUI session
with its own PI process and transcript, plus optional parent/task metadata in
HUI's registry. The child runs independently and its terminal result is sent
back automatically as a marked, non-user completion event (result wrapped as
data, trailing action instructions). Completions are batched until all active
siblings finish and render as a system card, never as a "You" bubble. Delivery
steers an active parent, prompts an idle one, or queues a follow-up if steering
cannot be accepted. This does not abort the parent's current run. At most eight
descendants may be active in one tree.

Visibility is the current session tree, not the whole registry: parent, child
and sibling sessions can exchange bounded messages and history, while unrelated
sessions remain inaccessible. PI reaches this contract through a random-token,
loopback-only bridge inherited by its process; no browser route exposes these
operations. The UI copies OpenClaw's recent background-task rows, opens the real
child transcript on activation, and nests child sessions below their parent in
the sidebar. Each parent with visible children has a separate keyboard-accessible
disclosure button that folds its entire subtree without changing the open session.
Folding is kept in memory for the current page; search and status filters reveal
matches without clearing the fold choices. PI remains the sole transcript writer. HUI persists only lineage,
task lifecycle, bounded summaries/errors and an optional completion-delivery state.
Terminal outcomes are stored atomically with a pending delivery marker. HUI retries
pending events every five seconds and after restart, retaining them through
transport failures. Queue admission is not acknowledgement: delivery is confirmed
only when the task ID appears in the parent transcript. Per-parent single-flight
delivery and transcript IDs suppress ordinary retries and the crash-before-ack
window; this is at-least-once recovery, not exactly-once processing or proof that
the parent completed its work. Legacy terminal tasks without a delivery marker
are not replayed. A gateway restart marks unfinished
subagents interrupted instead of pretending they are still running. After a
task reaches a terminal state and its result has been delivered, HUI closes the
child's live runtime (after its current browser reader leaves, if any) while
retaining its session row and PI transcript; opening that session later resumes
it through the normal hydration path.

Archiving or restoring a session applies to its complete descendant tree in one
registry update, even across session groups. Archiving hides the tree from active
lists but does not cancel running work; later children inherit the archive state.
Deleting a session removes the complete subtree from HUI, closes its live runtimes
and terminals only after persistence succeeds, and leaves all PI transcripts and
worktrees untouched. A failed write rolls back every deletion guard. The delete
dialog states that subagents, including nested ones, are included.

## Background watchers

Some work is a wait, not a task: a pull request needs approval before `/merge`,
a CI run must go green, a deploy must finish. HUI gives sessions a `watcher`
tool that runs those waits as HUI-owned background processes instead of
invisible `nohup` scripts, and lists them in the conversation that started
them.

`watcher` has five actions: `start`, `list`, `stop`, `restart` and `log`.
`start` records the watcher against the calling session — a one-line purpose,
an optional target URL, an optional outcome (`post /merge`) and the shell
command — then runs the command detached, in the conversation's working
directory, in its own process group. HUI appends
the command's output to a HUI-owned log and has the wrapper write the exit
status beside it, so the watcher keeps running after the turn and after the
gateway stops; at most ten watchers live per conversation.

The owning conversation lists its watchers at the end of the transcript in the
same compact rows as background agents: a status icon (the agents' orbit while
running), the purpose, the latest non-empty log line and a one-word state with
its time (phones keep only the purpose and state until a row is opened).
Several watchers collapse into one summary line (*N watchers · M running ·
purpose*); nothing floats over the conversation. State is derived
from reality, never guessed: `running` only while the recorded PID is still the
process HUI started (a reboot that reuses the PID reads dead), `done` or
`failed` from the recorded exit status, `stopped` after an operator stop, and
`dead` when the process is gone with no exit record. Opening a row shows the
target link, the outcome, start and end times, why a watcher failed or died, a
bottom-anchored log tail that follows new output, the PID and log path, and
*Stop* while running or *Restart* and *Dismiss* once settled. The command runs
with the session's own local access; HUI does not sandbox it. The registry
lives in `~/.config/hui/watchers.json` with one log per watcher under
`~/.config/hui/watchers/`; deleting a conversation stops and forgets its
watchers.

The gateway re-reads the registry on start, so a watcher that survived a
restart reappears with its state, and one killed by a reboot is shown dead
instead of silently missing. HUI does not install a launchd agent: a watcher
runs until its command ends or the machine restarts, and *Restart* brings it
back afterwards.

## Kanban

**Kanban** sits directly below Automations in the sidebar (`/kanban`). It has
five columns: **Backlog**, then the development stages Investigation,
Implementation, Testing and Done.

**Backlog holds backlog items, never sessions.** Items come from two sources:

- Jira work items assigned to the connected account (`assignee =
  currentUser()`) in the To Do status category (To Do, Backlog, …) and not yet
  linked to any session. Their summary, status, type and description are read
  live and cached briefly; HUI stores only their custom group. Without a Jira
  connection, or when Jira cannot be reached, the column shows local tasks and a
  quiet note, never an error wall.
- Local tasks HUI owns (title, problem, optional fix and working directory),
  saved from a suggested-task card with **Add to backlog**. A local task that is
  later filed in or linked to Jira keeps one card, now with its Jira key.

Every backlog item has a custom group (OTHER by default). With Custom groups
lanes it sits in its group's lane; with Project lanes a local task with a
directory sits in that project, everything else in an OTHER lane; with None in
the single lane. Dragging an item to another lane *inside* Backlog only changes
its group. Its ⋯ menu offers **Start session…**, **Move to group**, **Create
Jira task…** and **Link existing Jira work item…** (local tasks without a key;
the existing dialogs, prefilled with title, problem and fix), **Open in Jira**
when linked, **Copy**, and **Remove from backlog…** (local tasks, confirmed).

**Starting work.** Dragging an item onto a stage cell, clicking its title or
choosing **Start session…** (Investigation) opens a dialog that grows step by
step. First it asks only for the folder or repository (with the new-session
page's directory suggestions); Start stays disabled until the folder is
inspected. A folder that is not a Git repository ends the form with a short
note. A Git checkout asks **Branch** (work in the current checkout) or **New
worktree**, with Branch preselected. Both modes share one branch picker,
initialized to the repository default branch as soon as inspection completes.
Changing modes preserves the selected branch or commit. Branch switches the
current checkout to that ref before the session starts. New worktree adds a
**Branch suffix** field, shown as `<branchPrefix><name>`, and creates the new
checkout from the selected ref. The
name is suggested by the utility model from the task (a 2–4 word kebab-case
description without type words, prefix or Jira key; the title's first words
without a utility model or on failure). The suggestion is requested as soon as
the folder is known to be a checkout, shows a loading state while pending,
never replaces a name the operator typed, and a request for an earlier folder
is ignored. Changing the folder resets every later step. Start creates a
session with the item's title, the
target lane's group (Custom groups) or the item's group, an operator placement
in the target column, and a first prompt of the Jira summary and description
or the local problem and proposed fix. A Jira item is linked to the new session
and so leaves the backlog; a local task is removed once the first prompt is
accepted. A failure keeps the item and shows the error in the dialog; Cancel
changes nothing; nothing moves optimistically.

Sessions sit in the stage columns. A session with no stored stage (or a stored
legacy `backlog`) is in Investigation. Within a cell cards are ordered by
session status, top to bottom: Error, Waiting input, Done (a finished run you
have not read), Working (running or starting) and Idle; pins, then recency,
break ties. Session cards show the status, a pull-request count with its state
breakdown (for example `2 PRs · 1 open, 1 merged`) and, when linked, the Jira
key and status with the sidebar's Jira hovercard.

A **View** menu, stored in the browser like the sidebar's Filter & sort,
configures the board: lanes by Project (default), Custom groups or None; sort
by Status (default), Last updated or Created; Active/Archived/All (backlog
items only appear outside Archived); which columns are visible (at least one);
whether subagent sessions are shown (hidden by default); and when empty lanes
are hidden. **Reset view** restores the defaults. A search field filters by
title, path, group, pull request and Jira key. **Refresh** also rereads the
assigned Jira items.

Stages move in three ways, with the precedence in
[docs/api.md#session-stages](docs/api.md#session-stages):

- The operator drags a card to another stage cell, uses the card's ⋯ menu, or
  presses Shift+←/→ on its focused title. Nothing moves until the server
  confirms; the card is inert meanwhile and keeps focus afterwards. An operator
  placement is marked with a pin and wins until **Let the agent decide**.
  Backlog refuses sessions like another project's lane does.
- The session's agent calls the HUI `set_stage` tool as the work changes stage.
- Pull requests advance the card: open or draft → Testing, merged → Done.

Clicking anywhere on a session card (outside its links and menu) opens its
session. Its ⋯ menu also offers **Create Jira work item…**, **Link Jira work
item…** and, when linked, **Open in Jira**. Stages are HUI presentation
metadata; PI never sees them.

With **Custom groups** lanes, dragging a session card into another lane also
moves the session to that group (OTHER clears it), in the same PATCH as any
stage change. The card menu's **Move to group** does the same in every view. A
project lane is the session's working directory, fixed at creation, so other
projects' lanes dim and refuse the card while it is dragged.

Stages share one palette (`--stage-*` in `tokens.css`): Backlog muted,
Investigation green, Implementation blue, Testing yellow, Done purple. Sidebar
session rows show a leading bar in their stage colour; an explicit session
colour keeps its bar, and child rows keep their tree guide.

## Worktrees

Settings → Worktrees (`/settings/worktrees`; the old `/worktrees` link redirects there) lists the linked worktrees (never the main checkout) of the
repositories behind registered sessions and of HUI's own `~/.config/hui/worktrees/` root, in the Sessions table
layout: branch and path, linked sessions, the branch's pull requests with state,
local changes and disk usage. Local changes, size and pull requests (via the
operator's `gh`) are computed in the background and show as pending or
unavailable rather than guessed.

Paths are shown with `~` for the home directory and truncate from the start, so
the distinguishing tail stays visible; a copy button copies the full path.
Worktrees HUI did not create (by hand or another tool) are labelled External.

Any listed worktree can be removed from its row. The button opens an "are you
sure?" modal with the full path that lists every risk: local changes that will be
permanently deleted (or could not be read), a Git lock that will be overridden,
a running linked session that HUI stops first, a missing directory, or a
worktree HUI did not create. The row shows the riskiest one as a hint beside the
button. HUI forces only the risks the user confirmed (`--force`, or `-f -f` for
a lock); a clean, unlocked worktree still goes through Git's normal check, and a
risk that appears after confirming stops the removal. Linked sessions stay in
HUI. **Clean up merged** lists and removes, after one confirmation, only HUI-created
worktrees with a merged pull request, no open or draft one, a clean checkout and
no active session: every linked session must be archived (deleted sessions are
no longer linked). The list is re-read each time the page opens. The local branch is deleted only when a merged
pull request's head is exactly the branch's current commit; otherwise it is
kept. Removals are serialized and each path is re-validated against a fresh
inventory.

## Git workspace sessions

New Session may explicitly change the selected Git checkout before launch or
create an isolated Git worktree from a branch or commit in the selected
directory's repository. Its checkout picker mirrors the OpenClaw Current
checkout / New worktree flow and offers a bounded branch list without fetching
remotes. In Current checkout mode, choosing a different ref runs Git's normal
checkout operation in the existing repository before the session is registered;
Git rejects dirty checkouts that would lose work. In New worktree mode, HUI
uses the operator's branch name or, when none is given, a short kebab-case name
the utility model writes from the prompt (the first meaningful words of the
title or prompt without a utility model or on failure). New Session returns
as soon as the request is valid: the session appears in the sidebar and opens
at once, so another session can be started while Git works. The session shows
*Naming worktree* while it is chosen, then the Git worktree progress; the
gateway sends the first prompt once the checkout and runtime are ready. It uses the HUI-local
`branchPrefix` setting (`feature/` by default), and places the checkout under
`~/.config/hui/worktrees/`. Session registration and worktree creation form one
operation: if the registry write fails, HUI removes only the new worktree and
branch it just created. Removing a session never removes its worktree or branch;
destructive cleanup remains a separate future contract.
While Git materializes the checkout, the session and its sidebar row show Git's
reported percentage for the active checkout or content-filter phase. Setup and finalization remain
indeterminate rather than presenting a fabricated whole-operation percentage.
If Git fails, the session stays listed in an error state showing Git's error;
deleting it returns its prompt to New Session. A gateway restart forgets an
unfinished session.

## Remote workers

A session can run on another machine. A **worker** is a name and a connect
command: any argv prefix that opens a stdio pipe to a POSIX shell there, such as
`ssh devbox`, `docker exec -i box` or `kubectl exec -i pod --`. HUI never asks
for passwords or keys; the command must work non-interactively. Settings →
Workers adds, connects, re-syncs, disconnects and removes workers and shows
the remote host, sync summary and errors. A worker that sessions still use
cannot be removed. A worker session runs on the same runtime a local one
would (Pi Durable by default, PI with `HUI_SESSION_RUNTIME=pi`), inside the
worker's host; its conversation lives in that worker's own store. `hui doctor`
leaves worker records unchanged.

- **Setup through the command only.** Each step runs `<command> sh -s` with a
  script on stdin. HUI looks for Node.js 22.19+ (Pi Durable needs its
  built-in SQLite) with npm on the remote and, if missing, downloads the
  gateway's own Node version from nodejs.org (curl or wget required). Those
  builds need glibc: on Alpine or another musl system HUI stops with a message
  asking for Node.js 22.19+ from the system's packages. It then uploads its own
  worker code (the same HUI version) and installs the PI SDK, Pi Durable and
  their peers with `npm install`, at the versions HUI's lockfile pins. Everything lives under `~/.local/share/hui-worker` (or
  `$XDG_DATA_HOME/hui-worker`); the remote user's own files are not touched.
- **A durable host.** One per-user host daemon runs HUI's runtime adapters on
  the remote (Pi Durable in-process, PI SDK workers as children); the gateway
  reaches it through the command's stdio and drives each session through the
  same runtime contract as a local one. Losing the connection (laptop asleep,
  gateway restart, network drop) leaves remote sessions running: runs finish,
  follow-ups sent while a run streams there run (they queue on the worker and
  are shown read-only, like steering; while earlier ones wait in HUI's
  editable queue they wait there too, behind them, and run once HUI is back
  and the run has settled), and a Durable run interrupted by a host restart
  resumes when the host starts again. HUI notices a silent connection within
  45 s, reconnects by itself and reopens the sessions the loss interrupted;
  reopening reattaches to the live session, replays its pending questions and
  catches up on its transcript. Meanwhile the header and sidebar show
  "Reconnecting to <worker>…" with one notice, "Connection to <worker> lost —
  the session keeps running there. HUI reconnects automatically.", never a
  failure; the composer keeps the draft, and sending waits for the worker.
  When HUI is not retrying (the worker was disconnected or removed, or after a
  gateway restart could not be reached) the session reads "Disconnected from
  <worker>" with a **Reconnect** action, which connects the worker (explaining
  when it no longer exists); opening the session alone never reconnects it.
  Such sessions hold up a gateway restart or update only while HUI holds
  follow-ups for them. A run that finished meanwhile is not
  "recovered", even once its idle runtime has stopped or the host restarted;
  a PI run cut off mid-way (the host or its runtime stopped) is continued by
  HUI on the next open, as a local one after a gateway restart. Detached idle workers stop after ten minutes, an idle host
  after thirty, unless Durable work still has to run (an
  open store alone keeps nothing alive). A newer gateway replaces an idle older
  host; one that is busy, or that another HUI is connected to, keeps serving.
- **Your PI setup, mirrored.** Before a session starts (at most every 30 s)
  HUI mirrors the user's PI settings, models, context files (`AGENTS.md`,
  `SYSTEM.md`, …), extensions, skills, prompts, `~/.agents/skills`, every local
  path named in PI settings, HUI's settings and provider selections and the
  worker's extra paths. Local paths in settings become absolute mirror paths.
  `npm:` and `git:` packages, and the dependencies of mirrored local packages,
  are installed on the remote. A worker session gets what a local one gets:
  skills (HUI's bundled ones included), context files, prompt templates,
  models including HUI-managed providers, HUI tools and HUI's skill and plugin
  choices, and PI extensions load on both runtimes, as locally. Agent
  shells there do not inherit the host's HUI directories, so a `hui` or `pi`
  run from one uses the remote user's own; only a PI session's shells see
  `PI_CODING_AGENT_DIR` (the mirror), as a local PI worker's see PI's.
  Credentials, transcripts, `node_modules`, `.git` and files over 8 MB are not
  mirrored; files HUI mirrored earlier and no longer sends are removed.
- **Credentials stay on the gateway.** The remote runtimes ask the connected
  gateway for each credential; an OAuth refresh runs on the remote while the
  gateway holds its own credential lock, and the rotated token is written only
  there. The host keeps the answers in memory only, never on disk, so runs
  keep going while the gateway is away; an answer is dropped when its token
  expires. Without a gateway and a cached answer, the remote's own PI login
  is used, read only if its `auth.json` exists; HUI never creates it. Provider keys
  that models.json resolves from environment variables or commands resolve on
  the remote. A key written literally in models.json, or a literal value of a
  header whose name looks like a credential (one of its `-`, `_` or `.`
  separated parts is `auth`, `authorization`, `cookie`, `token`, `secret`,
  `password`, `passphrase`, `passcode`, `credential(s)`, `jwt`, `signature`,
  `bearer` or `csrf`, or it contains `api-key`, `apikey`, `access-key`,
  `private-key` or `secret-key`; `x-max-tokens` or `idempotency-key` do not),
  is never mirrored: the remote's copy
  drops the key, which the gateway serves as that provider's credential when
  its PI login has none (PI's own precedence), and names a `HUI_SECRET_…`
  variable in place of the header value. The gateway sends those values with
  each sync; the host keeps them in memory only, and PI resolves them as
  environment variables whatever the provider's credential, but no process
  the host starts inherits them, agent shells included. Other literal headers
  are configuration and are mirrored. A placeholder key for a proxy the remote
  runs itself works offline only when written as `$NAME` or `!command`. After
  a host restart the header values return with the gateway's next sync; until
  then a model that needs one fails with PI's message naming that variable.
  Without a gateway or a cached answer only the remote's own login applies.
  An invalid models.json is not mirrored at all.
- **Sessions.** New Session's **Run on** picker lists workers. A remote
  directory must be absolute or start with `~/` and is checked when the session
  starts; creating one never waits on a connection. The header shows the worker.
  Subagents of a remote session run on the same worker. HUI agent tools work
  through the gateway; presented media is copied back from the remote. With no
  gateway connected (or when it leaves mid-call) a HUI tool call fails at once
  with a message saying HUI is not connected; it is never replayed.
  Not yet available remotely: terminals, watchers, the managed browser, New
  worktree and branch checkouts, and multi-account quota rotation (the default
  account is used). Usage totals skip remote transcripts.

## Bots

A **bot** is a named, persistent agent: a role and standing instructions, its
own model, a working directory and **one chat that never ends**, whose memory is
OptChat (HUI-18). Sessions keep everything they have (worktrees, rewind,
`/compact`); bots are for assistants the operator returns to every day. The
sidebar splits into **Agents | Bots**, and the `hui bot` CLI can do
everything the Bots tab can, through the same routes.

- **A chat is a session.** A bot's chat is an ordinary Durable session on this
  gateway, created through New Session's path, so the chat view, streaming,
  steering, follow-ups, questions and model switching are the session's own.
  Its record names the bot; the bot registry (`bots.json`) holds the rest.
  Remote workers do not run bots.
- **Before the first word.** The persona becomes the conversation's standing
  instructions, and OptChat is switched on, in the commit that creates the
  conversation.
- **Forever.** Clearing, compacting, rewinding or deleting a bot's chat is
  refused; archiving the bot deletes nothing, disables its routines and stops a
  running turn, and restoring it brings it back with its routines still off.
- **Messages.** A message to a bot is a prompt when it is idle and a follow-up
  when it is busy; a caller may wait for the reply of the turn that answers it,
  and learns at once when that turn asks a question. Every screen and terminal
  on a bot's chat sees a message another one sent (a routine, a bot, the Bots
  tab) before the reply to it.
- **Routines** are Automation tasks aimed at a bot's chat, marked
  `[routine: <name>]`, queued behind a busy bot instead of skipped.
- **Bots talk to bots** with a `message_bot` tool only bots' chats have,
  beside a byte-stable list of the other bots in their system prompt. A message
  arrives as `[from @handle] …`; chains stop after three hops and each bot sends
  at most 30 bot messages an hour.
- **Memory** is OptChat's ([docs/optchat.md](docs/optchat.md)): every message
  kept word for word and condensed into a summary tree a fresh turn reads, so
  the chat is never compacted. Bots reach it only through one interface, so its
  engine stays separate; `hui bot memory` and the memory routes show its
  status, its view, any line zoomed down to a message, and a browse page.
- **The Bots tab** is opt-in: Settings → Sessions → *Show the Bots tab* (off by
  default, saved in HUI settings). Hiding it never stops bots or routines. On,
  an **Agents | Bots** switch tops the sidebar, above even its header buttons
  (arrow keys, Home/End; the browser remembers the tab): Agents is the sidebar
  as before, and Bots shows only the roster, without the navigation or New
  session. Bot chats never
  appear in the Sessions list, its search, Kanban, the Sessions page, the
  command palette or session pickers; Automations labels their routines
  *Bot · name* and words
  their schedules as the bot's panel does (*Daily at 08:00*). The roster
  lists bots by latest activity: the bot's animated face (or its emoji), the
  name, the latest message or role, a short time, an activity badge (active,
  waiting for an answer, summarizing memory, failed), an unread dot (also on the
  Bots tab while Agents shows) and a warning while memory summaries keep
  failing. Search matches name, handle and title. The toolbar's + opens **New
  bot** (name, look, title, instructions, model, thinking, memory model,
  workspace; nothing changes until the gateway accepts it); *Gateway default*
  leaves the model and thinking level to the gateway, and choosing it when
  editing clears the bot's own. A row's menu offers Edit, Hide/Unhide (*Show
  hidden* while any are hidden) and Archive, confirmed, with a Restore toast;
  *Show archived* (while any are archived) lists archived bots with Restore,
  and an archived bot's chat opens again only once restored. A bot opens at
  `/bots/<id>` as its one chat in the ordinary session pane, its header
  showing face, name, role and status;
  assistant turns carry the bot's name, `/clear`, `/compact`, Compact now and
  rewind are not offered, and a new bot says *Say hi to <name>*. Opening it
  marks it read. A **Routines | Memory** panel docks beside the chat (open or
  closed and the tab are remembered; on narrow screens it opens on request as a
  sheet over the chat). Routines lists the bot's Automation tasks with schedule,
  next run, an enable switch, Run now and Delete, adds routines every N
  minutes/hours/days, daily, weekly or once in the browser's time zone, and shows
  the latest runs. Memory shows messages, the view against its 128 KB budget,
  its lines, pending summaries, what the summarizer spent since the gateway
  started (calls, tokens, a cost once one is reported), *Summarizing memory…*
  and failures, and lists the view's `id+n|text` lines (a click opens a line
  into its halves, down to a message whole); while open it reads the memory
  again whenever the bots stream reports it changed, with no timer. *Open memory
  page* is a plain link to OptChat's browse page, opened in a new tab.
- **Voice** goes through [VoiceStudio](https://github.com/debpalash/VoiceStudio),
  a separate speech service the gateway only calls over HTTP. The connection is
  the gateway's (Settings → Integrations → VoiceStudio, verified before it is
  saved, its key write-only), and bot chats offer voice only while it is
  configured. A bot has a voice, a speed and a language (its dialog, with a
  preview, or `--voice`/`--voice-speed`/`--language`): one of Whisper's
  languages that VoiceStudio listens for and speaks in, never a translation, or
  Auto to let it detect the language. Its composer records **voice notes** that
  VoiceStudio writes into the composer, or sends at once marked `[voice] ` when
  Settings says so; **Read aloud** speaks a reply sentence by sentence, one at a
  time; the header's **Call** starts a hands-free call. There is no
  speech-to-speech API, so a call is a cascade: the browser's voice-activity
  detection cuts what is said, VoiceStudio transcribes it, it reaches the chat
  as an ordinary `[voice] ` message, and the reply is spoken as it streams;
  speaking over the bot stops its voice and steers a turn that still runs. The
  call view takes the bot's color and shows its face listening to the
  microphone and speaking with its voice, a timer, both sides' captions, mute
  and hang up, and minimizes to a bar; hanging up deletes nothing. The microphone opens only on a click and
  closes with the note or call; HUI stores no audio, only the chat's text.

The contract is [docs/api.md#bots](docs/api.md#bots).

## Decisions

### Bots are named chats, not an agent selector (2026-10-05)

The owner approved GrokBot/Hermes-style bots on 2026-10-05: a **Sessions | Bots**
sidebar split, bots as named Durable conversations with OptChat memory, `hui bot`
CLI parity with the Bots tab, routines through Automation and voice through
VoiceStudio later. This satisfies the rule against new Agents or Approvals
surfaces without a product decision: a bot is a chat with a name and standing
instructions, not an Agents page or a global agent identity, and it adds no
approval layer. Bots run with the same Full Access as every session, on this
gateway only (remote workers are a later follow-up).

On 2026-10-06 the owner asked for Hermes's layout: the switch moved to the top
of the sidebar and its first tab is named **Agents**. Agents is the same session
sidebar, not an Agents page or agent selector; Bots shows only the roster.
Later that day he asked for it above everything else, the header buttons
included, because the two tabs work differently: it is now a full-width tab bar
over a divider, the first thing in the sidebar.

### Bots have animated faces (2026-10-06)

The owner asked for faces "like OpenAI Dots" instead of letter and emoji
avatars and approved the prototype (`bot-face-prototype.html`, outside the
repository) with "Okay, implement this"; the prototype is the spec. Each bot
gets a plush SVG shape (Blob, Pebble, Triangle, Heart, Cookie) in one of six
colors, with two dot eyes and no mouth, drawn by `<hui-bot-face>` with no new
dependency. Expressions come from the eyes (blinks, glances, squints, closed
arcs) and the body (breathing, sway, squash and stretch, hops), for ten
states: idle, thinking, working (a tool runs), speaking, listening, waiting (a
question), memory (summarizing), error, done (a hop when a turn ends) and
offline (unreachable or archived).

- **Look on the record, defaults from the id.** `avatar` gains `shape` beside
  `emoji` and `color` (no format change: absent keys stay absent). A bot without
  them gets the face its id picks, the same everywhere; a new bot from the Bots
  tab keeps the face its dialog showed. The emoji stays an alternative: a bot
  with one shows it until someone switches it to its face (clearing the emoji),
  and its tile takes the bot's color. The CLI has `--shape`, `--color` and
  `--emoji ""`, and `hui bot show` prints the look.
- **Real states only.** Roster rows follow the bot's status (a running turn is
  thinking); its open chat adds a running tool, a pending question, memory
  waits and a failed turn; a call listens with the microphone's level (from the
  frames voice-activity detection already reads) and speaks with the voice's
  (an envelope of each clip read at its playback position, without rerouting
  the audio). Text badges and status lines stay; faces are `aria-hidden`.
- **Cheap.** CSS keyframes carry the motion; small faces only blink and glance
  on timers. Large faces (empty chat, call, the dialog's preview) also follow
  the pointer and morph on animation frames. Faces pause while hidden or off
  screen, and prefers-reduced-motion leaves a still expression per state.
- **Later, if wanted:** accessories (Dots' glasses, hats), more shapes, a custom
  color picker, and sprite-sheet pets.

### New sessions run on Pi Durable

New sessions use the `durable` runtime (`@earendil-works/pi-durable` 1.0.1).
One harness per gateway owns their conversations, runs, inbox and crash
recovery in a single SQLite store, `~/.config/hui/durable/harness.sqlite`
(`HUI_DURABLE_DIR` overrides it), locked to one gateway at a time. Every
step is checkpointed: after a gateway crash or restart the harness resumes the
interrupted run by itself. A cut-off model request is sent again; an
interrupted tool call is reported to the model as interrupted rather than
rerun, because no HUI or coding tool is marked replay-safe. HUI therefore never
sends its recovery prompt to a Durable session.

PI still owns configuration: the harness reads PI's `settings.json`,
`models.json`, credentials, skills, extensions, `AGENTS.md`/`SYSTEM.md`/
`APPEND_SYSTEM` and prompt templates through PI's SDK, and builds the system
prompt with PI's own section builder plus HUI's sections, as the SDK worker
does. A provider header that interpolates `PI_CLIENT_SESSION_ID` gets a value
per HUI session, as a PI worker gets one in its environment. Durable's own
tools are its read/write/edit/bash tools and HUI's tools, which call the
gateway's agent-tool handler in process as the conversation's bound HUI
session. A rewind forks the conversation, so the abandoned branch stays
stored. Prompt-free Continue is not available on Durable; an aborted run
continues from a new prompt.

Each Durable session also loads the PI extensions its PI worker would: the
packages and extensions PI settings name and the `extensions/` directories,
with HUI's plugin choices applied. Every session gets instances of its own,
started once its history is read and shut down when it closes; `/reload` loads
them again and `/clear` starts new ones. They run in the gateway process through
PI's own extension runner, bound to the conversation:

- Their tools are offered beside Durable's. One named like a coding tool
  replaces it; HUI's tools win over theirs. Inspection names the extension
  behind each tool and lists load errors.
- Their commands appear in the `/` menu and run in the gateway. A command that
  starts no run settles the session when it ends.
- Their handlers see the session's lifecycle, its prompts (`input`, and
  `before_agent_start`, whose messages go to the model as hidden context just
  before the prompt and whose system prompt applies to that run), the model
  context before each request, provider requests and responses, tool calls
  (which they may block or rewrite) and results, and compactions (which they
  may decline or summarize). A run is over once its `agent_end` and
  `agent_settled` handlers ran, or 30 seconds after it ended. Stop while a
  prompt passes its handlers sends nothing.
- Their dialogs are HUI questions and their notifications HUI notices.
  Terminal-only UI (status lines, widgets, custom components, shortcuts) is
  ignored.
- What they store with `appendEntry` and the messages they send are Durable
  entries, so their state survives a restart. Their messages stay out of the
  transcript, as in PI sessions, even one that starts a turn.
- Not available in Durable sessions: registering providers or models,
  replacing or branching the session from a command, turn-boundary entries and
  continuation, replacing a finished message, extra resource paths and nested
  tool calls.
- After a gateway restart, interrupted runs resume once their sessions have
  loaded their extensions again, or after 30 seconds.

An extension that blocks the event loop holds up every session; PI's worker
isolates each session's extensions in a process of its own.

Compaction is Durable's too, with Durable's semantics where they differ from
PI's. `/compact`, **Compact now** and the harness's own compactions (background
ahead of the threshold, blocking at it, and after an overflow) run Durable's
compaction task with PI's `compaction` settings. Only a blocking compaction
holds its run; manual and background ones run beside the conversation, so input
is never held, the session stays idle and the summary lands at the next
boundary. A manual one can be cancelled alone, and Stop during a run cancels it
as `Conversation.abort()` does; a background one keeps running. A rewind forks
the history as it was, without a summary placed later. The transcript keeps the
whole history with each summary in place.

`HUI_SESSION_RUNTIME=pi` starts new sessions on the PI SDK worker instead.
Existing sessions keep the runtime they were created with until
`hui doctor --fix` moves them (below). HUI never edits or deletes PI
transcripts.

### `hui doctor` migrates state an upgrade leaves behind

`hui doctor` runs checks that only read and report what an upgraded HUI needs
changed; `hui doctor --fix` applies their fixes. Fixes run only with the gateway
stopped, confirmed under the lifecycle lock so none starts meanwhile, and a
Durable store held by any gateway refuses them. A change that leaves persisted
state behind ships with a check, so upgrades stay explicit, reviewable and
repeatable rather than happening silently at gateway start.

The first check moves PI sessions to Pi Durable. The PI file is read as text,
never through PI's `SessionManager`, which may rewrite it; PI's pure helpers
upgrade older formats in memory and project each entry as PI sends it. The
active branch becomes the conversation's history in order: pi-ai messages as
Durable user, assistant and tool-result entries, PI's own message kinds as the
user messages PI sends, each compaction as Durable's summary entry headed at
PI's first kept entry, and each context edit as a Durable edit. The next
request therefore carries what PI would have sent, under Durable's system
prompt. The spend HUI totalled for the PI file is written to `pi.usage`. The
conversation, its spend and a `hui.pi-import` index document are written in one
commit, then the registry record switches to `durable:<id>`; a rerun reuses the
copy of an unchanged file. The registry is backed up before its first change.
Sessions with an interrupted run stay on PI so the gateway can recover them,
and entries on abandoned branches stay only in the PI file.

### HUI owns an isolated PI SDK backend, not a PI fork

Sessions on the `pi` runtime (sessions created before Durable that
`hui doctor --fix` has not moved, worker sessions, and new ones under
`HUI_SESSION_RUNTIME=pi`)
keep this design. Each active one runs a
Node child with the pinned
`@earendil-works/pi-coding-agent` SDK (1.0.1). HUI owns the versioned default
prompt, HUI tool definitions and runtime inspection; PI still owns its agent
loop, configuration, credentials, resources and JSONL transcript writer. For
these sessions the gateway neither embeds the agent loop nor runs their
extensions; Durable sessions run theirs in the gateway (above).

The worker reuses PI's `runRpcMode` for streaming, queues and extension questions.
HUI's client uses strict newline framing, plus a versioned Node IPC channel for
fresh tool/prompt inspection. Process isolation and the generic runtime contract
are preserved. The trade-off is an additional pinned dependency graph that HUI,
not a PATH CLI upgrade, must maintain.

`HUI_PI_BACKEND=cli` selects the previous CLI adapter for new/reopened runtimes;
`HUI_PI_CLI` can select an explicit binary. There is no automatic retry or backend
switch during a turn. Only one runtime may own a session file at a time.

Tools settings is global and does not require a session. It distinguishes shipped
tools, default activation, configured package sources and the actual registered /
active tools of an already-running session. Reading the global catalog never
resolves packages, runs extensions or creates a transcript. Live inspection also
shows schemas, load diagnostics and the effective prompt; cold inspection does
not start the session. Terminal-only extension UI is not web UI.

The SDK uses HUI's base prompt unless PI resolves a user `SYSTEM.md` override.
PI composes `APPEND_SYSTEM.md`, context files and skills. HUI contributes guidance
for the actual active tool definitions at turn time. The CLI retains its own
prompt. These are behavior defaults, not an approval or sandbox mechanism.

### The server is long-lived

Sessions live in the server process, so closing the window must not stop it. That
is what makes this a replacement rather than a viewer, and it is OpenClaw's own
shape: a gateway that owns sessions, and a UI that talks to it.

Measured: `pi --mode rpc` takes **4.5–5.7 seconds** to become ready, so the UI has
to show that it is starting.

## Explicitly out of scope

- A global agent identity/selector surface and approval queues. HUI runs the
  installed PI configuration in Full Access, subject only to HUI-owned resource
  enablement; session-born subagents share that runtime configuration and do not
  add an approval interception layer. Bots (above) are named chats under that
  same configuration, not an agent selector.
- Attaching to tmux panes, accounts and MCP plumbing.
- Restoring Git worktrees, or bulk-removing or bulk-forcing worktrees. See
  Worktrees for the confirmed per-row removal HUI does own.

## PI package and skill mutations

PI remains the only writer of its package and skill configuration. HUI may
delegate these explicit operations to PI:

- install a catalog package from a clean `https://pi.dev/packages/<name>` URL
  through `pi install npm:<name>`;
- remove an installed package through `pi remove <exact configured source>`,
  after an inline confirmation;
- install one skill from an HTTPS URL through a short-lived, no-session PI
  agent using minimal thinking and the cheapest available model (or the
  operator's `HUI_SKILL_INSTALL_MODEL` override).

HUI serializes these mutations. Package labels are resolved back to an exact
currently configured PI source on the server. A skill operation is successful
only when a fresh PI inventory discovers a new `SKILL.md`; process exit alone
is not success. HUI never edits PI's settings or skill directories itself.

HUI also ships `create-verification-skill`, a portable generator for project-local
verification workflows, and `git-selective-staging`, which commits only a
session's own hunks when a shared or reused checkout already holds other
uncommitted work, both with the **good practices** tag. Each is available by
default in new SDK and CLI runtimes, not automatically executed. Their read-only
files live in HUI's installed package; no installation agent, provider call or PI
configuration write is needed. Skills and Settings → Skills expose the same
opt-out toggle and document viewer. Opt-out persists in the existing
`disabledSkills` preference under the stable `hui:skill:<name>` identity
(for example `hui:skill:create-verification-skill`), so upgrades and rollback paths do not reset it. A same-name PI user,
project or package skill takes precedence; disabling HUI's fallback does not
disable that independently owned override. Existing live runtimes keep their
loaded resources until the next start; read-only probes do not load the default.

HUI may also disable an installed skill, package or direct extension only for
HUI-owned PI runtimes. Preferences are stored in HUI settings by stable skill
path or opaque configured-source identity; they do not remove resources or
rewrite PI configuration. On the next SDK runtime start, HUI gives PI a filtered
in-memory settings view before resource discovery. Disabled package/extension
code is therefore never imported, and every skill or prompt supplied by a
disabled package is absent. Individual disabled skills are removed before PI
assembles its prompt and command catalog. Already-running sessions are not
restarted implicitly. The explicit CLI fallback refuses to start while a plugin
policy is active because it cannot provide the same pre-load guarantee.

The Skills and Plugins inventories also expose a read-only viewer. Skills render
their inventoried `SKILL.md`; installed packages prefer a top-level README and
fall back to `package.json`; direct extensions show their configured source file.
The browser addresses only opaque inventory ids. The server revalidates each id
against current PI settings, never executes the resource, never accepts a path,
and limits returned text to 256 KiB.

The ordered implementation tasks and accepted capability matrix are in
`docs/implementation-roadmap.md`.

## Desktop distribution

Electron renders the same production UI through the existing HTTP/SSE API, with
an isolated, sandboxed renderer and no filesystem/Node bridge. The desktop shell
uses the installed CLI to start or reuse the identity-checked managed gateway;
it honors release selection and never creates a second lifecycle/state system.
Closing a window or quitting the desktop application leaves gateway jobs alive.
Normal `hui gateway stop` retains its idle-work protections.

Global npm installation on macOS registers a user-owned `~/Applications/HUI.app`
when lifecycle scripts are permitted. `hui install-app` repairs registration.
The bundle has its own name/icon, is ad-hoc signed, depends on the npm/Node
installation, stores no credentials, and never replaces an unrelated app. It
changes no PI/HUI persistence formats. Native macOS behavior remains a release
verification gate until tested on-device.
