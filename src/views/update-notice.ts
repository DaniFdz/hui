import { html, nothing } from "lit";
import { icons } from "../lib/icons.ts";
import type { ReleaseInfo } from "../lib/update-types.ts";

export function renderUpdateNotice(props: { release: ReleaseInfo | null; inert: boolean; onReview(): void; onDismiss(): void }) {
  if (!props.release) return nothing;
  return html`<aside class="hui-update-notice" aria-label="HUI update available" ?inert=${props.inert}>
    <span class="hui-update-notice__message" role="status">
      <span class="hui-update-notice__icon" aria-hidden="true">${icons.download}</span>
      <span>HUI <strong>${props.release.version}</strong> is available</span>
    </span>
    <button class="btn hui-update-notice__review" @click=${props.onReview}>Review update</button>
    <button class="hui-update-notice__dismiss" aria-label="Dismiss update notification" title="Dismiss until reload"
      @click=${props.onDismiss}>${icons.close}</button>
  </aside>`;
}
