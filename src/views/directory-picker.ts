/**
 * A working-directory field with a suggestion list, used wherever a session's directory is chosen. It owns the list's
 * open/close, keyboard and focus handling on the DOM; the value and the suggestions belong to the caller.
 */
import WaPopup from "@awesome.me/webawesome/dist/components/popup/popup.js";
import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { configureAnchoredPopup } from "../lib/anchored-overlay.ts";

function setDirectoryExpanded(input: HTMLInputElement, expanded: boolean) {
  input.setAttribute("aria-expanded", String(expanded));
  const popup = input.closest(".new-session-page__directory-picker")?.querySelector<WaPopup>("wa-popup");
  if (popup) popup.active = expanded;
}

function configureDirectoryPopup(element: Element | undefined) {
  if (!(element instanceof WaPopup)) return;
  // Lit's ref runs before a newly created popup is inserted beside its input.
  void element.updateComplete.then(() => {
    if (!element.isConnected) return;
    const input = element.parentElement?.querySelector("input");
    if (!input) return;
    configureAnchoredPopup(element, input, "bottom");
    element.sync = "width";
    element.active = input.getAttribute("aria-expanded") === "true";
  });
}

function openDirectorySuggestions(event: FocusEvent | InputEvent, onInput: (value: string) => void) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  setDirectoryExpanded(input, true);
  onInput(input.value);
}

function closeDirectorySuggestions(event: FocusEvent) {
  const picker = event.currentTarget;
  if (!(picker instanceof HTMLElement)) return;
  if (event.relatedTarget instanceof Node && picker.contains(event.relatedTarget)) return;
  const input = picker.querySelector("input");
  if (input) setDirectoryExpanded(input, false);
}

function onDirectoryKeydown(event: KeyboardEvent) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  const picker = input.closest(".new-session-page__directory-picker");
  if (event.key === "ArrowDown") {
    const first = picker?.querySelector<HTMLButtonElement>("[role=option]");
    if (first) {
      event.preventDefault();
      setDirectoryExpanded(input, true);
      first.focus();
    }
  } else if (event.key === "Escape" && input.getAttribute("aria-expanded") === "true") {
    event.preventDefault();
    event.stopPropagation();
    setDirectoryExpanded(input, false);
  }
}

function onOptionKeydown(event: KeyboardEvent) {
  const option = event.currentTarget as HTMLButtonElement;
  const picker = option.closest(".new-session-page__directory-picker");
  const input = picker?.querySelector<HTMLInputElement>("input");
  if (event.key === "Escape" && input) {
    event.preventDefault();
    event.stopPropagation();
    input.focus();
    setDirectoryExpanded(input, false);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = event.key === "ArrowDown" ? option.nextElementSibling : option.previousElementSibling;
    if (next instanceof HTMLButtonElement) next.focus();
    else if (event.key === "ArrowUp") input?.focus();
  }
}

function selectDirectory(event: MouseEvent, path: string, onInput: (value: string) => void) {
  const option = event.currentTarget;
  if (!(option instanceof HTMLButtonElement)) return;
  const picker = option.closest(".new-session-page__directory-picker");
  const input = picker?.querySelector<HTMLInputElement>("input");
  if (!input) return;
  input.value = path;
  setDirectoryExpanded(input, false);
  onInput(path);
  input.focus();
  setDirectoryExpanded(input, false);
}

export type DirectoryPickerProps = {
  id: string;
  label: string;
  value: string;
  suggestions: readonly string[];
  onInput: (value: string) => void;
  inputClass: string;
  required?: boolean;
  externalLabel?: boolean;
  /** Shown while empty; the launch form's empty value means the home directory. */
  placeholder?: string;
  /** A field inside a dialog offers completion as the user types, without opening on the dialog's autofocus. */
  openOnFocus?: boolean;
  /** A bot's directory cannot move while it works. */
  disabled?: boolean;
};

/** Shared themed directory completion for launch and group defaults. */
export function renderDirectoryPicker(props: DirectoryPickerProps) {
  return html`
  <div class="new-session-page__target-input new-session-page__directory-picker" @focusout=${closeDirectorySuggestions}>
    ${props.externalLabel ? nothing : html`<label class="sr-only" for=${props.id}>${props.label}</label>`}
    <input id=${props.id} name="cwd" class=${props.inputClass} type="text" role="combobox" ?required=${props.required} ?disabled=${props.disabled} spellcheck="false" autocomplete="off"
      aria-autocomplete="list" aria-controls=${`${props.id}-options`} aria-expanded="false" placeholder=${props.placeholder ?? "~/"}
      .value=${props.value}
      @focus=${(event: FocusEvent) => { if (props.openOnFocus !== false) openDirectorySuggestions(event, props.onInput); }}
      @input=${(event: InputEvent) => openDirectorySuggestions(event, props.onInput)}
      @keydown=${onDirectoryKeydown} />
    ${props.suggestions.length > 0 ? html`
      <wa-popup ${ref(configureDirectoryPopup)}>
      <div id=${`${props.id}-options`} class="new-session-page__directory-menu" role="listbox" aria-label=${props.label}>
        ${props.suggestions.map((path) => html`
          <button type="button" role="option" aria-selected="false"
            @keydown=${onOptionKeydown}
            @mousedown=${(event: MouseEvent) => event.preventDefault()}
            @click=${(event: MouseEvent) => selectDirectory(event, path, props.onInput)}>${path}</button>
        `)}
      </div>
      </wa-popup>
    ` : nothing}
  </div>
  `;
}
