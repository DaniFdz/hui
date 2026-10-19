import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { html } from "lit";
import { APPLE_PLATFORM } from "../lib/shortcut-binding.ts";
import { registerWorkViewKind, sessionWorkPane, WORK_PANE_KEY } from "../lib/work-pane.ts";
import { WORK_SHORTCUTS } from "../lib/work-shortcuts.ts";
import { WorkLayoutController } from "./work-layout-controller.ts";

const fake = vi.hoisted(() => ({ browser: { reason: "" as string | undefined, fail: false } }));

beforeEach(() => {
  fake.browser = { reason: undefined, fail: false };
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  vi.stubGlobal("document", { activeElement: null, body: {}, querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });
  registerWorkViewKind({
    kind: "browser", label: "Browser", icon: html``, shortcut: WORK_SHORTCUTS.browser, single: true,
    unavailable: () => fake.browser.reason,
    create: () => fake.browser.fail ? Promise.reject(new Error("no browser")) : { kind: "browser" },
    key: () => "browser", title: () => "Browser", render: () => html``,
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const press = (binding: string) => {
  const [code = ""] = binding.split("+").slice(-1);
  const prevented: string[] = [];
  const event = {
    altKey: binding.includes("Alt"), shiftKey: binding.includes("Shift"), code,
    ctrlKey: binding.includes("Mod") && !APPLE_PLATFORM, metaKey: binding.includes("Mod") && APPLE_PLATFORM,
    defaultPrevented: false, isComposing: false, repeat: false,
    preventDefault: () => prevented.push("default"), stopPropagation: () => prevented.push("propagation"),
  } as unknown as KeyboardEvent;
  return { event, prevented };
};

function setup({ followed = "s1" as string | undefined, palette = false } = {}) {
  const shell = { followed, palette, composerFocus: 0 };
  const host = { renderRoot: { querySelector: () => null } as unknown as HTMLElement, addController: () => {}, removeController: () => {}, requestUpdate: () => {}, updateComplete: Promise.resolve(true) };
  const work = new WorkLayoutController(host, {
    followedSession: () => shell.followed,
    layout: () => undefined,
    commitLayout: () => {},
    focusComposer: () => { shell.composerFocus += 1; },
    paletteOpen: () => shell.palette,
    terminalFont: () => "mono",
    browserEnabled: () => true,
    remoteSession: () => false,
  });
  return { work, shell };
}

test("launching shows the view and saves the record; a reason or a failure opens the pane with its error", async () => {
  const { work } = setup();
  fake.browser.reason = "Browser is off.";
  await work.launch("browser");
  assert.equal(work.error, "Browser is off.");
  assert.equal(sessionWorkPane(work.panes, "s1").open, true);
  assert.equal(sessionWorkPane(work.panes, "s1").views.length, 0);
  fake.browser = { reason: undefined, fail: true };
  await work.launch("browser");
  assert.equal(work.error, "no browser");
  assert.equal(work.launching, "");
  fake.browser.fail = false;
  await work.launch("browser");
  assert.equal(work.error, "");
  assert.equal(work.launchedKey, "browser");
  assert.equal(sessionWorkPane(work.panes, "s1").active, "browser");
  assert.match(localStorage.getItem(WORK_PANE_KEY) ?? "", /"s1"/u);
});

test("shortcuts act only while a conversation is shown and nothing modal is open", async () => {
  const { work, shell } = setup({ palette: true });
  const toggle = press(WORK_SHORTCUTS.togglePane);
  work.onShortcut(toggle.event);
  assert.deepEqual(toggle.prevented, []);
  shell.palette = false;
  shell.followed = undefined;
  work.onShortcut(toggle.event);
  assert.deepEqual(toggle.prevented, []);
  shell.followed = "s1";
  const browser = press(WORK_SHORTCUTS.browser);
  work.onShortcut(browser.event);
  assert.deepEqual(browser.prevented, ["default", "propagation"]);
  await settle();
  assert.equal(sessionWorkPane(work.panes, "s1").active, "browser");
});

test("on narrow screens the toggle shows the Work destination and hides it back to the composer", () => {
  const { work, shell } = setup();
  work.narrow = true;
  work.onShortcut(press(WORK_SHORTCUTS.togglePane).event);
  assert.equal(work.narrowShown, true);
  work.onShortcut(press(WORK_SHORTCUTS.togglePane).event);
  assert.equal(work.narrowShown, false);
  assert.equal(shell.composerFocus, 1);
  work.toggleMaximized(true);
  assert.equal(sessionWorkPane(work.panes, "s1").maximized ?? false, false, "narrow screens never maximize");
});

test("closing the followed conversation's last view returns focus to the composer only if the pane was shown", async () => {
  const { work, shell } = setup();
  await work.launch("browser");
  work.close("s1", "browser", "s1");
  assert.equal(sessionWorkPane(work.panes, "s1").views.length, 0);
  assert.equal(work.launchedKey, "");
  assert.equal(shell.composerFocus, 1);
  await work.launch("browser");
  work.close("s1", "browser", "other");
  assert.equal(shell.composerFocus, 1, "another conversation's pane does not move focus");
});
