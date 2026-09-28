// Ported from OpenClaw 2026.9.5 (ec9c1a13), MIT. See README.md in this directory.
export function promoteToPopoverTopLayer(element: HTMLElement) {
  element.setAttribute("popover", "manual");
  if (typeof element.showPopover === "function") {
    try {
      element.showPopover();
      return;
    } catch {
      // Fall through to in-flow rendering when the top-layer API is unavailable.
    }
  }
  element.removeAttribute("popover");
}
