import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionMenuAction, sessionMenuShortcuts } from "./menu-shortcuts.ts";

const key = (value: string) => ({ key: value, ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false });

test("displayed session menu mnemonics map to actions, in either case", () => {
  for (const [letter, action] of [["p", "pin"], ["r", "rename"], ["u", "unread"], ["a", "archive"], ["d", "delete"]]) {
    assert.equal(sessionMenuAction(key(letter!)), action);
    assert.equal(sessionMenuAction(key(letter!.toUpperCase())), action);
  }
  for (const value of ["ArrowDown", "Enter", "Tab", "Escape", "x"]) assert.equal(sessionMenuAction(key(value)), undefined);
});

test("modified, composing and repeated keys do not activate menu actions", () => {
  for (const flag of ["ctrlKey", "metaKey", "altKey", "repeat", "isComposing"]) {
    assert.equal(sessionMenuAction({ ...key("a"), [flag]: true }), undefined);
  }
});

function menu(options: { open?: boolean; disabled?: boolean; path?: unknown[] } = {}) {
  let clicks = 0;
  let prevented = 0;
  let stopped = 0;
  const dropdown = { open: options.open ?? true, querySelector: (selector: string) => {
    assert.equal(selector, ':scope > wa-dropdown-item[value="archive"]');
    return { disabled: options.disabled, click: () => clicks++ };
  } };
  return {
    dropdown,
    send: (type: string) => sessionMenuShortcuts.handleEvent({ type, currentTarget: dropdown } as unknown as Event),
    press: () => sessionMenuShortcuts.handleEvent({
      ...key("a"),
      type: "keydown",
      currentTarget: dropdown,
      composedPath: () => options.path ?? [],
      preventDefault: () => prevented++,
      stopImmediatePropagation: () => stopped++,
    } as unknown as KeyboardEvent),
    result: () => ({ clicks, prevented, stopped }),
  };
}

test("the capture handler activates the item once and prevents typeahead", () => {
  const opened = menu();
  assert.equal(sessionMenuShortcuts.capture, true);
  opened.send("wa-after-show");
  opened.press();
  assert.deepEqual(opened.result(), { clicks: 1, prevented: 1, stopped: 1 });
});

test("a key pressed while the menu opens runs its item once the menu is open, and not after it closed", () => {
  const opening = menu();
  opening.press();
  assert.deepEqual(opening.result(), { clicks: 0, prevented: 1, stopped: 1 });
  opening.send("wa-after-show");
  assert.deepEqual(opening.result(), { clicks: 1, prevented: 1, stopped: 1 });

  const reopenedWhileClosing = menu();
  reopenedWhileClosing.send("wa-hide");
  reopenedWhileClosing.press();
  reopenedWhileClosing.send("wa-after-hide");
  assert.equal(reopenedWhileClosing.result().clicks, 1);

  const closedFirst = menu();
  closedFirst.press();
  closedFirst.send("wa-hide");
  closedFirst.send("wa-after-show");
  assert.equal(closedFirst.result().clicks, 0);

  for (const type of ["wa-after-show", "wa-after-hide"]) {
    const shownAfterClosing = menu({ open: false });
    shownAfterClosing.send(type);
    shownAfterClosing.dropdown.open = true;
    shownAfterClosing.press();
    assert.equal(shownAfterClosing.result().clicks, 0);
  }
});

test("closed menus, disabled actions, text entry and submenus keep their native keys", () => {
  for (const options of [
    { open: false }, { disabled: true }, { path: [{ localName: "input" }] },
    { path: [{ isContentEditable: true }] },
    { path: [{ getAttribute: (name: string) => name === "slot" ? "submenu" : null }] },
  ]) {
    const fixture = menu(options);
    fixture.send("wa-after-show");
    fixture.press();
    assert.deepEqual(fixture.result(), { clicks: 0, prevented: 0, stopped: 0 });
  }
});
