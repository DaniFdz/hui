// Accessibility adapters from OpenClaw v2026.9.5 (MIT), a focus fix for a dropdown closed while it opens, and a fix
// for a submenu closed while it reopens.
// Component registration is browser-only in main.ts; view tests stay DOM-free.
type UpdatedElement = HTMLElement & { updateComplete: Promise<unknown> };
type Submenu = { hidden: boolean; isConnected: boolean; showPopover?: () => void; setAttribute(name: string, value: string): void };
type SubmenuItem = { submenuOpen: boolean; submenuElement?: Submenu | null; closest(selector: string): { open?: boolean } | null; closeSubmenu(): Promise<void> };

export function syncTabGroupLabel(element: Element | undefined, label: string) {
  if (element?.localName !== "wa-tab-group") return;
  void (element as UpdatedElement).updateComplete.then(() => {
    if (element.isConnected) {
      element.shadowRoot?.querySelector('[role="tablist"]')?.setAttribute("aria-label", label);
    }
  });
}

export function labelDropdown(event: Event) {
  const dropdown = event.currentTarget as UpdatedElement;
  const label = dropdown.getAttribute("aria-label")
    ?? dropdown.querySelector('[slot="trigger"]')?.getAttribute("aria-label");
  if (label) {
    const menu = dropdown.shadowRoot?.querySelector('[part="menu"]');
    menu?.setAttribute("aria-label", label);
    menu?.removeAttribute("aria-labelledby");
  }
}

/**
 * WA popups handle Escape on document, after enclosing view handlers run.
 *
 * A select or dropdown closes itself only when the press comes from inside it, so its own path says so. An open
 * `wa-popover` counts from anywhere in the page: the chat header's Run status panel gives focus back to the composer
 * while it shows, so its Escape would otherwise reach the pane's Stop path and abort the turn the panel reports on. A
 * native dialog on top keeps the press for itself, as the command palette and every modal do. `scope` is injectable so
 * the DOM-free tests can hand it a document.
 */
export function hasOpenWebAwesomePopup(event: Event, scope: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  const inPath = event.composedPath().some((target) => {
    const element = target as Partial<HTMLElement> & { open?: boolean };
    return (element.localName === "wa-select" || element.localName === "wa-dropdown")
      && element.open === true;
  });
  if (inPath || !scope) return inPath;
  if (scope.querySelector("dialog[open]")) return false;
  return [...scope.querySelectorAll<Element & { open?: boolean }>("wa-popover")].some((popover) => popover.open === true);
}

/** A `wa-after-show` listener: Web Awesome 3.14 still finishes opening a dropdown that closed meanwhile, focusing the
 * closed menu's first item, which then hides and drops focus to the page
 * (https://github.com/shoelace-style/webawesome/issues/2882). */
export function returnFocusFromClosedMenu(event: Event) {
  const dropdown = event.composedPath()[0] as HTMLElement & { open?: boolean };
  if (dropdown.localName !== "wa-dropdown" || dropdown.open) return;
  dropdown.querySelector<HTMLElement>('[slot="trigger"]')?.focus();
}

/** A `wa-dropdown-item` whose submenu reopened while the previous close was still animating stays hidden, so it reads
 * as expanded with nothing in it (https://github.com/shoelace-style/webawesome/issues/2876). Web Awesome hides after
 * the close animation without asking whether it reopened meanwhile, so show it again when it did. Marks the prototype
 * before the app loads. */
export function keepReopenedSubmenuVisible(prototype: Pick<SubmenuItem, "closeSubmenu">) {
  const closeSubmenu = prototype.closeSubmenu;
  prototype.closeSubmenu = async function closeSubmenuUnlessReopened(this: SubmenuItem) {
    await closeSubmenu.call(this);
    const submenu = this.submenuElement;
    const menu = this.closest("wa-dropdown");
    if (!this.submenuOpen || menu?.open === false || !submenu?.isConnected) return;
    submenu.showPopover?.();
    submenu.hidden = false;
    submenu.setAttribute("data-visible", "");
  };
}

/** Dismiss the inner popup without also dismissing its modal sidebar. */
export function closeDropdownOnEscape(event: KeyboardEvent) {
  const dropdown = event.currentTarget as HTMLElement & { open: boolean };
  if (event.key !== "Escape" || !dropdown.open) return;
  event.preventDefault();
  event.stopPropagation();
  dropdown.open = false;
  dropdown.querySelector<HTMLElement>('[slot="trigger"]')?.focus();
}
