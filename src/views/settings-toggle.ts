// OpenClaw v2026.9.5 settings-ui.ts control slot (MIT).
import { html } from "lit";
import { live } from "lit/directives/live.js";

export function renderSettingsToggle(label: string, checked: boolean, onChange: (checked: boolean) => void, disabled = false) {
  return html`<wa-switch class="settings-toggle" size="s" .checked=${live(checked)} ?disabled=${disabled}
    @change=${(event: Event) => onChange((event.currentTarget as HTMLElement & { checked: boolean }).checked)}>
    <span class="settings-control__sr-label">${label}</span>
  </wa-switch>`;
}
