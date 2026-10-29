/**
 * Single-key mnemonics for a session's dropdown menu (pin, rename, unread, archive, delete). They run the
 * matching item instead of Web Awesome's typeahead and stay out of text fields and submenus. A key pressed while
 * the menu is still opening runs its item once the menu has opened: Web Awesome focuses the first item when its
 * open animation ends, which would otherwise take focus from whatever the action just opened, such as the rename
 * field.
 */
import { closeDropdownOnEscape } from "../web-awesome.ts";

/** Menu mnemonics are actions, not Web Awesome typeahead navigation. */
const ACTIONS: Readonly<Record<string, string>> = { p: "pin", r: "rename", u: "unread", a: "archive", d: "delete" };

type ShortcutInput = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "isComposing">;
type Dropdown = HTMLElement & { open: boolean };

const opened = new WeakSet<Dropdown>();
const pending = new WeakMap<Dropdown, HTMLElement>();

export function sessionMenuAction(event: ShortcutInput): string | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing) return undefined;
  return ACTIONS[event.key.toLowerCase()];
}

/**
 * Listens on the dropdown for `keydown`, `wa-hide`, `wa-after-show` and `wa-after-hide`: a menu reopened while it was
 * still closing shows again without `wa-after-show`. Capture runs before its typeahead handler.
 */
export const sessionMenuShortcuts = {
  capture: true,
  handleEvent(event: Event): void {
    const dropdown = event.currentTarget as Dropdown;
    if (event.type === "wa-hide") {
      opened.delete(dropdown);
      pending.delete(dropdown);
      return;
    }
    if (event.type === "wa-after-show" || event.type === "wa-after-hide") {
      if (!dropdown.open) return;
      opened.add(dropdown);
      pending.get(dropdown)?.click();
      pending.delete(dropdown);
      return;
    }
    if (!dropdown.open) return;
    const keydown = event as KeyboardEvent;
    if (keydown.key === "Escape") { closeDropdownOnEscape(keydown); return; }
    const action = sessionMenuAction(keydown);
    if (!action) return;
    const path = event.composedPath();
    if (path.some((target) => {
      const element = target as Partial<HTMLElement>;
      return element.isContentEditable || ["input", "textarea", "select"].includes(element.localName ?? "")
        || element.getAttribute?.("slot") === "submenu";
    })) return;
    const item = dropdown.querySelector<HTMLElement & { disabled?: boolean }>(`:scope > wa-dropdown-item[value="${action}"]`);
    if (!item || item.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Use the existing selection path, including focus return and menu closing.
    if (opened.has(dropdown)) item.click();
    else pending.set(dropdown, item);
  },
};
