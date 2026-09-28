import { html, nothing } from "lit";

export function renderPaneMoveHandle(enabled: boolean | undefined) {
  return enabled ? html`<button type="button" class="btn btn--ghost btn--icon chat-icon-btn hui-pane-move-handle"
    draggable="true" aria-label="Move panel" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
    title="Drag to move panel. Arrow keys move beside nearby panels.">
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
      <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
      <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
    </svg>
  </button>` : nothing;
}
