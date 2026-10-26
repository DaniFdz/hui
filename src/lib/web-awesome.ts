// Accessibility adapters from OpenClaw v2026.9.5 (MIT), and a fix for a submenu closed while it reopens.
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

/** WA selects handle Escape on document, after enclosing view handlers run. */
export function hasOpenWebAwesomePopup(event: Event): boolean {
  return event.composedPath().some((target) => {
    const element = target as Partial<HTMLElement> & { open?: boolean };
    return (element.localName === "wa-select" || element.localName === "wa-dropdown")
      && element.open === true;
  });
}

/** Web Awesome 3.14 finishes a submenu close that began before the submenu reopened, hiding it while the item still
 * reports it open, so the item expands with nothing in it and no choice can be made
 * (https://github.com/shoelace-style/webawesome/issues/2876). Show the submenu again when it reopened meanwhile. */
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
