/** Compact subagent route summaries and the shared Add/Edit modal. Only confirmed saves replace a stored route. */
import { html, nothing } from "lit";
import { property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { HuiElement } from "../../lit/hui-element.ts";
import { closeModal, ensureModal } from "../../lib/modal-dialog.ts";
import { routeNameIsValid, type Settings } from "../../lib/settings/settings.ts";
import { PI_THINKING_LEVELS } from "../../lib/thinking.ts";
import { renderPicker, type PickerParams } from "../../views/settings-picker.ts";

type Route = Settings["models"]["routes"][number];
type Editor = { kind: "add"; draft: Route } | { kind: "edit"; original: Route; draft: Route };

export class HuiSubagentRoutes extends HuiElement {
  @property({ attribute: false }) routes: readonly Route[] = [];
  @property({ attribute: false }) models: PickerParams["options"] = [];
  @property({ attribute: false }) primary = "";
  @property({ attribute: false }) onSave!: (route: Route, originalName?: string) => Promise<boolean>;
  @property({ attribute: false }) onRemove!: (name: string) => void;
  #editor: Editor | undefined;
  #pending = false;
  #error = "";

  override updated() {
    const dialog = this.querySelector("dialog");
    if (dialog) ensureModal(dialog);
  }

  #open(route?: Route) {
    if (route) this.#editor = { kind: "edit", original: route, draft: { ...route } };
    else {
      const model = this.models.find((option) => option.value === this.primary) ?? this.models[0];
      if (!model || this.routes.length >= 50) return;
      this.#editor = { kind: "add", draft: { name: "", description: "", model: model.value } };
    }
    this.#error = "";
    this.requestUpdate();
  }

  #close() {
    if (this.#pending) return;
    closeModal(this.querySelector("dialog") ?? undefined);
    this.#editor = undefined;
    this.#error = "";
    this.requestUpdate();
  }

  async #submit(event: SubmitEvent) {
    event.preventDefault();
    const editor = this.#editor;
    if (!editor || this.#pending) return;
    const { draft } = editor;
    const original = editor.kind === "edit" ? editor.original : undefined;
    const name = draft.name.trim();
    this.#error = !routeNameIsValid(name) ? "Use 1 to 40 letters, digits, underscores, dots or hyphens."
      : this.routes.some((route) => route.name !== original?.name && route.name === name) ? "That route name is already in use."
      : !original && this.routes.length >= 50 ? "You can add up to 50 routes."
      : !this.models.some((model) => model.value === draft.model) && draft.model !== original?.model ? "Choose an available model." : "";
    if (this.#error) {
      this.requestUpdate();
      this.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
      return;
    }
    this.#pending = true;
    this.requestUpdate();
    let saved = false;
    try {
      saved = await this.onSave({ ...draft, name }, original?.name);
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
    const editor = this.#editor;
    if (!editor) return nothing;
    const { draft } = editor;
    const editing = editor.kind === "edit";
    return html`<dialog class="hui-modal-dialog subagent-route-dialog" aria-labelledby="route-editor-title" aria-describedby="route-editor-description"
      @cancel=${(event: Event) => { event.preventDefault(); this.#close(); }}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          this.#close();
        }
      }}>
      <form class="exec-approval-card" aria-busy=${String(this.#pending)} @submit=${(event: SubmitEvent) => void this.#submit(event)}>
        <div class="exec-approval-title" id="route-editor-title">${editing ? "Edit route" : "Add route"}</div>
        <div class="exec-approval-sub" id="route-editor-description">${editing ? "Changes apply to new subagents after you save." : "Choose a name and model before adding a subagent route."}</div>
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
          <button type="submit" class="btn primary" ?disabled=${this.#pending}>${this.#pending ? "Saving…" : editing ? "Save changes" : "Add route"}</button>
          <button type="button" class="btn" ?disabled=${this.#pending} @click=${() => this.#close()}>Cancel</button>
        </div>
      </form>
    </dialog>`;
  }

  override render() {
    return html`<section class="settings-section">
      <div class="settings-section__header"><div class="settings-section__copy">
        <h2 class="settings-section__heading">Subagent routes</h2>
        <p class="settings-section__desc">Named models for subagents. An agent passes a name to <code>sessions_spawn</code> as <code>route</code>; the prompt lists your names and descriptions.</p>
      </div><div class="settings-section__actions">
        <button type="button" class="btn btn--sm" ?disabled=${!this.models.length || this.routes.length >= 50} @click=${() => this.#open()}>Add route</button>
      </div></div>
      <div class="settings-group">
        ${this.routes.length ? this.routes.map((route) => html`<div class="settings-row" role="group" aria-label=${`Route ${route.name}`}>
          <div class="settings-row__text">
            <span class="settings-row__title">${route.name}</span>
            ${route.description ? html`<span class="settings-row__desc">${route.description}</span>` : nothing}
            <span class="settings-row__desc">${this.models.find((model) => model.value === route.model)?.label ?? route.model} · ${route.thinking ?? "Inherit parent"}</span>
          </div>
          <div class="settings-row__control">
            <button type="button" class="btn btn--sm" aria-label=${`Edit route ${route.name}`} @click=${() => this.#open(route)}>Edit</button>
            <button type="button" class="btn btn--sm btn--ghost" aria-label=${`Remove route ${route.name}`} @click=${() => this.onRemove(route.name)}>Remove</button>
          </div>
        </div>`) : html`<div class="settings-row"><div class="settings-row__text">
          <span class="settings-row__title">No routes yet</span>
          <span class="settings-row__desc">${this.models.length ? "Agents keep choosing models by id until you add one." : "Connect a provider first: a route needs a model."}</span>
        </div></div>`}
      </div>
    </section>${this.#dialog()}`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-subagent-routes")) customElements.define("hui-subagent-routes", HuiSubagentRoutes);
