/**
 * The banner offering to finish this chat in the HUI desktop app. A bot link carries `?open=app`, and only macOS has
 * an app to hand off to; the button carries the `hui://` address macOS gives the installed app, because a browser only
 * launches another program after a click. Shares the update notice's anatomy and styling.
 */
import { html, nothing } from "lit";
import { icons } from "../lib/icons.ts";

export function renderAppLinkNotice(props: { href: string | undefined; dismissed: boolean; inert: boolean; onDismiss(): void }) {
  if (!props.href || props.dismissed) return nothing;
  return html`<aside class="hui-update-notice" ?inert=${props.inert}>
    <span class="hui-update-notice__message" role="status">
      <span class="hui-update-notice__icon" aria-hidden="true">${icons.externalLink}</span>
      <span>This chat is also in the HUI app.</span>
    </span>
    <a class="btn hui-update-notice__review" href=${props.href}>Open in HUI</a>
    <button class="hui-update-notice__dismiss" aria-label="Dismiss notification" @click=${props.onDismiss}>${icons.close}</button>
  </aside>`;
}
