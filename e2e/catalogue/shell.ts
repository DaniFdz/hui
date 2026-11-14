/** The SHELL use cases: Home, routes and deep links, history, drawers, the boot screen and slow loading, the command palette, the sidebar's collapse and search, notices and toasts, copying without the Clipboard API, HUI's own update, and reading a saved conversation offline. */
import type { UseCase } from "./types.ts";

const BEHAVIOUR = "SPEC.md#behaviour";
const LAYOUT = "SPEC.md#what-the-layout-is";
const GATEWAY = "SPEC.md#installed-gateway";
const OFFLINE = "SPEC.md#offline-reading-and-connection-recovery";
const UPDATES = "docs/api.md#browser-updates";
const KEYBOARD = "SPEC.md#keyboard-only-affordances-stay-on-the-web-2026-10-21";

const cases: UseCase[] = [
  {
    id: "SHELL-001",
    title: "Open Home",
    behaviour:
      "Loading `/` shows the sidebar and, in the main area, the new-session form with no session selected. **Primary navigation** lists Contributions, Kanban, Sessions, Usage and Settings in that order, with no Home entry, for the Agents and the Bots lists alike. The sidebar header holds only **Collapse sidebar** beside the Agents and Bots tabs, and the footer below both lists is this page's gateway.",
    spec: [BEHAVIOUR, LAYOUT],
    surfaces: ["nav:home"],
    journeys: ["shell-navigation", "sidebar-toolbar"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-002",
    title: "Go to a destination from the sidebar",
    behaviour:
      'Selecting Contributions, Kanban, Sessions or Usage opens `/contributions`, `/kanban`, `/sessions` or `/usage` with that page\'s heading, and the selected item has `aria-current="page"`. Settings opens the Settings page last shown (Appearance at first). Reloading keeps each route.',
    spec: [BEHAVIOUR, LAYOUT],
    surfaces: ["nav:page", "nav:kanban", "nav:settings"],
    journeys: ["shell-navigation", "visual-parity-2026-09-24"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-003",
    title: "Open a page that has no sidebar entry by its address",
    behaviour:
      "Loading the address of a page outside the sidebar, such as `/activity`, `/logs`, `/about`, `/cron`, `/usage` or `/skills`, shows that page with its heading, and a reload stays there. Old addresses are rewritten: `/worktrees` becomes `/settings/worktrees` and `/settings/sessions` becomes `/sessions`.",
    spec: [BEHAVIOUR, LAYOUT, "docs/api.md#gateway-lifecycle-boundary"],
    surfaces: ["nav:page", "nav:settings"],
    journeys: [
      "shell-navigation",
      "visual-parity-2026-09-24",
      "webawesome-controls",
    ],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-004",
    title: "Land on Home from an unknown address",
    behaviour:
      "Loading an address HUI does not have, such as a dropped OpenClaw route (`/agents`, `/approvals`, `/channels`) or a malformed path, replaces it with `/` and shows Home, with no error page.",
    spec: [BEHAVIOUR, LAYOUT],
    surfaces: ["nav:home"],
    journeys: ["shell-navigation", "visual-parity-2026-09-24"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-005",
    title: "Open a session or a bot's chat from its address",
    behaviour:
      "Loading `/sessions/<id>` opens that session's conversation, and a reload brings back the same conversation; `/bots/<id>` opens that bot's chat with the Bots tab selected. An address whose session no longer exists lands on Home once the session list has loaded.",
    spec: [BEHAVIOUR, "docs/api.md#gateway-lifecycle-boundary"],
    surfaces: ["nav:session", "nav:bot", "route:POST /__hui/sessions/:id/open"],
    journeys: ["shell-navigation", "visual-parity-2026-09-24"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-006",
    title: "Go Back and Forward through visited screens",
    behaviour:
      "After visiting several pages, sessions or Settings pages, Back and Forward return both the address and the screen shown (heading, selected navigation item, conversation) to each earlier step.",
    spec: [BEHAVIOUR],
    surfaces: ["nav:home", "nav:page", "nav:settings", "nav:session"],
    journeys: ["shell-navigation", "visual-parity-2026-09-24"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-007",
    title: "Leave Settings back to where you came from",
    behaviour:
      "**Exit Settings** returns to the page or session Settings was opened from, such as `/activity`, not to Home or a stale session; when Settings was loaded directly by its address it returns to Home. Back after leaving does not reopen Settings.",
    spec: [BEHAVIOUR],
    surfaces: ["nav:settings"],
    journeys: [
      "shell-navigation",
      "sidebar-toolbar",
      "visual-parity-2026-09-24",
    ],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-011",
    title: "Use the navigation drawer on a narrow screen",
    behaviour:
      "On a phone-sized or short landscape screen the sidebar is hidden behind **Open navigation**. Opening it shows the drawer, the button reads **Close navigation**, and the content and any update notice behind it cannot be reached; choosing a destination such as Sessions closes the drawer and opens it, and tapping outside the drawer closes it and returns focus to **Open navigation**. Nothing overflows horizontally.",
    spec: [BEHAVIOUR, LAYOUT],
    surfaces: ["nav:page"],
    journeys: [
      "shell-navigation",
      "update-notice",
      "openclaw-primary-ui-parity",
      "visual-parity-2026-09-24",
    ],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-012",
    title: "Use the Settings drawer on a narrow screen",
    behaviour:
      "On a narrow screen Settings shows **Open settings navigation** with the current page's name. Opening it shows the Settings pages and makes the page behind unreachable; choosing a page closes the drawer, opens that page and moves focus to its heading, and tapping outside closes it, returning focus to the trigger without leaving the current page.",
    spec: [BEHAVIOUR],
    surfaces: ["nav:settings"],
    journeys: [
      "shell-navigation",
      "openclaw-primary-ui-parity",
      "visual-parity-2026-09-24",
      "sidebar-toolbar",
    ],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-013",
    title: "Close a drawer with Escape",
    behaviour:
      "Escape in the open navigation drawer first closes a session or group menu inside it, returning focus to that menu's button, and then closes the drawer, releasing the content and returning focus to **Open navigation** on the same route. Escape in the Settings drawer closes it without leaving Settings.",
    spec: [BEHAVIOUR, KEYBOARD],
    surfaces: [],
    journeys: [
      "shell-navigation",
      "webawesome-controls",
      "update-notice",
      "sidebar-toolbar",
      "openclaw-primary-ui-parity",
    ],
    web: "required",
    phone: { excluded: "Escape is a key press with no touch equivalent; the visible control that does the same is its own use case.", decision: "SPEC.md#keyboard-only-affordances-stay-on-the-web-2026-10-21" },
  },
  {
    id: "SHELL-014",
    title: "Widen the window while a drawer is open",
    behaviour:
      "With the navigation or Settings drawer open on a narrow screen, widening the window to desktop size closes the drawer and the now-visible desktop layout is fully usable, with nothing left unreachable.",
    spec: [BEHAVIOUR],
    surfaces: [],
    journeys: ["shell-navigation", "visual-parity-2026-09-24"],
    web: "required",
    phone: { excluded: "Resizing a browser window; the phone app is always narrow.", decision: "SPEC.md#browser-and-wide-layout-mechanics-stay-on-the-web-2026-10-21" },
  },
  {
    id: "SHELL-015",
    title: "Collapse and expand the sidebar",
    behaviour:
      "**Collapse sidebar** hides the sidebar and **Expand sidebar** appears in the same spot with focus on it, so a second press undoes the first; expanding brings the sidebar back. The expand control sits below an update notice and does not cover the session's title in the chat header. Narrow screens use the drawer instead and do not show the control.",
    spec: [BEHAVIOUR, LAYOUT],
    surfaces: [],
    journeys: [
      "sidebar-toolbar",
      "shell-navigation",
      "openclaw-primary-ui-parity",
      "update-notice",
    ],
    web: "required",
    phone: { excluded: "The collapse toggle exists only in the wide layout; the phone app is always narrow.", decision: "SPEC.md#browser-and-wide-layout-mechanics-stay-on-the-web-2026-10-21" },
  },
  {
    id: "SHELL-018",
    title: "Open the command palette with the keyboard",
    behaviour:
      "⌘K on Apple platforms or Ctrl+K elsewhere opens the *Search or jump to…* palette listing New Session, Sessions, Automations, Plugins and Settings; the arrow keys move through the results and Enter opens the highlighted one. The same chord or Escape closes it and returns focus to where it was.",
    spec: [BEHAVIOUR],
    surfaces: [],
    journeys: ["visual-parity-2026-09-24", "shell-navigation"],
    web: "required",
    phone: { excluded: "A keyboard chord, which a phone cannot press.", decision: "SPEC.md#keyboard-only-affordances-stay-on-the-web-2026-10-21" },
  },
  {
    id: "SHELL-019",
    title: "Search for a session, page or Settings page and jump to it",
    behaviour:
      "Typing a search lists matching sessions under Chats, pages under Navigation and Settings pages under Settings, best matches first, or *No results*. Choosing one opens it. On the web the search is the *Search or jump to…* command palette, which closes when a result is chosen.",
    spec: [BEHAVIOUR],
    surfaces: ["nav:page", "nav:settings", "nav:session"],
    journeys: ["visual-parity-2026-09-24", "webawesome-controls"],
    web: "required",
    phone: { excluded: "The search is the *Search or jump to…* palette, which only the ⌘K/Ctrl+K chord opens (SHELL-018); a phone cannot press it, and a session row, a navigation item and a Settings page are each one tap away on their own screens.", decision: KEYBOARD },
  },
  {
    id: "SHELL-020",
    title: "See HUI loading over a slow connection",
    behaviour:
      "From the first paint a boot screen shows HUI's name and a loading bar on HUI's light or dark background for the system preference, never a blank white page, until the app has drawn. When loading takes more than six seconds it adds *Still loading — the connection is slow.* with **Reload**.",
    spec: [BEHAVIOUR, "docs/api.md#gateway-lifecycle-boundary"],
    surfaces: [],
    journeys: ["remote-loading"],
    web: "required",
    phone: "backlog",
  },
  {
    id: "SHELL-021",
    title: "See the boot screen in the chosen theme",
    behaviour:
      "After a theme and accent have been chosen and the app has loaded once, the next load on that device paints the boot screen in that theme's background, text and accent instead of HUI's default colours.",
    spec: [BEHAVIOUR],
    surfaces: [],
    journeys: ["remote-loading"],
    web: "required",
    phone: "backlog",
  },
  {
    id: "SHELL-022",
    title: "Reload when HUI's code fails to download",
    behaviour:
      "When the app's code cannot be downloaded, the boot screen replaces its loading bar with *HUI could not load over this connection.* (or *HUI could not start.* for any other failure) and a **Reload** button that loads the page again.",
    spec: [BEHAVIOUR],
    surfaces: [],
    journeys: ["remote-loading"],
    web: "required",
    phone: "backlog",
  },
  {
    id: "SHELL-023",
    title: "Open a long conversation over a slow connection",
    behaviour:
      "Selecting a long session over a slow link shows *Loading the conversation…* with skeleton rows in the transcript area, then the whole conversation arrives intact. It never shows an empty *Start a conversation* or an aborted-request toast meanwhile.",
    spec: [BEHAVIOUR, "docs/api.md#post-__huisessionsidopen"],
    surfaces: ["route:POST /__hui/sessions/:id/open"],
    journeys: ["remote-loading"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-024",
    title: "Retry a conversation that failed to load",
    behaviour:
      "When the gateway cannot be reached while a session opens, the transcript area shows *Could not load this conversation* with the reason and **Try again**, never an empty chat. Once the gateway is back, **Try again** loads the conversation.",
    spec: [BEHAVIOUR, "docs/api.md#post-__huisessionsidopen"],
    surfaces: ["route:POST /__hui/sessions/:id/open"],
    journeys: ["remote-loading"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-025",
    title: "Find browser-side failures in Logs",
    behaviour:
      "A request the browser could not get to the gateway, or an uncaught error in the page, appears in Logs as a `ui` entry such as *UI request could not reach the gateway*, with repeats merged into one entry with a count. Failures from while the gateway was unreachable appear once it is back, unless the page was reloaded meanwhile.",
    spec: ["docs/api.md#post-__huidiagnosticsui-errors"],
    surfaces: ["route:POST /__hui/diagnostics/ui-errors"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-026",
    title: "Read and dismiss a chat notification",
    behaviour:
      "Chat notices, such as *Session context cleared.* after `/clear`, appear as a toast in the top trailing corner, never as a paragraph in the transcript: info toasts have no icon, warnings and errors show a triangle, and only errors are announced as alerts. **Dismiss notification** removes the toast; on a phone it fits the screen width.",
    spec: ["SPEC.md#live-chat-projection"],
    surfaces: [],
    journeys: ["chat-notifications"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-027",
    title: "See a retry warning until the run settles",
    behaviour:
      "While a run retries after a provider error, a warning toast reads *Retrying after a provider error (attempt 1): …*; a fallback to another model reads *Primary model failed before producing output. Retrying with <model>.* in the same way. When the run ends in an error card, the warning toast closes.",
    spec: ["SPEC.md#live-chat-projection"],
    surfaces: [],
    journeys: ["chat-notifications"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-028",
    title: "See the outcome of a sidebar or list action",
    behaviour:
      "The outcome of an action such as copying a session link, moving a session or a bulk delete shows in one toast: a success clears itself after 6 seconds, while a failure, announced as an alert with a triangle, and an in-progress message ending in *…* stay until replaced or dismissed with **Dismiss notification**.",
    spec: ["SPEC.md#live-chat-projection"],
    surfaces: [],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-029",
    title: "Copy text where the Clipboard API is unavailable",
    behaviour:
      "On a plain HTTP or LAN address without the Clipboard API, **Copy response** still copies the exact assistant text and the button reads **Copied**; the same holds for every HUI copy action. No hidden helper is left in the page and the previous focus and selection return.",
    spec: [BEHAVIOUR],
    surfaces: [],
    journeys: ["clipboard-fallback"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-031",
    title: "Learn that a new HUI release is available",
    behaviour:
      "On an installed HUI, opening the app while online (and every hour after, while it stays visible) shows the non-modal banner *HUI <version> is available* with **Review update** above every screen, Settings included. Checking never installs, restarts or calls a model, and a failed background check shows nothing; the development server shows no banner.",
    spec: [GATEWAY, UPDATES, "docs/api.md#get-__huiupdatecheck"],
    surfaces: ["route:GET /__hui/update/check"],
    journeys: ["update-notice"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-032",
    title: "Dismiss the update banner",
    behaviour:
      "**Dismiss update notification** hides the banner without touching the composer's draft; it stays hidden for that version until the page reloads, and a different newer version can still appear.",
    spec: [GATEWAY, UPDATES],
    surfaces: [],
    journeys: ["update-notice"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-033",
    title: "Review an update from the banner",
    behaviour:
      "**Review update** opens, or creates in OTHER, the *HUI update* session with `/update` in its composer and opens the *Update HUI* dialog with *Installed version <current>*, the latest stable version and **Update to <version>**; nothing installs and no model turn starts. An unsent draft in the previous composer is kept, and **Close** returns focus to **Review update**.",
    spec: [
      GATEWAY,
      UPDATES,
      "docs/api.md#get-__huiupdate",
      "docs/api.md#post-__huiupdatecheck",
    ],
    surfaces: [
      "route:GET /__hui/update",
      "route:POST /__hui/update/check",
      "route:POST /__hui/sessions",
    ],
    journeys: ["update-notice"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-034",
    title: "Close the update dialog with Escape",
    behaviour:
      "Escape closes the *Update HUI* dialog, leaving the composer's draft unchanged and returning focus to the control that opened it.",
    spec: [UPDATES, KEYBOARD],
    surfaces: [],
    journeys: ["update-notice"],
    web: "required",
    phone: { excluded: "Escape is a key press with no touch equivalent; the visible control that does the same is its own use case.", decision: "SPEC.md#keyboard-only-affordances-stay-on-the-web-2026-10-21" },
  },
  {
    id: "SHELL-035",
    title: "Check for HUI updates with /update",
    behaviour:
      "Typing `/upd` in any composer, New Session included, offers `/update` (*Check for HUI updates and install the latest release*) without waiting for a session's commands. Sending `/update` opens, or creates in OTHER, the *HUI update* session with `/update` kept in its composer and opens the *Update HUI* dialog; no prompt reaches the model.",
    spec: [GATEWAY, UPDATES],
    surfaces: [
      "command:update",
      "route:GET /__hui/update",
      "route:POST /__hui/update/check",
      "route:POST /__hui/sessions",
    ],
    journeys: ["update"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-036",
    title: "Check for an update without installing",
    behaviour:
      "`/update --check` opens the same dialog with what the check found and *Check only. Run /update to install an available release.*, with no install button.",
    spec: [GATEWAY, UPDATES],
    surfaces: ["command:update", "route:POST /__hui/update/check"],
    journeys: ["update"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-037",
    title: "Get told how to use /update",
    behaviour:
      "Sending `/update` with any other argument, or with an attachment, sends nothing to the model and shows the error toast *Use /update or /update --check, without attachments. This command is handled by HUI, not the model.*",
    spec: [UPDATES],
    surfaces: ["command:update"],
    journeys: ["update"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-038",
    title: "See why an update cannot be installed",
    behaviour:
      "When no stable release is published, the release cannot be read, or HUI is the development server or an externally managed install, the dialog says so, shows no install button and removes the banner; it never claims HUI is current. **Check again** brings the install button back once a release is available.",
    spec: [GATEWAY, UPDATES, "docs/api.md#post-__huiupdatecheck"],
    surfaces: ["route:POST /__hui/update/check"],
    journeys: ["update", "update-notice"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-039",
    title: "Get stopped from updating while sessions are busy",
    behaviour:
      "**Update to <version>** while a turn on PI's worker is running shows *Finish active sessions before updating HUI.*; the gateway and the turn keep running. After the turn is stopped or finishes, the dialog can install. A Pi Durable run does not block the update and carries on after it.",
    spec: [GATEWAY, "docs/api.md#post-__huiupdate"],
    surfaces: ["route:POST /__hui/update"],
    journeys: ["update"],
    web: "backlog",
    phone: "backlog",
  },
  {
    id: "SHELL-040",
    title: "Install a HUI update",
    behaviour:
      "**Update to <version>** reads **Updating…**, the banner disappears and the dialog shows *Reconnecting to the gateway…* while the gateway restarts, then *Installed version <version>*, *HUI <version> is ready.* and **Reload HUI**, which appears only after a confirmed success. A failed update says why and keeps the previous version running.",
    spec: [GATEWAY, UPDATES, "docs/api.md#post-__huiupdate"],
    surfaces: ["route:POST /__hui/update", "route:GET /__hui/update"],
    journeys: ["update", "update-notice"],
    web: "required",
    phone: "backlog",
  },
  {
    id: "SHELL-041",
    title: "Return to an update in progress",
    behaviour:
      "Closing the dialog while an update runs does not cancel it; sending the kept `/update` again reopens the dialog on the running update's status. If the update never reports completion, the dialog says *The update has not reported completion. Check hui gateway status and logs, then reopen /update.*",
    spec: [UPDATES, "docs/api.md#get-__huiupdate"],
    surfaces: ["command:update", "route:GET /__hui/update"],
    journeys: ["update"],
    web: "backlog",
    phone: "backlog",
  },
  {
    id: "SHELL-042",
    title: "Reload HUI after an update",
    behaviour:
      "**Reload HUI** comes back on the same session address with its transcript, tool results and unsent draft, and no update banner. `/update --check` then reports the installed version as current with no install button, and no model request was made by checking, installing or reloading.",
    spec: [GATEWAY, UPDATES],
    surfaces: ["route:POST /__hui/update/check"],
    journeys: ["update", "update-notice"],
    web: "required",
    phone: "backlog",
  },
  {
    id: "SHELL-043",
    title: "Save each download where you choose",
    behaviour:
      "In HUI's desktop app a download (a presented file, an attachment card's open link or a Files view's Download) opens a save dialog that starts in Downloads with the file's name, and cancelling the dialog saves nothing.",
    spec: ["SPEC.md#desktop-downloads-ask-where-to-save-them"],
    surfaces: [],
    web: {
      excluded:
        "The browser saves downloads itself, and the save dialog belongs to HUI's Electron desktop app, which the web runner cannot drive; desktop/main.test.mjs covers the chosen path, the cancel and one dialog per download.",
      decision: "SPEC.md#desktop-downloads-ask-where-to-save-them",
    },
    phone: { excluded: "The save dialog is the desktop app's; the phone app hands a download to the system's own download handling.", decision: "SPEC.md#desktop-downloads-ask-where-to-save-them" },
  },
  {
    id: "SHELL-044",
    title: "Open a saved conversation without the gateway",
    behaviour:
      "Once a production build's offline files are ready, reloading a previously opened conversation with the gateway unreachable shows that conversation again: its saved message text, the sidebar row for it, and a note reading Saved conversation · <time>. Message text is saved on this device. The last saved row is followed by a placeholder saying newer messages may follow. The composer keeps its draft, Send message stays disabled, and the band under it spins with the live connection note (for example Reconnecting; your draft stays on this device.).",
    spec: [OFFLINE],
    surfaces: [],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-045",
    title: "Return to a live conversation without resending the draft",
    behaviour:
      "When the gateway is reachable again, the saved conversation becomes live: the saved note and the saved band go away, the header shows the session's own status, the draft is still in the composer with Send message enabled, and the message sent before going offline appears once. Sending the draft then posts it once, as a new turn.",
    spec: [OFFLINE],
    surfaces: [],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-046",
    title: "Forget the saved conversations",
    behaviour:
      "Forget saved conversations on a conversation saved on this device removes the saved copies from the browser, leaves the draft in the composer with Send message still disabled while the gateway is unreachable, and a reload with the gateway still unreachable no longer brings the conversation or its message text back.",
    spec: [OFFLINE],
    surfaces: [],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-047",
    title: "Use a phone's chat without a second header row",
    behaviour:
      "At 390 × 844 the conversation's header holds the Active panel chooser in place of its title, so the chat spends one row on that header; the chooser still lists the chat panes, the open Work views and the launchers, and the header's rightmost Run status trigger keeps only its mark and count. The popover's Plan starts folded to its current step and count, and opening it shows its steps.",
    spec: ["SPEC.md#behaviour"],
    surfaces: [],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-048",
    title: "Widen or narrow the sidebar",
    behaviour: "Dragging the boundary at the sidebar's right edge widens or narrows it, and it stops at 200px and at 460px. The boundary is a separator named **Resize sidebar** that also takes the arrow keys, 16px a press and 48px with Shift, and the sidebar comes back at the width it was left at after a reload. The Settings shell's rail is the same sidebar at the same width, with the same boundary, and resizing either one moves both.",
    spec: [BEHAVIOUR, LAYOUT],
    surfaces: [],
    journeys: ["sidebar-toolbar", "shell-navigation"],
    web: "required",
    phone: { excluded: "The phone app is always narrow, so its sidebar is the drawer, which has no boundary.", decision: "SPEC.md#browser-and-wide-layout-mechanics-stay-on-the-web-2026-10-21" },
  },
  {
    id: "SHELL-050",
    title: "Clear of the phone's own chrome",
    behaviour:
      "The status bar, the notch and the home indicator never cover HUI's own chrome: the header a phone draws starts below the top inset so its menu button is a full tap, and the composer ends above the bottom one. A page loaded in a browser reserves the insets itself (\`viewport-fit=cover\` is set, and Safari does not inset the layout); the installed app pads the page's frame natively and reports the tokens as zero, and a standalone page pads \`body\`, so no surface counts an inset twice.",
    spec: [LAYOUT],
    surfaces: ["nav:session", "nav:home"],
    journeys: ["phone", "shell-navigation"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-049",
    title: "See this page's gateway and switch from the sidebar footer",
    behaviour:
      "The sidebar's footer is one button named after the gateway serving this page, with a state dot. Opening it lists **Gateways**: that one marked *Current*, then every other gateway this device added by its own name, then **Add a gateway…**. Choosing another gateway opens that address in this page (the native app rebuilds its bridge on that gateway), and **Add a gateway…** opens the Add gateway dialog in place, with its **Name** and **Address**, the same dialog Settings → Gateway uses.",
    spec: ["SPEC.md#a-device-keeps-a-list-of-gateways-2026-11-11", GATEWAY, "docs/api.md#adding-a-gateway"],
    surfaces: ["route:GET /__hui/update", "route:GET /__hui/health", "nav:settings"],
    journeys: ["gateway-settings"],
    web: "required",
    phone: "required",
  },
  {
    id: "SHELL-051",
    title: "Close the gateway menu with Escape",
    behaviour: "Escape closes the open gateway picker and returns focus to the sidebar's gateway button.",
    spec: ["SPEC.md#keyboard-only-affordances-stay-on-the-web-2026-10-21"],
    surfaces: [],
    journeys: ["gateway-settings"],
    web: "required",
    phone: { excluded: "Escape and its focus-return path require a hardware keyboard; the gateway menu itself is shared as SHELL-049.", decision: "SPEC.md#keyboard-only-affordances-stay-on-the-web-2026-10-21" },
  },
  {
    id: "SHELL-052",
    title: "Keep gateway links and switches inside the desktop window",
    behaviour:
      "In HUI's desktop app, switching to another gateway — **Switch** in Settings → Gateway, or choosing it in the sidebar footer — loads that gateway in the same window, and so does a link to a gateway this device lists or to one on this device's own network that answers as HUI. A `hui://` chat link opens its chat on the gateway the window shows. A page of the gateway on screen that asks for a new tab still opens in the browser, and a public web or mail link still opens in the system browser. View → Back returns to the gateway left behind. A phone has no such window: switching rebuilds its native bridge in place (SHELL-049), and a link to another gateway is the system browser's.",
    spec: ["SPEC.md#the-window-belongs-to-the-gateways-this-device-knows", "SPEC.md#a-device-keeps-a-list-of-gateways-2026-11-11"],
    surfaces: [],
    web: {
      excluded:
        "Switching gateways happens in the page on the web, but keeping the window belongs to HUI's Electron shell, which the web runner cannot drive; desktop/main.test.mjs covers the switch, the gateways this device lists, the identity handshake and the links left to the browser.",
      decision: "SPEC.md#the-window-belongs-to-the-gateways-this-device-knows",
    },
    phone: {
      excluded:
        "A phone has no window to keep and no View → Back: switching rebuilds its native bridge on the chosen gateway (SHELL-049, proved on the android target), and its WebView hands a link to another origin to the system browser (SPEC.md \"The phone apps wrap the web UI\").",
      decision: "SPEC.md#the-window-belongs-to-the-gateways-this-device-knows",
    },
  },
];

export default cases;
