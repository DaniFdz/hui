// Accessibility adapters from OpenClaw v2026.9.5 (MIT).
// Component registration is browser-only in main.ts; view tests stay DOM-free.
type UpdatedElement = HTMLElement & { updateComplete: Promise<unknown> };

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

/** Dismiss the inner popup without also dismissing its modal sidebar. */
export function closeDropdownOnEscape(event: KeyboardEvent) {
  const dropdown = event.currentTarget as HTMLElement & { open: boolean };
  if (event.key !== "Escape" || !dropdown.open) return;
  event.preventDefault();
  event.stopPropagation();
  dropdown.open = false;
  dropdown.querySelector<HTMLElement>('[slot="trigger"]')?.focus();
}
