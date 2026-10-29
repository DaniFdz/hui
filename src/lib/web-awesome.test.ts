import assert from "node:assert/strict";
import { test } from "vitest";
import { closeDropdownOnEscape, hasOpenWebAwesomePopup, keepReopenedSubmenuVisible, returnFocusFromClosedMenu } from "./web-awesome.ts";

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

test("a dropdown that finishes opening after it closed hands focus back to its trigger, and open menus and other popups are left alone", () => {
  for (const [localName, open, expected] of [["wa-dropdown", false, ["focus trigger"]], ["wa-dropdown", true, []], ["wa-select", false, []]] as const) {
    const calls: string[] = [];
    const shown = { localName, open, querySelector: () => ({ focus: () => calls.push("focus trigger") }) };
    returnFocusFromClosedMenu({ composedPath: () => [shown, {}] } as unknown as Event);
    assert.deepEqual(calls, expected, `${localName}, open: ${open}`);
  }
});

test("Tab and arrow keys stay owned by Web Awesome", () => {
  for (const key of ["Tab", "ArrowUp", "ArrowDown", "Home", "End", "Enter"]) {
    const { event, popup, calls } = escapeEvent(key, true);
    closeDropdownOnEscape(event);
    assert.equal(popup.open, true);
    assert.deepEqual(calls, []);
  }
});

function submenuItem(options: { open: boolean; menu?: boolean; attached?: boolean }) {
  const calls: string[] = [];
  const submenu = {
    hidden: false,
    isConnected: options.attached ?? true,
    showPopover: () => calls.push("show popover"),
    setAttribute: (name: string, value: string) => calls.push(`${name}=${value}`),
  };
  const item = {
    submenuOpen: options.open,
    submenuElement: submenu,
    closest: () => ({ open: options.menu ?? true }),
    // Web Awesome marks the submenu closed at the call, then hides it once its close animation ends.
    closeSubmenu: async () => {
      calls.push("close");
      item.submenuOpen = false;
      await Promise.resolve();
      submenu.hidden = true;
      calls.push("hide");
    },
  };
  keepReopenedSubmenuVisible(item);
  return { item, submenu, calls };
}

test("a submenu that reopened during its close animation is shown again instead of staying hidden", async () => {
  const { item, submenu, calls } = submenuItem({ open: true });
  const closing = item.closeSubmenu();
  item.submenuOpen = true;
  await closing;
  assert.equal(submenu.hidden, false);
  assert.deepEqual(calls, ["close", "hide", "show popover", "data-visible="]);
});

test("a submenu that stayed closed, whose menu closed, or that left the page stays hidden", async () => {
  for (const [label, options] of [["still closed", { open: false }], ["menu closed", { open: true, menu: false }], ["detached", { open: true, attached: false }]] as const) {
    const { item, submenu, calls } = submenuItem(options);
    const closing = item.closeSubmenu();
    item.submenuOpen = options.open;
    await closing;
    assert.equal(submenu.hidden, true, label);
    assert.deepEqual(calls, ["close", "hide"], label);
  }
});
