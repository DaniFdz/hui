/**
 * HUI-styled tooltips for any element with `data-hui-tooltip`.
 *
 * One delegated controller, reusing the badge hovercard lifecycle: it opens on
 * pointer hover or keyboard focus, portals into the top layer so scrolling
 * table containers cannot clip it, and closes on leave, Escape or click. Touch
 * pointers never open it. Disabled buttons receive no pointer events, so wrap
 * them in an element that carries the attribute.
 */
import { html } from "lit";

import { BadgeHovercardController } from "./badge-hovercard.ts";

export const TOOLTIP_SELECTOR = "[data-hui-tooltip]";

let installed = false;
export function installTooltips(root: Document = document) {
  if (installed) return;
  installed = true;
  new BadgeHovercardController<string>({
    selector: TOOLTIP_SELECTOR,
    cardClass: "hui-tooltip",
    data: (anchor) => anchor.dataset["huiTooltip"] || undefined,
    render: (text) => html`${text}`,
  }).install(root);
}
