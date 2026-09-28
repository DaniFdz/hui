import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  type DrawerMediaQuery,
  APP_SHELL_DRAWER_MEDIA,
  filterSessionGroups,
  isSessionGroupCollapsed,
  normalizeCustomSessionIcon,
  PRIMARY_NAV,
  sessionAccessibleName,
  sessionMoveGroupOptions,
  setNavigationDrawer,
  SHELL_DRAWER_DEFAULT_OPEN,
  SHELL_NARROW_MEDIA,
} from "./shell.ts";
import {
  adaptedSettingsCopy,
  filterSettingsPages,
  piSettingsState,
  setSettingsDrawer,
  SETTINGS_DRAWER_DEFAULT_OPEN,
  SETTINGS_PAGES,
} from "./settings.ts";
import type { SessionGroup, SessionView } from "../lib/sessions-store.ts";

function session(
  id: string,
  title: string,
  group: string,
  overrides: Partial<SessionView> = {},
): SessionView {
  return {
    id,
    title,
    group,
    cwd: `/work/${group}`,
    tool: "pi",
    status: "idle",
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

const SESSION_GROUPS: SessionGroup[] = [
  {
    label: "Frontend",
    sessions: [
      session("one", "Fix navigation", "Frontend"),
      session("two", "Review styles", "Frontend", { tool: "codex", cwd: "/repo/web" }),
    ],
  },
  {
    label: "Runtime",
    sessions: [session("three", "Resume gateway", "Runtime", { cwd: "/repo/server" })],
  },
];

function controlledMedia(initialMatches = true) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    get matches() {
      return matches;
    },
    addEventListener(_type: "change", listener: (event: MediaQueryListEvent) => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: "change", listener: (event: MediaQueryListEvent) => void) {
      listeners.delete(listener);
    },
  } as DrawerMediaQuery;
  return {
    media,
    listenerCount: () => listeners.size,
    setMatches(next: boolean) {
      matches = next;
      const event = { matches: next } as MediaQueryListEvent;
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
  };
}

test("the primary sidebar lists work destinations and ends with Settings", () => {
  assert.deepEqual(PRIMARY_NAV.map((item) => item.id), ["worktrees", "cron", "plugins", "skills"]);
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  const nav = source.slice(source.indexOf('<nav class="sidebar-nav"'), source.indexOf("</nav>", source.indexOf('<nav class="sidebar-nav"')));
  assert.doesNotMatch(nav, /(?<![A-Z_])NAV\.map|icons\.home/u);
  // Kanban is a HUI route rendered directly below Automations.
  assert.match(nav, /item\.id === "cron" \? kanbanNavItem\(props\)/u);
  assert.match(nav, /sidebar-nav__settings[\s\S]*props\.onOpenSettings\(\)[\s\S]*>Settings<\/span>\s*<\/a>\s*$/u);
});

test("settings navigation contains only the twelve accepted regions", () => {
  assert.deepEqual(
    SETTINGS_PAGES.map((page) => page.id),
    [
      "appearance",
      "connection",
      "integrations",
      "models",
      "plugins",
      "skills",
      "tools",
      "memory",
      "automation",
      "security",
      "sessions",
      "diagnostics",
    ],
  );
});

test("settings exit is direct and Escape is handled from navigation and content", () => {
  const source = readFileSync(new URL("settings.ts", import.meta.url), "utf8");
  assert.match(source, /class="settings-sidebar__back settings-nav__back"\s+@click=\$\{props\.onClose\}/u);
  assert.match(source, /class="content settings-main" @keydown=\$\{\(event: KeyboardEvent\) => handleSettingsEscape\(event, props\)\}/u);
  assert.match(source, /class="shell-nav settings-sidebar settings-nav"[^>]*@keydown=\$\{\(event: KeyboardEvent\) => handleSettingsEscape\(event, props\)\}/u);
});

test("settings search is case-insensitive and also matches group names", () => {
  assert.deepEqual(filterSettingsPages("  MODEL  ").map((page) => page.id), ["models"]);
  assert.deepEqual(
    filterSettingsPages("agents & tools").map((page) => page.id),
    ["models", "plugins", "skills", "tools", "memory", "automation"],
  );
  assert.deepEqual(filterSettingsPages("does not exist"), []);
  assert.equal(filterSettingsPages("").length, SETTINGS_PAGES.length);
});

test("session search indexes title, tool, cwd and group label without mutating groups", () => {
  assert.deepEqual(filterSessionGroups(SESSION_GROUPS, "NAVIGATION").map((group) =>
    group.sessions.map((item) => item.id)), [["one"]]);
  assert.deepEqual(filterSessionGroups(SESSION_GROUPS, "codex").map((group) =>
    group.sessions.map((item) => item.id)), [["two"]]);
  assert.deepEqual(filterSessionGroups(SESSION_GROUPS, "server").map((group) =>
    group.sessions.map((item) => item.id)), [["three"]]);
  assert.deepEqual(filterSessionGroups(SESSION_GROUPS, "frontend").map((group) =>
    group.sessions.map((item) => item.id)), [["one", "two"]]);
  assert.deepEqual(SESSION_GROUPS.map((group) => group.sessions.map((item) => item.id)), [
    ["one", "two"],
    ["three"],
  ]);
});

test("session accessible names expose live status, tool and pinned state", () => {
  const base = session("one", "Fix navigation", "Frontend", { status: "running" });
  assert.equal(sessionAccessibleName(base), "Fix navigation, status running, tool pi");
  assert.equal(
    sessionAccessibleName({ ...base, pinned: true, unread: true }),
    "Fix navigation, status running, tool pi, pinned, unread",
  );
});

test("session move targets always include OTHER once and preserve stored group labels", () => {
  assert.deepEqual(sessionMoveGroupOptions(SESSION_GROUPS), [
    { label: "OTHER", value: "" },
    { label: "FRONTEND", value: "Frontend" },
    { label: "RUNTIME", value: "Runtime" },
  ]);
  assert.deepEqual(sessionMoveGroupOptions([{ label: "ungrouped", sessions: [] }]), [
    { label: "OTHER", value: "" },
  ]);
});

test("session rows expose group drag and a keyboard-accessible move menu", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  assert.match(source, /writeSessionDrag\(event\.dataTransfer, session\)/);
  assert.match(source, /sidebar-recent-sessions__group--session-drop/);
  assert.match(source, />Move to group</);
  assert.match(source, /slot="submenu" value=\$\{`move:/);
  assert.match(source, /group\.kind === "custom"/);
});

test("session menu mirrors the compatible OpenClaw action hierarchy", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  for (const label of [
    "Pin session", "Rename…", "Mark as unread", "Archive session", "Icon",
    "Move to group", "Copy", "Session link", "Conversation as Markdown", "Session ID",
    "Open in", "New tab", "New window", "Workspace · VS Code", "Delete…",
  ]) assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(source, />Assign to</);
  assert.doesNotMatch(source, />Fork conversation</);
  assert.doesNotMatch(source, /Icon &amp; color|Session color|session-menu__color/);
});

test("session appearance picker centers reset controls and accepts custom emoji", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");
  assert.equal(normalizeCustomSessionIcon("  🐧  "), "🐧");
  assert.equal(normalizeCustomSessionIcon("   "), undefined);
  assert.equal(normalizeCustomSessionIcon("x".repeat(33)), undefined);
  assert.match(source, /aria-label="Custom emoji…"/);
  assert.match(source, /class="session-menu__icon-custom-input"/);
  assert.match(source, /\$\{icons\.circleX\}/);
  assert.doesNotMatch(source, /Session color|session-menu__color/);
  assert.doesNotMatch(styles, /session-menu__color/);
  assert.match(styles, /\.session-menu__icon-choice--glyph svg\s*\{\s*width:\s*16px;\s*height:\s*16px;/);
});

test("session rows delegate previews to the pinned OpenClaw provider", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  assert.match(source, /<hui-session-hovercard-provider \.sessions=/);
  assert.match(source, /data-session-key=\$\{session.id\}/);
  assert.match(source, /openclaw-session-menu-open/);
  assert.doesNotMatch(source, /session-row__tooltip|session-row__progress|session-progress-trigger/);
  assert.match(source, /\$\{icons\.moreHorizontal\}/);
});

test("session rows retain original title marquee and two inline actions", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  assert.match(source, /sidebar-recent-session__title-row/);
  assert.match(source, /renderHoverMarquee\(session\.title, "sidebar-recent-session__name"\)/);
  assert.match(source, /class="session-action session-action--pin"/);
  assert.match(source, /session-row-host--pinned/);
  assert.doesNotMatch(source, /data-session-row-action-count="1"|class="session-row__pin"/);
});

test("session rows drag to panes and retain an accessible split fallback", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");

  assert.match(source, /writeSessionDrag\(event\.dataTransfer, session\)/);
  assert.match(source, /const canDrag = props\.sessionMovePendingId !== session\.id/);
  assert.match(source, /value="split"[\s\S]*?Open in split pane/);
  assert.match(source, /props\.onSplitSession\(session\)/);
  assert.match(source, /!props\.selectedSessionId \|\| selected \|\| splitOpen/);
  assert.match(source, /open in split pane/);
  assert.match(styles, /\.sidebar-recent-session--split/);
});

test("session rows mirror OpenClaw run and attention states", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");
  const components = readFileSync(new URL("../styles/openclaw-reference/components.css", import.meta.url), "utf8");

  assert.match(source, /session\.status === "waiting"[\s\S]*?Waiting for your answer/);
  assert.match(source, /session\.status === "error"[\s\S]*?Session failed/);
  assert.match(source, /session\.status === "running" \? html`<span class="session-glyph session-glyph--running session-glyph--bare"/);
  assert.match(source, /class="session-glyph__ring"/);
  assert.match(components, /\.session-glyph__ring[\s\S]*?animation: session-run-spin 1\.6s linear infinite/);
  assert.match(styles, /\.sidebar-session-attention__icon--question \{ color: var\(--warn\)/);
  assert.match(styles, /\.sidebar-session-attention__icon--error \{ color: var\(--danger\)/);
  assert.match(source, /const unread = session\.unread === true && !attention/);
  assert.doesNotMatch(source, /const unread =[^;]*!selected/);
  assert.match(source, /class="sidebar-session-unread-dot"/);
  assert.match(styles, /\.sidebar-session-unread-dot[\s\S]*?background: var\(--accent\)/);
  assert.match(components, /prefers-reduced-motion: reduce[\s\S]*?\.session-glyph__ring/);
  assert.doesNotMatch(source, /session-row__avatar/);
});

test("session rows show state-colored pull request links that open GitHub", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");
  assert.match(source, /class="session-pr-badge"[\s\S]*?data-state=\$\{pullRequest\.state \?\? "unknown"\}[\s\S]*?href=\$\{pullRequest\.url\}[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/);
  assert.match(source, /aria-label=\$\{pullRequestAccessibleLabel\(pullRequest\)\}/);
  assert.match(source, /installPullRequestHovercard\(\)/);
  assert.match(source, /<hui-pull-request-strip class="session-pr-badges"[\s\S]*?\[\.\.\.pullRequests\]\.reverse\(\)/);
  assert.doesNotMatch(source, /session-pr-badges__more|data-touch-more/);
  assert.match(styles, /\.session-pr-badges \{[\s\S]*?flex-direction: row-reverse;[\s\S]*?max-width: calc\(var\(--pr-badge-size\) \* 1\.5 \+ var\(--pr-badge-gap\)\);[\s\S]*?overflow-x: auto;/);
  assert.match(styles, /\.session-pr-badges\[data-more-before\] \{\s*mask-image: linear-gradient\(to right, var\(--pr-strip-dim\)/);
  assert.match(styles, /:has\(> \.sidebar-recent-session__link:is\(:hover, :focus-visible\)\) > \.session-pr-badges \{\s*max-width: var\(--pr-badge-size\);/);
  assert.match(styles, /> \.session-pr-badges:is\(:hover, :focus-within\) \{[^}]*?max-width: max\([^;]*?calc\(\(100% - var\(--session-row-actions-reserve, 52px\) - var\(--session-title-overhead\)\) \/ 2\)/);
  assert.doesNotMatch(styles, /:has\(> \.session-pr-badges:is\(:hover, :focus-within\)\) > \.sidebar-recent-session__link/);
  assert.match(styles, /\.session-pr-badge\[data-state="open"\] \{ --session-pr-color: var\(--ok\); \}/);
  assert.match(styles, /\.session-pr-badge\[data-state="merged"\] \{ --session-pr-color: var\(--pr-merged\); \}/);
  assert.match(styles, /\.session-pr-badge\[data-state="closed"\] \{ --session-pr-color: var\(--danger\); \}/);
});

test("the persistent draft pencil reserves its slot beside pull request marks", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");
  assert.match(source, /\$\{hasDraft \? "sidebar-recent-session--has-draft" : ""\}/);
  assert.match(styles, /\.sidebar-recent-session--has-draft > \.session-pr-badges \{ margin-right: var\(--session-row-draft-reserve\); \}/);
});

test("session links preserve original single-line anatomy and real navigation targets", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  assert.match(source, /<a\s+href=\$\{navigationPath\(\{ kind: "session", id: session\.id \}\)\}/);
  assert.match(source, /class="sidebar-recent-session__text"/);
  assert.match(source, /class="sidebar-recent-session__aside session-row-aside"/);
  assert.match(source, /class="session-row-actions"/);
  assert.match(source, /sidebar-brand__icon sidebar-brand__header-control/);
});


test("session drafts project a persistent pencil into the action slot", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");
  assert.match(source, /props\.draftSessionIds\.has\(session\.id\)/);
  assert.match(source, /session-row__draft-icon[^\n]*\$\{icons\.edit\}/);
  assert.match(styles, /\.session-row__menu-btn--draft\s*\{\s*opacity:\s*1;/);
  assert.match(styles, /\.session-row-wrap:hover \.session-row__menu-btn--draft \.session-row__more-icon/);
});

test("embedded chat panes report draft presence to the shell that owns the sidebar", () => {
  // Each pane is its own hui-app with a private draft set; without this bridge
  // the sidebar only learned about drafts at startup or after a reload.
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");
  assert.match(app, /if \(this\.embeddedPane\) this\.onPaneDraftChange\?\.\(sessionId, hasDraft\);/);
  assert.match(app, /\.onPaneDraftChange=\$\{\(sessionId: string, hasDraft: boolean\) => this\.markSessionDraft\(sessionId, hasDraft\)\}/);
});

test("returning to the still-selected session restores its composer draft key", () => {
  // New session keeps `selected` but switches the composer to the new-session
  // draft. Without this, typing after returning persisted under the wrong key
  // and the row never showed its pencil.
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");
  assert.match(
    app,
    /if \(this\.selected\?\.id === target\.id\) \{[^}]*this\.switchComposerDraft\(sessionDraftKey\(target\.id\)\);[^}]*return;/s,
  );
});

test("active search reveals matches without changing the collapsed preference", () => {
  const collapsed = new Set(["Frontend"]);
  assert.equal(isSessionGroupCollapsed(collapsed, "Frontend", ""), true);
  assert.equal(isSessionGroupCollapsed(collapsed, "Frontend", "navigation"), false);
  assert.deepEqual([...collapsed], ["Frontend"]);
  assert.equal(isSessionGroupCollapsed(collapsed, "Frontend", "   "), true);
});

test("group menus expose the same four actions as OpenClaw", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  for (const label of ["New session defaults", "Rename group", "New group", "Delete group"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /aria-label=\$\{`Group options for \$\{group\.label\}`\}/);
  assert.match(source, /<wa-dropdown class="session-menu sidebar-session-group-menu"/);
  assert.match(source, /<wa-dropdown-item value=\$\{action\}/);
});

test("session group headers do not display session counts", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");
  assert.doesNotMatch(source, /session-group__count/);
  assert.doesNotMatch(styles, /session-group__count/);
});

test("narrow navigation drawers start closed and share the reference breakpoint", () => {
  assert.equal(SHELL_DRAWER_DEFAULT_OPEN, false);
  assert.equal(SETTINGS_DRAWER_DEFAULT_OPEN, false);
  assert.match(SHELL_NARROW_MEDIA, /max-width: 768px/);
  assert.match(SHELL_NARROW_MEDIA, /orientation: landscape/);
  assert.equal(APP_SHELL_DRAWER_MEDIA, "(max-width: 900px), (max-width: 932px) and (max-height: 500px) and (orientation: landscape)");
});

test("the floating sidebar restore control matches the in-sidebar collapse control", () => {
  const css = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    assert.notEqual(start, -1, selector);
    return css.slice(start, css.indexOf("}", start));
  };
  assert.match(rule(".app-shell"), /--shell-chrome-control-size:\s*28px/);
  assert.match(rule(".app-shell .sidebar-brand__icon"), /width:\s*28px[\s\S]*height:\s*28px/);
  const restore = rule(".app-shell .shell-chrome-controls");
  assert.match(restore, /border:\s*0/);
  assert.match(restore, /background:\s*transparent/);
  assert.match(rule(".app-shell .sidebar-brand__icon svg"), /width:\s*16px[\s\S]*height:\s*16px/);
  assert.match(rule(".app-shell .shell-chrome-controls svg"), /width:\s*16px[\s\S]*height:\s*16px/);
  // The touch block that enlarges the collapse control must enlarge the restore control too.
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\) \{[^@]*\.app-shell \{ --shell-chrome-control-size: 44px; \}[^@]*\.app-shell \.sidebar-brand__icon \{\s*width: 44px;\s*height: 44px;/u);
});

test("the shell retains reference chrome geometry with header utilities", () => {
  const css = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");

  assert.match(css, /--shell-nav-expanded-width:\s*258px/);
  assert.match(css, /--shell-topbar-height:\s*58px/);
  assert.match(css, /--shell-chrome-safe-area-left:\s*12px/);
  assert.match(
    css,
    /data-nav-collapsed="true"[^}]*--shell-chrome-safe-area-left:\s*calc\(/s,
  );
  assert.match(
    css,
    /\.app-shell:not\(\.shell--mobile-nav\)\[data-nav-collapsed="true"\] > \.content--chat > \.chat-pane__header\s*\{\s*padding-left:\s*var\(--shell-chrome-safe-area-left\)/,
  );
  // Multiplexed panes nest their header below the content column; the pane
  // at the top-left origin must still clear the floating restore control.
  assert.match(
    css,
    /\.app-shell:not\(\.shell--mobile-nav\)\[data-nav-collapsed="true"\] \.chat-split-view__cell--origin \.chat-pane-cache__pane--visible \.chat-pane__header\s*\{\s*padding-left:\s*var\(--shell-chrome-safe-area-left\)/,
  );
  const multiplexer = readFileSync(new URL("../components/session-multiplexer.ts", import.meta.url), "utf8");
  assert.match(multiplexer, /rect\.left === 0 && rect\.top === 0 \? "chat-split-view__cell--origin"/);
  assert.doesNotMatch(css, /@media \(min-width: 1101px\)/);
  assert.match(css, /width:\s*min\(86vw, 320px\)/);
  assert.match(source, /class="topbar"/);
  assert.match(source, /class="shell-nav"/);
  assert.match(source, /class="sidebar-shell sidebar-drawer__body"/);
  const appSource = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");
  assert.match(appSource, /@keydown=\$\{closeDrawerOnEscape\}/);
  assert.doesNotMatch(source, /sidebar-shell__footer|sidebar-footer-bar|renderFooter/);
  assert.doesNotMatch(source, /sidebar-agent-card|deck-card/);
  assert.match(source, /<div class="sidebar-brand">\s*<div class="sidebar-brand__utilities">/su);
  const header = source.slice(source.indexOf('<div class="sidebar-brand">'), source.indexOf('<div class="sidebar-shell__content">'));
  assert.match(header, /sidebar-brand__search" aria-label="Search sessions"/);
  const utilities = header.slice(header.indexOf("sidebar-brand__utilities"), header.indexOf("sidebar-brand__actions"));
  const actions = header.slice(header.indexOf("sidebar-brand__actions"), header.indexOf('<label class="sidebar-search'));
  assert.deepEqual([...utilities.matchAll(/aria-label="([^"]+)"/gu)].map((match) => match[1]), ["New session", "Search sessions"]);
  assert.deepEqual([...actions.matchAll(/aria-label="([^"]+)"/gu)].map((match) => match[1]), ["Collapse sidebar"]);
  assert.doesNotMatch(header, /sidebar-brand__settings|aria-label="Settings"/);
  assert.match(header, /class="sidebar-search /);
  assert.doesNotMatch(source.slice(source.indexOf('<div class="sidebar-sessions">')), /aria-label="Search sessions"/);
  assert.doesNotMatch(source, /sidebar-identity-card/);
});

test("mobile topbar icons have a fixed glyph size inside their touch target", () => {
  const css = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");
  assert.match(css, /\.app-shell \.topbar-icon-btn svg,\s*\.app-shell \.topbar-search svg \{\s*width: 20px;\s*height: 20px;/u);
});

test("the active session follows the reference neutral row state", () => {
  const css = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  assert.match(source, /selected \? "sidebar-recent-session--active"/u);
  assert.match(css, /\.session-row-wrap\.sidebar-recent-session--active\s*\{[^}]*color-mix\(in srgb, var\(--text\) 10%, transparent\)/u);
  assert.doesNotMatch(source, /session-row__active-bar/u);
});

test("the mobile topbar uses PI branding instead of the OpenClaw app icon", () => {
  const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
  assert.match(source, /class="topbar-brand" aria-label="PI"/);
  assert.match(source, /class="topbar-brand__logo" src="\/pi-logo-3d\.png"/);
  assert.doesNotMatch(source, /class="topbar-brand__logo" src="\/apple-touch-icon\.png"/);
});

test("PI-backed settings distinguish loading, failure, empty and ready states", () => {
  assert.equal(piSettingsState({ pi: undefined, piLoading: true, piError: "" }), "loading");
  assert.equal(piSettingsState({ pi: undefined, piLoading: false, piError: "offline" }), "error");
  assert.equal(piSettingsState({ pi: undefined, piLoading: false, piError: "" }), "missing");
  assert.equal(
    piSettingsState({ pi: {} as never, piLoading: false, piError: "" }),
    "ready",
  );
});

test("accepted settings describe implementation status without reopening product decisions", () => {
  const connection = adaptedSettingsCopy("connection");
  assert.match(connection.description, /accepted for adaptation/i);
  assert.match(connection.description, /not implemented yet/i);
  assert.doesNotMatch(`${connection.summary} ${connection.description}`, /approval/i);
});

test("sessions and security render implemented settings instead of placeholders", () => {
  const source = readFileSync(new URL("./settings.ts", import.meta.url), "utf8");

  assert.match(source, /props\.page === "sessions"\s*\? renderSessionsSettingsPage\(props\)/);
  assert.match(source, /props\.page === "security"\s*\? renderSecurityPage\(props\)/);
  assert.doesNotMatch(source, /sessions: "Session defaults/);
  assert.doesNotMatch(source, /security: "Secrets, audit history/);
});

test("appearance exposes OpenClaw accent presets and a custom color", () => {
  const source = readFileSync(new URL("./settings.ts", import.meta.url), "utf8");

  for (const hex of ["#ff5c5c", "#ff8066", "#f5b942", "#52c99a", "#35b9b0", "#5b9cf6", "#a78bfa", "#f472b6", "#8795a8"]) {
    assert.match(source, new RegExp(hex));
  }
  assert.match(source, /type="color" aria-label="Custom accent color"/);
  assert.match(source, /props\.onSelectAccent\(item\.value\)/);
  assert.match(source, /renderAccentSection\(props\)/);
});

test("app and settings drawers use the same narrow CSS breakpoint", () => {
  const css = readFileSync(new URL("../styles/app.css", import.meta.url), "utf8");
  const settingsSource = readFileSync(new URL("./settings.ts", import.meta.url), "utf8");
  const shellCss = readFileSync(new URL("../styles/openclaw-shell.css", import.meta.url), "utf8");
  const workspaceCss = readFileSync(new URL("../styles/openclaw-workspaces.css", import.meta.url), "utf8");
  assert.ok(shellCss.includes(`@media ${APP_SHELL_DRAWER_MEDIA}`));
  assert.ok(workspaceCss.includes(`@media ${APP_SHELL_DRAWER_MEDIA}`));
  const sharedRule = `@media ${SHELL_NARROW_MEDIA}`;

  assert.equal(css.split(sharedRule).length - 1, 1);
  assert.doesNotMatch(css, /@media \(max-width: 768px\) \{\s*\.settings-shell/);
  assert.equal(settingsSource.split("matchMedia(APP_SHELL_DRAWER_MEDIA)").length - 1, 2);
  assert.doesNotMatch(settingsSource, /matchMedia\("\(max-width: 768px\)"\)/);
});

test("navigation drawer makes main inert and clears it before returning focus", () => {
  const attributes = new Map<string, string>();
  const sequence: string[] = [];
  const trigger = {
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    focus() {
      sequence.push("focus-trigger");
    },
  };
  const main = {
    toggleAttribute(name: string, force: boolean) {
      sequence.push(`${force ? "set" : "clear"}-${name}`);
      return force;
    },
  };
  const sidebar = {
    dataset: {} as DOMStringMap,
    querySelector(selector: string) {
      return selector === ".topbar" ? trigger : null;
    },
    parentElement: {
      querySelector(selector: string) {
        return selector === ".main" ? main : null;
      },
    },
  } as unknown as HTMLElement;
  const narrow = controlledMedia();

  setNavigationDrawer(sidebar, true, false, narrow.media);
  assert.equal(sidebar.dataset.open, "true");
  assert.equal(attributes.get("aria-expanded"), "true");
  assert.equal(attributes.get("aria-label"), "Close navigation");
  assert.deepEqual(sequence, ["set-inert"]);

  setNavigationDrawer(sidebar, false, true);
  assert.equal(sidebar.dataset.open, "false");
  assert.equal(attributes.get("aria-expanded"), "false");
  assert.equal(attributes.get("aria-label"), "Open navigation");
  assert.deepEqual(sequence, ["set-inert", "clear-inert", "focus-trigger"]);
});

test("settings drawer makes its workspace inert and clears it before returning focus", () => {
  const attributes = new Map<string, string>();
  const sequence: string[] = [];
  const trigger = {
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    focus() {
      sequence.push("focus-trigger");
    },
  };
  const main = {
    toggleAttribute(name: string, force: boolean) {
      sequence.push(`${force ? "set" : "clear"}-${name}`);
      return force;
    },
  };
  const sidebar = {
    dataset: {} as DOMStringMap,
    querySelector(selector: string) {
      return selector === ".settings-mobile-topbar" ? trigger
        : selector === ".settings-sidebar__search-input" ? { focus: () => sequence.push("focus-search") } : null;
    },
    parentElement: {
      querySelector(selector: string) {
        return selector === ".settings-main" ? main : null;
      },
    },
  } as unknown as HTMLElement;
  const narrow = controlledMedia();

  setSettingsDrawer(sidebar, true, false, narrow.media);
  assert.equal(sidebar.dataset.open, "true");
  assert.equal(attributes.get("aria-expanded"), "true");
  assert.deepEqual(sequence, ["set-inert", "focus-search"]);

  setSettingsDrawer(sidebar, false, true);
  assert.equal(sidebar.dataset.open, "false");
  assert.equal(attributes.get("aria-expanded"), "false");
  assert.deepEqual(sequence, ["set-inert", "focus-search", "clear-inert", "focus-trigger"]);
});

test("app drawer closes and releases its media listener when the layout becomes desktop", () => {
  const attributes = new Map<string, string>();
  const inertStates: boolean[] = [];
  const narrow = controlledMedia();
  const sidebar = {
    dataset: {} as DOMStringMap,
    querySelector() {
      return { setAttribute: (name: string, value: string) => attributes.set(name, value) };
    },
    parentElement: {
      querySelector() {
        return { toggleAttribute: (_name: string, force: boolean) => inertStates.push(force) };
      },
    },
  } as unknown as HTMLElement;

  setNavigationDrawer(sidebar, true, false, narrow.media);
  assert.equal(narrow.listenerCount(), 1);
  narrow.setMatches(false);

  assert.equal(sidebar.dataset.open, "false");
  assert.equal(attributes.get("aria-expanded"), "false");
  assert.deepEqual(inertStates, [true, false]);
  assert.equal(narrow.listenerCount(), 0);
});

test("settings drawer closes and releases its media listener when the layout becomes desktop", () => {
  const attributes = new Map<string, string>();
  const inertStates: boolean[] = [];
  const narrow = controlledMedia();
  const sidebar = {
    dataset: {} as DOMStringMap,
    querySelector(selector: string) {
      return selector === ".settings-mobile-topbar"
        ? { setAttribute: (name: string, value: string) => attributes.set(name, value) }
        : null;
    },
    parentElement: {
      querySelector() {
        return { toggleAttribute: (_name: string, force: boolean) => inertStates.push(force) };
      },
    },
  } as unknown as HTMLElement;

  setSettingsDrawer(sidebar, true, false, narrow.media);
  assert.equal(narrow.listenerCount(), 1);
  narrow.setMatches(false);

  assert.equal(sidebar.dataset.open, "false");
  assert.equal(attributes.get("aria-expanded"), "false");
  assert.deepEqual(inertStates, [true, false]);
  assert.equal(narrow.listenerCount(), 0);
});

test("both mobile drawers make the global update notice inert until closed", () => {
  for (const setDrawer of [setNavigationDrawer, setSettingsDrawer]) {
    const states: boolean[] = [];
    const notice = { toggleAttribute: (_name: string, value: boolean) => states.push(value) };
    const sidebar = {
      dataset: {},
      closest: (selector: string) => selector === ".hui-application" ? { querySelector: () => notice } : null,
      querySelector: () => null,
    } as unknown as HTMLElement;
    const narrow = controlledMedia();
    setDrawer(sidebar, true, false, narrow.media);
    setDrawer(sidebar, false, false);
    assert.deepEqual(states, [true, false]);
  }
});

test("document-level Escape closes Settings or stops the running turn", () => {
  const appSource = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");
  assert.match(appSource, /event\.key === "Escape"\) \{\s*this\.handleGlobalEscape\(event\)/u);
  assert.match(appSource, /if \(this\.settingsOpen\) \{\s*event\.preventDefault\(\);\s*this\.closeSettings\(\);/u);
  assert.match(appSource, /this\.streaming && !this\.stopping\) \{\s*event\.preventDefault\(\);\s*this\.abort\(\);/u);
});

test("session link names retain upstream single-line navigation semantics", () => {
  const row = session("progress", "Build", "Frontend", { status: "idle", progress: {
    markdown: "Review is pending", steps: [
      { step: "Implement", status: "completed" }, { step: "Review", status: "in_progress" },
    ],
  } });
  assert.equal(sessionAccessibleName(row), "Build, status idle, tool pi");
  assert.equal(sessionAccessibleName({ ...row, stage: "testing" }), "Build, status idle, tool pi, stage testing");
  assert.equal(sessionAccessibleName({ ...row, stage: "investigation" }), "Build, status idle, tool pi, stage investigation");
  // A legacy Backlog stage from an older gateway is not a session stage any more.
  assert.equal(sessionAccessibleName({ ...row, stage: "backlog" as never }), "Build, status idle, tool pi");
});
