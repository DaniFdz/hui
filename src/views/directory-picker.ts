import { html, nothing } from "lit";

function openDirectorySuggestions(event: FocusEvent | InputEvent, onInput: (value: string) => void) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  input.setAttribute("aria-expanded", "true");
  onInput(input.value);
}

function closeDirectorySuggestions(event: FocusEvent) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  const picker = input.closest(".new-session-page__directory-picker");
  if (event.relatedTarget instanceof Node && picker?.contains(event.relatedTarget)) return;
  input.setAttribute("aria-expanded", "false");
}

function onDirectoryKeydown(event: KeyboardEvent) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  const picker = input.closest(".new-session-page__directory-picker");
  if (event.key === "ArrowDown") {
    const first = picker?.querySelector<HTMLButtonElement>("[role=option]");
    if (first) {
      event.preventDefault();
      input.setAttribute("aria-expanded", "true");
      first.focus();
    }
  } else if (event.key === "Escape" && input.getAttribute("aria-expanded") === "true") {
    event.preventDefault();
    event.stopPropagation();
    input.setAttribute("aria-expanded", "false");
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
    input.setAttribute("aria-expanded", "false");
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
  input.setAttribute("aria-expanded", "false");
  onInput(path);
  input.focus();
  input.setAttribute("aria-expanded", "false");
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
};

/** Shared themed directory completion for launch and group defaults. */
export function renderDirectoryPicker(props: DirectoryPickerProps) {
  return html`
  <div class="new-session-page__target-input new-session-page__directory-picker">
    ${props.externalLabel ? nothing : html`<label class="sr-only" for=${props.id}>${props.label}</label>`}
    <input id=${props.id} name="cwd" class=${props.inputClass} type="text" role="combobox" ?required=${props.required} spellcheck="false" autocomplete="off"
      aria-autocomplete="list" aria-controls=${`${props.id}-options`} aria-expanded="false" placeholder="~/"
      .value=${props.value}
      @focus=${(event: FocusEvent) => openDirectorySuggestions(event, props.onInput)}
      @blur=${closeDirectorySuggestions}
      @input=${(event: InputEvent) => openDirectorySuggestions(event, props.onInput)}
      @keydown=${onDirectoryKeydown} />
    ${props.suggestions.length > 0 ? html`
      <div id=${`${props.id}-options`} class="new-session-page__directory-menu" role="listbox" aria-label=${props.label}>
        ${props.suggestions.map((path) => html`
          <button type="button" role="option" aria-selected="false"
            @keydown=${onOptionKeydown}
            @mousedown=${(event: MouseEvent) => event.preventDefault()}
            @click=${(event: MouseEvent) => selectDirectory(event, path, props.onInput)}>${path}</button>
        `)}
      </div>
    ` : nothing}
  </div>
  `;
}
