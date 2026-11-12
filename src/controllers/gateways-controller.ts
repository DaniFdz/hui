/**
 * `GatewaysController` owns this device's gateway list for the page: the saved entries, the current gateway's own name
 * from its health route, which saved gateways this page could not reach, and the Add/Edit dialog with its probe. The
 * sidebar's footer opens Add, Settings → Gateway opens both Add and Edit, and switching navigates this page to the
 * chosen address. The rules and the storage are in `lib/gateways/`; this controller only sequences them and reports
 * what to show.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { loadGatewayHealth } from "../api/control-surfaces.ts";
import { probeGateway, type GatewayProbe } from "../api/gateways.ts";
import {
  GATEWAY_ALREADY_SAVED,
  GATEWAY_IS_CURRENT,
  GATEWAY_NAME_UNSAVED,
  GATEWAY_NOT_AN_ADDRESS,
  GATEWAY_REFUSED,
  gatewayViews,
  normalizeGatewayAddress,
  type GatewayDialogState,
  type GatewayView,
} from "../lib/gateways/gateway-list.ts";
import { GatewayStore } from "../lib/gateways/gateway-store.ts";

/** Saves the name this gateway reports to every client; resolves false when the save did not land. */
export type SaveGatewayName = (name: string) => Promise<boolean>;

export type GatewaysControllerOptions = {
  saveCurrentName?: SaveGatewayName;
  /** The identity handshake, injected so the dialog can be tested without a second gateway. */
  probe?: (url: string) => Promise<GatewayProbe>;
  /** Closes the rendered dialog before its state is cleared, so the page leaves the top layer and focus returns. */
  closeRenderedDialog?: () => void;
};

export class GatewaysController implements ReactiveController {
  readonly store: GatewayStore;
  /** What this page's gateway calls itself, until its Settings health poll reports a newer name. */
  currentName = "";
  /** The Add/Edit dialog both surfaces draw; `null` while it is closed. */
  dialog: GatewayDialogState | null = null;
  readonly #host: ReactiveControllerHost;
  readonly #offline = new Set<string>();
  readonly #unsubscribe: () => void;
  readonly #saveCurrentName: SaveGatewayName | undefined;
  readonly #probe: (url: string) => Promise<GatewayProbe>;
  readonly #closeRenderedDialog: (() => void) | undefined;
  #checking = false;

  constructor(host: ReactiveControllerHost, store = new GatewayStore(), options: GatewaysControllerOptions = {}) {
    this.#host = host;
    this.store = store;
    this.#saveCurrentName = options.saveCurrentName;
    this.#probe = options.probe ?? probeGateway;
    this.#closeRenderedDialog = options.closeRenderedDialog;
    this.#unsubscribe = store.subscribe(() => this.#changed());
    host.addController(this);
  }

  hostConnected(): void {
    void this.loadCurrentName();
  }

  hostDisconnected(): void {
    this.#unsubscribe();
  }

