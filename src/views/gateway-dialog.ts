/**
 * The Add/Edit gateway dialog, shared by the sidebar's gateway menu and Settings → Gateway. It draws what the
 * controller holds — a name, an address, whether that address is the gateway serving this page, and a probe or a
 * refusal — and reports every change back; the rules, the probe and the storage are in `lib/gateways/`.
 */
import { html, nothing } from "lit";
import type { GatewayDialogState } from "../lib/gateways/gateway-list.ts";
import { closeModal } from "../lib/modal-dialog.ts";

export type GatewayDialogProps = {
  dialog: GatewayDialogState;
  onName: (name: string) => void;
  onAddress: (address: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function renderGatewayDialog(props: GatewayDialogProps) {
  const { dialog } = props;
  const editing = dialog.mode === "edit";
  const current = dialog.addressFixed;
  const placeholder = current ? "Uses this machine's hostname" : "Uses the name the gateway reports";
  const description = current
    ? "This gateway serves this page, so its address is fixed. Its name is what every client that connects sees."
    : editing
      ? "Change the name this device shows for it, and the address it opens."
      : "Pick a name and an address. HUI asks the address to identify itself before adding it.";
  const close = (event: Event) => {
    const dialogElement = (event.currentTarget as HTMLElement).closest("dialog");
    if (dialogElement) closeModal(dialogElement);
    props.onClose();
  };
  return html`<dialog class="hui-modal-dialog gateway-dialog" aria-labelledby="gateway-dialog-title"
    aria-describedby="gateway-dialog-description"
    @cancel=${(event: Event) => {
      event.preventDefault();
      if (dialog.busy) return;
      closeModal(event.currentTarget as HTMLDialogElement);
      props.onClose();
    }}>
    <form class="exec-approval-card" aria-busy=${String(dialog.busy)} @submit=${(event: SubmitEvent) => {
      event.preventDefault();
      if (!dialog.busy) props.onSubmit();
    }}>
      <h2 class="exec-approval-title" id="gateway-dialog-title">${editing ? "Edit gateway" : "Add gateway"}</h2>
      <p class="exec-approval-sub" id="gateway-dialog-description">${description}</p>
      <label class="field input-dialog__field"><span>Name</span>
        <input class="settings-input" name="gatewayName" maxlength="60" autocomplete="off" spellcheck="false" autofocus
          placeholder=${placeholder} ?disabled=${dialog.busy} .value=${dialog.name}
          @input=${(event: Event) => props.onName((event.target as HTMLInputElement).value)} />
      </label>
      <label class="field input-dialog__field"><span>Address</span>
        <input class="settings-input" name="gatewayAddress" maxlength="300" autocomplete="off" spellcheck="false"
          inputmode="url" placeholder="http://192.168.1.4:8787" ?disabled=${dialog.busy || current}
          .value=${dialog.address}
          @input=${(event: Event) => props.onAddress((event.target as HTMLInputElement).value)} />
      </label>
      ${current ? html`<p class="exec-approval-sub">Its address is where this page came from: <code>${dialog.address}</code>.</p>` : nothing}
      ${dialog.error ? html`<p class="exec-approval-error" role="alert">${dialog.error}</p>` : nothing}
      <div class="exec-approval-actions">
        <button type="submit" class="btn primary" ?disabled=${dialog.busy}>
          ${dialog.busy ? (editing ? "Saving…" : "Checking…") : editing ? "Save changes" : "Add gateway"}
        </button>
        <button type="button" class="btn" ?disabled=${dialog.busy} @click=${close}>Cancel</button>
      </div>
    </form>
  </dialog>`;
}
