/**
 * `GatewaysController` owns this device's gateway list for the page: the saved entries, the current gateway's own name
 * from its health route, which saved gateways this page could not reach, and the add field's probe. Settings → Gateway
 * and the sidebar's footer both read it, and switching navigates this page to the chosen address. The rules and the
 * storage are in `lib/gateways/`; this controller only sequences them and reports what to show.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { loadGatewayHealth } from "../api/control-surfaces.ts";
import { probeGateway } from "../api/gateways.ts";
import {
  GATEWAY_IS_CURRENT,
  GATEWAY_NOT_AN_ADDRESS,
  GATEWAY_REFUSED,
  gatewayViews,
  normalizeGatewayAddress,
  type GatewayAddState,
  type GatewayView,
} from "../lib/gateways/gateway-list.ts";
import { GatewayStore } from "../lib/gateways/gateway-store.ts";

const IDLE_ADD: GatewayAddState = { address: "", busy: false, error: "" };

export class GatewaysController implements ReactiveController {
  readonly store: GatewayStore;
  /** What this page's gateway calls itself, until its Settings health poll reports a newer name. */
  currentName = "";
  addState: GatewayAddState = IDLE_ADD;
  readonly #host: ReactiveControllerHost;
  readonly #offline = new Set<string>();
  readonly #unsubscribe: () => void;
  #checking = false;

  constructor(host: ReactiveControllerHost, store = new GatewayStore()) {
    this.#host = host;
    this.store = store;
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

  /** The add field's own text, kept here so a refusal leaves the address in place to correct. */
  setAddress(address: string): void {
    this.addState = { address, busy: this.addState.busy, error: this.addState.address === address ? this.addState.error : "" };
    this.#changed();
  }

  addGateway = async (): Promise<void> => {
    const address = this.addState.address.trim();
    if (this.addState.busy) return;
    const url = normalizeGatewayAddress(address);
    if (!url) {
      this.addState = { address, busy: false, error: GATEWAY_NOT_AN_ADDRESS };
      this.#changed();
      return;
    }
    if (url === this.store.current) {
      this.addState = { address, busy: false, error: GATEWAY_IS_CURRENT };
      this.#changed();
      return;
    }
    this.addState = { address, busy: true, error: "" };
    this.#changed();
    const answer = await probeGateway(url);
    if (!answer.ok) {
      this.addState = { address, busy: false, error: GATEWAY_REFUSED };
      this.#changed();
      return;
    }
    this.store.add(url, answer.name);
    this.#offline.delete(url);
    this.addState = IDLE_ADD;
    this.#changed();
  };

  /** Tries a gateway this page could not reach, and records the sighting when it answers. */
  retry = async (url: string): Promise<void> => {
    const answer = await probeGateway(url);
    if (!answer.ok) {
      this.#offline.add(url);
      this.#changed();
      return;
    }
    this.#offline.delete(url);
    this.store.markSeen(url, answer.name);
    this.#changed();
  };

  /** Probes every saved gateway once, when Settings → Gateway opens: an unreachable one reads as offline with Retry. */
  checkKnown = async (): Promise<void> => {
    if (this.#checking) return;
    this.#checking = true;
    try {
      await Promise.all(this.store.list().map(async (entry) => {
        const answer = await probeGateway(entry.url);
        if (answer.ok) {
          this.#offline.delete(entry.url);
          this.store.markSeen(entry.url, answer.name);
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

  #changed(): void {
    this.#host.requestUpdate();
  }
}
