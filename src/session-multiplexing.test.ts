import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

test("pane views are keyed independently of session and retain hidden session views", () => {
  const view = readFileSync(new URL("./components/session-multiplexer.ts", import.meta.url), "utf8");
  assert.ok(view.includes('repeat(stablePanes, (pane) => pane.id'));
  assert.match(view, /const stablePanes = \[\.\.\.panes\]\.sort/);
  assert.doesNotMatch(view, /repeat\(column\.panes/);
  assert.ok(view.includes('repeat(slots.get(pane.id)'));
  assert.ok(view.includes('?inert=${!visible || !current}'));
  assert.ok(view.includes('@pointerdown=${() => this.onFocusPane(pane.id)}'));
  assert.ok(view.includes('@focusin=${() => this.onFocusPane(pane.id)}'));
});

test("embedded panes omit global monitors and delegate routing and Escape", () => {
  const app = readFileSync(new URL("./hui-app.ts", import.meta.url), "utf8");
  assert.match(app, /if \(!this\.embeddedPane\) \{\n\s+this\.sessions\.start\(\);/);
  assert.ok(app.includes('if (target.kind === "session") this.onPaneNavigate?.(target.id)'));
  assert.ok(app.includes('this.activePaneApp()?.handleGlobalEscape(event)'));
  assert.ok(app.includes('this.embeddedPane ? this.paneMobileNav && this.paneActive : this.mobileNavLayout'));
});

test("duplicate-session controls use pane-scoped ids", () => {
  const home = readFileSync(new URL("./views/home.ts", import.meta.url), "utf8");
  assert.ok(home.includes('props.controlScope ? `${props.controlScope}-`'));
  assert.ok(home.includes('renderActionTooltip(rewindTooltipId,'));
  assert.ok(home.includes('id=${id} role="tooltip"'));
});

test("the narrow panel selector uses the shared HUI picker instead of a native select", () => {
  const app = readFileSync(new URL("./hui-app.ts", import.meta.url), "utf8");
  const selector = readFileSync(new URL("./views/panel-selector.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles/terminal.css", import.meta.url), "utf8");
  assert.doesNotMatch(app, /aria-label="Active panel"/);
  assert.match(selector, /renderPicker\(\{/);
  assert.match(selector, /label: "Active panel"/);
  assert.doesNotMatch(selector, /<select/);
  assert.doesNotMatch(css, /\.hui-panel-selector select/);
});

test("embedded panes open from the shell's registry entry instead of waiting on their own fetch", () => {
  const app = readFileSync(new URL("./hui-app.ts", import.meta.url), "utf8");
  const open = app.slice(app.indexOf("private openPendingSession()"), app.indexOf("private selectView ="));
  assert.ok(open.includes("?? (this.paneSession?.id === id ? this.paneSession : undefined)"));
});
