import assert from "node:assert/strict";
import { test } from "vitest";
import { closeDropdownOnEscape, hasOpenWebAwesomePopup, keepReopenedSubmenuVisible } from "./web-awesome.ts";

test("an open shadow popup owns dismissal before the enclosing view", () => {
  for (const localName of ["wa-select", "wa-dropdown"]) {
    const event = { composedPath: () => [{ localName: "input" }, { localName, open: true }, {}] } as unknown as Event;
    assert.equal(hasOpenWebAwesomePopup(event), true);
  }
});

test("closed controls and unrelated open elements do not claim Escape", () => {
  const event = { composedPath: () => [{ localName: "wa-select", open: false }, { localName: "details", open: true }, {}] } as unknown as Event;
  assert.equal(hasOpenWebAwesomePopup(event), false);
});

function escapeEvent(key: string, open: boolean) {
  const calls: string[] = [];
  const popup = {
    open,
    querySelector: () => ({ focus: () => calls.push("focus trigger") }),
  };
  const event = {
    key, currentTarget: popup,
    preventDefault: () => calls.push("prevent default"),
    stopPropagation: () => calls.push("stop propagation"),
  } as unknown as KeyboardEvent;
  return { event, popup, calls };
}

test("Escape closes only the inner popup and returns focus before an enclosing Settings/drawer handler", () => {
  const { event, popup, calls } = escapeEvent("Escape", true);
  closeDropdownOnEscape(event);
  assert.equal(popup.open, false);
  assert.deepEqual(calls, ["prevent default", "stop propagation", "focus trigger"]);
});

test("Escape from an already-closed popup can reach the enclosing surface", () => {
  const { event, popup, calls } = escapeEvent("Escape", false);
  closeDropdownOnEscape(event);
  assert.equal(popup.open, false);
  assert.deepEqual(calls, []);
});

test("Tab and arrow keys stay owned by Web Awesome", () => {
  for (const key of ["Tab", "ArrowUp", "ArrowDown", "Home", "End", "Enter"]) {
    const { event, popup, calls } = escapeEvent(key, true);
    closeDropdownOnEscape(event);
    assert.equal(popup.open, true);
    assert.deepEqual(calls, []);
  }
});

function submenuItem({ open, menu = true, connected = true }: { open: boolean; menu?: boolean; connected?: boolean }) {
  const calls: string[] = [];
  const submenu = {
    hidden: false, isConnected: connected,
    showPopover: () => calls.push("show popover"),
    setAttribute: (name: string, value: string) => calls.push(`${name}=${value}`),
  };
  const item = {
    submenuOpen: open, submenuElement: submenu,
    closest: () => ({ open: menu }),
    // Web Awesome hides the submenu after its close animation, not at the call.
    closeSubmenu: async () => { calls.push("close"); await Promise.resolve(); calls.push("hide"); submenu.hidden = true; },
  };
  keepReopenedSubmenuVisible(item);
  return { item, submenu, calls };
}

test("a submenu that reopened during its close animation shows again instead of staying hidden", async () => {
  const { item, submenu, calls } = submenuItem({ open: true });
  await item.closeSubmenu();
  assert.equal(submenu.hidden, false);
  assert.deepEqual(calls, ["close", "hide", "show popover", "data-visible="]);
});

test("a submenu that stays closed, whose menu closed, or that left the page stays hidden", async () => {
  const closed = submenuItem({ open: false });
  await closed.item.closeSubmenu();
  assert.equal(closed.submenu.hidden, true);
  assert.deepEqual(closed.calls, ["close", "hide"]);
  const dismissed = submenuItem({ open: true, menu: false });
  await dismissed.item.closeSubmenu();
  assert.equal(dismissed.submenu.hidden, true);
  assert.deepEqual(dismissed.calls, ["close", "hide"]);
  const detached = submenuItem({ open: true, connected: false });
  await detached.item.closeSubmenu();
  assert.equal(detached.submenu.hidden, true);
  assert.deepEqual(detached.calls, ["close", "hide"]);
});