  /** The list both surfaces draw: this gateway first, then the saved ones. */
  views(name = this.currentName): GatewayView[] {
    return gatewayViews(this.store.list(), { url: this.store.current, name }, this.#offline);
  }

  /** Reads the name this gateway reports, as About and Settings do. A failed read keeps the name already known. */
  async loadCurrentName(): Promise<void> {
    try {
      this.currentName = (await loadGatewayHealth()).name;
      this.#changed();
    } catch {
      // The page is already talking to this gateway; a name it could not read changes nothing.
    }
  }

  /** Opens the dialog to add a gateway by a name and an address. */
  openAddGateway = (): void => {
    this.dialog = { mode: "add", originalUrl: "", name: "", address: "", addressFixed: false, busy: false, error: "" };
    this.#changed();
  };

  /** Opens the dialog on one row: a saved gateway's name and address, or only this gateway's own name. */
  openEditGateway = (gateway: GatewayView): void => {
    this.dialog = {
      mode: "edit",
      originalUrl: gateway.url,
      name: gateway.name,
      address: gateway.url,
      addressFixed: gateway.state === "current",
      busy: false,
      error: "",
    };
    this.#changed();
  };

  /** The dialog's text, kept here so a refusal leaves the values in place to correct. */
  setDialogName(name: string): void {
    if (!this.dialog) return;
    this.dialog = { ...this.dialog, name, error: "" };
    this.#changed();
  }

  setDialogAddress(address: string): void {
    if (!this.dialog) return;
    this.dialog = { ...this.dialog, address, error: "" };
    this.#changed();
  }

  /** Closes the dialog, unless its save or probe is still running. */
  closeGatewayDialog = (): void => {
    if (this.dialog?.busy) return;
    this.dialog = null;
    this.#changed();
  };

  /**
   * Adds what the dialog holds, or saves an edit. The gateway serving this page keeps its address and only accepts a
   * new name; a saved gateway renamed without moving needs no handshake, and a new address has to answer as HUI first.
   */
  submitGatewayDialog = async (): Promise<void> => {
    const dialog = this.dialog;
    if (!dialog || dialog.busy) return;
    const name = dialog.name.trim().slice(0, 60);

    if (dialog.addressFixed) {
      this.dialog = { ...dialog, busy: true, error: "" };
      this.#changed();
      const saved = await this.#saveCurrentName?.(name);
      if (!this.dialog) return;
      if (!saved) {
        this.dialog = { ...this.dialog, busy: false, error: GATEWAY_NAME_UNSAVED };
        this.#changed();
        return;
      }
      this.#close();
      return;
    }

    const address = dialog.address.trim();
    const url = normalizeGatewayAddress(address);
    if (!url) return this.#refuse(dialog, address, GATEWAY_NOT_AN_ADDRESS);
    if (url === this.store.current) return this.#refuse(dialog, address, GATEWAY_IS_CURRENT);
    if (this.store.list().some((entry) => entry.url === url && entry.url !== dialog.originalUrl)) {
      return this.#refuse(dialog, address, GATEWAY_ALREADY_SAVED);
    }

    // A saved gateway renamed in place is about this device, not about whether the gateway is up right now.
    if (dialog.mode === "edit" && url === dialog.originalUrl) {
      this.store.edit(dialog.originalUrl, { url, name });
      this.#offline.delete(url);
      this.#close();
      return;
    }

    this.dialog = { ...dialog, address, busy: true, error: "" };
    this.#changed();
    const answer = await this.#probe(url);
    if (!this.dialog) return;
    if (!answer.ok) {
      this.dialog = { ...this.dialog, address, busy: false, error: GATEWAY_REFUSED };
      this.#changed();
      return;
    }
    if (dialog.mode === "edit") this.store.edit(dialog.originalUrl, { url, name: name || answer.name });
    else this.store.add(url, name || answer.name);
    this.#offline.delete(url);
    this.#close();
  };

  /** Tries a gateway this page could not reach, and records the sighting when it answers. Its saved name is this
   * device's own label, so a probe refreshes when it was reached, never what the gateway calls itself today. */
  retry = async (url: string): Promise<void> => {
    const answer = await this.#probe(url);
    if (!answer.ok) {
      this.#offline.add(url);
      this.#changed();
      return;
    }
    this.#offline.delete(url);
    this.store.markSeen(url);
    this.#changed();
  };

  /** Probes every saved gateway once, when Settings → Gateway opens: an unreachable one reads as offline with Retry. */
  checkKnown = async (): Promise<void> => {
    if (this.#checking) return;
    this.#checking = true;
    try {
      await Promise.all(this.store.list().map(async (entry) => {
        const answer = await this.#probe(entry.url);
        if (answer.ok) {
          this.#offline.delete(entry.url);
          this.store.markSeen(entry.url);
        } else {
          this.#offline.add(entry.url);
        }
      }));
      this.#changed();
    } finally {
      this.#checking = false;
    }
  };

  /** Forgets a saved gateway. The store never removes the one serving this page. */
  remove(url: string): void {
    this.#offline.delete(url);
    this.store.remove(url);
  }

  /** Switching opens the chosen gateway in this page: its own address, its own state. */
  switchTo(url: string): void {
    window.location.assign(url);
  }

  #refuse(dialog: GatewayDialogState, address: string, error: string): void {
    this.dialog = { ...dialog, address, busy: false, error };
    this.#changed();
  }

  /** Success: the rendered dialog leaves the top layer, then its state goes. */
  #close(): void {
    this.#closeRenderedDialog?.();
    this.dialog = null;
    this.#changed();
  }

  #changed(): void {
    this.#host.requestUpdate();
  }
}
