/** The Add route action and its unsaved modal form. Existing routes stay editable in the Models settings view. */
import { html, nothing } from "lit";
import { property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { HuiElement } from "../../lit/hui-element.ts";
import { closeModal, ensureModal } from "../../lib/modal-dialog.ts";
import { routeNameIsValid, type Settings } from "../../lib/settings/settings.ts";
import { PI_THINKING_LEVELS } from "../../lib/thinking.ts";
import { renderPicker, type PickerParams } from "../../views/settings-picker.ts";

type Route = Settings["models"]["routes"][number];

export class HuiAddSubagentRoute extends HuiElement {
  @property({ attribute: false }) routes: readonly Route[] = [];
  @property({ attribute: false }) models: PickerParams["options"] = [];
  @property({ attribute: false }) primary = "";
  @property({ attribute: false }) onAdd!: (route: Route) => Promise<boolean>;
  #draft: Route | undefined;
  #pending = false;
  #error = "";

  override updated() {
    const dialog = this.querySelector("dialog");
    if (dialog) ensureModal(dialog);
  }

  #open() {
    const model = this.models.find((option) => option.value === this.primary) ?? this.models[0];
    if (!model || this.routes.length >= 50) return;
    this.#draft = { name: "", description: "", model: model.value };
    this.#error = "";
    this.requestUpdate();
  }

  #close() {
    if (this.#pending) return;
    closeModal(this.querySelector("dialog") ?? undefined);
    this.#draft = undefined;
    this.#error = "";
    this.requestUpdate();
  }

  async #submit(event: SubmitEvent) {
    event.preventDefault();
    const draft = this.#draft;
    if (!draft || this.#pending) return;
    const name = draft.name.trim();
    this.#error = !routeNameIsValid(name) ? "Use 1 to 40 letters, digits, underscores, dots or hyphens."
      : this.routes.some((route) => route.name === name) ? "That route name is already in use."
      : this.routes.length >= 50 ? "You can add up to 50 routes."
      : !this.models.some((model) => model.value === draft.model) ? "Choose an available model." : "";
    if (this.#error) {
      this.requestUpdate();
      this.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
      return;
    }
    this.#pending = true;
    this.requestUpdate();
    let saved = false;
    try {
      saved = await this.onAdd({ ...draft, name });
    } catch {
      saved = false;
    }
    this.#pending = false;
    if (saved) this.#close();
    else {
      this.#error = "Could not save the route. Try again.";
      this.requestUpdate();
    }
  }

  #dialog() {
    const draft = this.#draft;
    if (!draft) return nothing;
    return html`<dialog class="hui-modal-dialog subagent-route-dialog" aria-labelledby="add-route-title" aria-describedby="add-route-description"
      @cancel=${(event: Event) => { event.preventDefault(); this.#close(); }}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          this.#close();
        }
      }}>
      <form class="exec-approval-card" aria-busy=${String(this.#pending)} @submit=${(event: SubmitEvent) => void this.#submit(event)}>
        <div class="exec-approval-title" id="add-route-title">Add route</div>
        <div class="exec-approval-sub" id="add-route-description">Choose a name and model before adding a subagent route.</div>
        <label class="field input-dialog__field"><span>Name</span>
          <input class="settings-input" name="name" required maxlength="40" autocomplete="off" spellcheck="false" autofocus
            placeholder="e.g. fast or deep" ?disabled=${this.#pending} .value=${live(draft.name)}
            @input=${(event: Event) => {
              if (event.currentTarget instanceof HTMLInputElement) draft.name = event.currentTarget.value;
              this.#error = "";
              this.requestUpdate();
            }} /></label>
        <label class="field input-dialog__field"><span>Description</span>
          <input class="settings-input" name="description" maxlength="200" placeholder="When should an agent use this route?"
            ?disabled=${this.#pending} .value=${live(draft.description)}
            @input=${(event: Event) => { if (event.currentTarget instanceof HTMLInputElement) draft.description = event.currentTarget.value; }} /></label>
        <div class="field input-dialog__field"><span>Model</span>
          ${renderPicker({ label: "Model", value: draft.model, options: this.models, searchable: true, disabled: this.#pending,
            onChange: (model) => { draft.model = model; this.requestUpdate(); } })}</div>
        <div class="field input-dialog__field"><span>Thinking</span>
          ${renderPicker({ label: "Thinking", value: draft.thinking ?? "", disabled: this.#pending,
            options: [{ value: "", label: "Inherit parent" }, ...PI_THINKING_LEVELS.map((level) => ({ value: level, label: level }))],
            onChange: (value) => { draft.thinking = PI_THINKING_LEVELS.find((level) => level === value); this.requestUpdate(); } })}</div>
        ${this.#error ? html`<p class="exec-approval-error" role="alert">${this.#error}</p>` : nothing}
        <div class="exec-approval-actions">
          <button type="submit" class="btn primary" ?disabled=${this.#pending}>${this.#pending ? "Adding…" : "Add route"}</button>
          <button type="button" class="btn" ?disabled=${this.#pending} @click=${() => this.#close()}>Cancel</button>
        </div>
      </form>
    </dialog>`;
  }

  override render() {
    return html`<button type="button" class="btn btn--sm" ?disabled=${!this.models.length || this.routes.length >= 50}
      @click=${() => this.#open()}>Add route</button>${this.#dialog()}`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-add-subagent-route")) customElements.define("hui-add-subagent-route", HuiAddSubagentRoute);
