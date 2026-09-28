import { html, nothing } from "lit";
import { icons } from "../lib/icons.ts";
import type { LocalPathSuggestion } from "../lib/local-paths.ts";

export type LocalPathMenuProps = {
  id?: string;
  open: boolean;
  paths: readonly LocalPathSuggestion[];
  activeIndex: number;
  loading: boolean;
  error: string;
  onSelect: (path: LocalPathSuggestion) => void;
  onRetry: () => void;
};

export const LOCAL_PATH_MENU_ID = "composer-local-paths";
export const localPathOptionId = (index: number, menuId = LOCAL_PATH_MENU_ID) => `${menuId}-${index}`;

export function renderLocalPathMenu(props: LocalPathMenuProps) {
  if (!props.open) return nothing;
  const menuId = props.id ?? LOCAL_PATH_MENU_ID;
  return html`
    <div class="slash-menu mention-menu">
      <div class="slash-menu__scroll">
        ${props.loading ? html`<div class="slash-menu__status" role="status">Loading local paths…</div>` : nothing}
        ${props.error ? html`<div class="slash-menu__status" role="alert">${props.error}
          <button type="button" class="btn btn--sm" @click=${props.onRetry}>Retry paths</button>
        </div>` : nothing}
        ${!props.loading && !props.error && !props.paths.length
          ? html`<div class="slash-menu__status" role="status">No matching local paths.</div>`
          : nothing}
        <div id=${menuId} role="listbox" aria-label="Local paths" aria-busy=${String(props.loading)}>
          ${props.paths.map((path, index) => html`
            <button type="button" role="option" tabindex="-1" id=${localPathOptionId(index, menuId)}
              class="slash-menu-item ${index === props.activeIndex ? "slash-menu-item--active" : ""}"
              aria-selected=${String(index === props.activeIndex)}
              @pointerdown=${(event: PointerEvent) => event.preventDefault()}
              @click=${() => props.onSelect(path)}>
              <span class="slash-menu-icon" aria-hidden="true">${path.kind === "directory" ? icons.folder : icons.fileText}</span>
              <span class="slash-menu-copy"><span class="slash-menu-name">${path.path}</span><span class="slash-menu-desc">${path.kind}</span></span>
            </button>`)}
        </div>
      </div>
    </div>`;
}
