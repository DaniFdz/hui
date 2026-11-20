/**
 * The page's own way out of a gateway that cannot be reached. index.html's boot screen is all there is until the app
 * paints; when that has not happened after six seconds and the gateway serving this page does not answer, this module
 * turns that screen into a recovery card: what happened, this page's address, Retry, every other gateway this device
 * saved, and Add a gateway. It is a second entry point beside `main.ts`, so it keeps running when the app's own code
 * never arrives, and it is why the boot screen no longer pretends to load forever on the web, in HUI's desktop window
 * and in a phone's WebView.
 *
 * It imports nothing from the app — no Lit, no styles, no controllers, no `main.ts`, and none of `src/api/request.ts`,
 * whose boundary reports browser errors and checks the offline build — only the pure gateway rules, the report to HUI's
 * desktop shell, and the two probes in `api/boot-health.ts`. The card's DOM is built only when it is needed, so the
 * normal and slow boot screens stay exactly as they were.
 */
import { probeBootGateway, probeBootHealth } from "./api/boot-health.ts";
import { switchGateway } from "./lib/gateways/desktop-gateways.ts";
import { nativeShell } from "./lib/native-shell.ts";
import {
  GATEWAY_LIST_KEY,
  addGateway,
  normalizeGatewayAddress,
  readGatewayHandoff,
  readGatewayList,
  writeGatewayList,
  type GatewayEntry,
} from "./lib/gateways/gateway-list.ts";
import {
  RECOVERY_DEADLINE_MS,
  RECOVERY_PROBE_AT_MS,
  recoveryAddError,
  recoveryGateways,
  recoveryHeadline,
  recoveryRefusal,
  recoveryStage,
  recoverySwitchAddress,
  type RecoveryGateway,
  type RecoveryProbe,
} from "./lib/gateways/recovery.ts";

const BOOT_ID = "hui-boot";

/** The card as it is drawn; every piece is built once, when the page first needs it. */
type BootRecoveryCard = {
  section: HTMLElement;
  title: HTMLElement;
  origin: HTMLElement;
  alert: HTMLElement;
  retry: HTMLButtonElement;
  list: HTMLElement;
  empty: HTMLElement;
  form: HTMLFormElement;
  formError: HTMLElement;
  name: HTMLInputElement;
  address: HTMLInputElement;
  submit: HTMLButtonElement;
};

/** This page's gateway as an address a handoff can carry, exactly as the saved list holds one. */
function currentOrigin(): string {
  const origin = globalThis.location?.origin ?? "";
  return normalizeGatewayAddress(origin) ?? origin;
}

/** The saved rows, or none when this browser refuses its own storage (private mode, a full quota). */
function savedGateways(): GatewayEntry[] {
  try {
    return readGatewayList(localStorage.getItem(GATEWAY_LIST_KEY));
  } catch {
    return [];
  }
}

/** The rows a switch carried to this page in its address fragment. */
function carriedGateways(): GatewayEntry[] {
  try {
    return readGatewayHandoff(location.hash);
  } catch {
    return [];
  }
}

/** An alert paragraph: empty text shows nothing, and new text is what a screen reader announces. */
function setAlert(element: HTMLElement, message: string): void {
  element.textContent = message;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  if (text) created.textContent = text;
  return created;
}

/** A gateway's address as a row reads it: its host, and the path it is served under when it has one. */
function gatewayAddressLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return url;
  }
}

function buildCard(boot: HTMLElement, origin: string, onRetry: () => void, onSubmit: (event: SubmitEvent) => void): BootRecoveryCard {
  const section = element("section", "hui-boot__recovery");
  section.setAttribute("aria-labelledby", "hui-boot-recovery-title");
  const title = element("h1", "hui-boot__recovery-title");
  title.id = "hui-boot-recovery-title";
  title.tabIndex = -1;
  const detail = element("p", "hui-boot__recovery-detail", "Check that it is running, or open another gateway.");
  const originLine = element("p", "hui-boot__recovery-origin", origin);
  const alert = element("p", "hui-boot__recovery-error");
  alert.setAttribute("role", "alert");
  const retry = element("button", "hui-boot__recovery-retry", "Retry");
  retry.type = "button";
  retry.addEventListener("click", onRetry);

  const list = element("div", "hui-boot__recovery-list");
  list.append(element("h2", "hui-boot__recovery-list-title", "Other gateways"));
  const rows = element("ul", "hui-boot__recovery-gateways");
  const empty = element("p", "hui-boot__recovery-empty", "No other gateways are saved on this device.");
  list.append(rows, empty);

  const add = element("details", "hui-boot__recovery-add");
  add.append(element("summary", "hui-boot__recovery-add-summary", "Add a gateway"));
  const form = element("form", "hui-boot__recovery-form");
  const name = element("input", "hui-boot__recovery-input");
  name.type = "text";
  name.name = "name";
  name.maxLength = 60;
  name.autocomplete = "off";
  const address = element("input", "hui-boot__recovery-input");
  address.type = "text";
  address.name = "address";
  address.autocomplete = "off";
  address.spellcheck = false;
  const label = (text: string, input: HTMLInputElement) => {
    const wrapper = element("label", "hui-boot__recovery-field");
    wrapper.append(element("span", "hui-boot__recovery-label", text), input);
    return wrapper;
  };
  const formError = element("p", "hui-boot__recovery-form-error");
  formError.setAttribute("role", "alert");
  const submit = element("button", "hui-boot__recovery-submit", "Add and switch");
  submit.type = "submit";
  form.append(label("Name", name), label("Address", address), formError, submit);
  form.addEventListener("submit", (event) => onSubmit(event as SubmitEvent));
  add.append(form);

  section.append(title, detail, originLine, alert, retry, list, add);
  boot.append(section);

  return {
    section,
    title,
    origin: originLine,
    alert,
    retry,
    list: rows,
    empty,
    form,
    formError,
    name,
    address,
    submit,
  };
}

function install(): void {
  const boot = document.getElementById(BOOT_ID);
  if (!boot) return;
  const startedAt = Date.now();
  const origin = currentOrigin();
  let probeState: RecoveryProbe = "pending";
  let card: BootRecoveryCard | undefined;
  let shown = false;
  let stopped = false;
  let reloading = false;
  let switching = false;
  let adding = false;
  let retrying = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (ms: number, run: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };

  /** The app painted, so its own boot element is gone and nothing here has anything left to do. */
  const stop = (): void => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  const alive = (): boolean => {
    if (stopped || !boot.isConnected) {
      stop();
      return false;
    }
    return true;
  };

  /** Loads this page again, once: a gateway that answers is worth one reload, never a loop of them. */
  const reload = (): void => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };

  const showCard = (): BootRecoveryCard | undefined => {
    if (!alive()) return undefined;
    if (!card) {
      const built = buildCard(boot, origin, () => void retry(), (event) => void addGatewayAndSwitch(event));
      card = built;
      renderGateways(built, recoveryGateways(savedGateways(), carriedGateways(), origin));
    }
    boot.dataset["state"] = "recovery";
    card.title.textContent = recoveryHeadline(probeState);
    if (!shown) {
      shown = true;
      card.title.focus();
    }
    return card;
  };

  /** Rows are built here, never from interpolated HTML: a name is this device's own text. */
  const renderGateways = (built: BootRecoveryCard, rows: readonly RecoveryGateway[]): void => {
    built.list.replaceChildren(...rows.map((row) => {
      const item = element("li", "hui-boot__recovery-gateway");
      const name = element("span", "hui-boot__recovery-name", row.name);
      const host = element("span", "hui-boot__recovery-host", gatewayAddressLabel(row.url));
      const choose = element("button", "hui-boot__recovery-switch", "Switch");
      choose.type = "button";
      choose.setAttribute("aria-label", `Switch to ${row.name}`);
      choose.addEventListener("click", () => void switchTo(row.url));
      item.append(name, host, choose);
      return item;
    }));
    built.empty.hidden = rows.length > 0;
  };

  /**
   * Opens `url` in this page, carrying this device's rows so the gateway left stays one tap away. A phone's WebView
   * rebuilds its native bridge through its own shell instead: navigating it to another origin would hand the page to
   * the external browser. HUI's desktop window keeps its window, as every other switch does.
   */
  const switchTo = async (url: string, saved = savedGateways()): Promise<void> => {
    if (switching) return;
    switching = true;
    const shell = nativeShell();
    if (shell) {
      try {
        await shell.connectGateway(url);
      } catch (error) {
        switching = false;
        if (card && alive()) setAlert(card.alert, error instanceof Error ? error.message : "Could not switch gateways.");
      }
      return;
    }
    switchGateway(recoverySwitchAddress(url, { url: origin, name: "" }, saved), (target) => location.assign(target));
  };

  const probeHealth = async (): Promise<void> => {
    if (!alive()) return;
    const reachable = await probeBootHealth();
    if (!alive()) return;
    probeState = reachable ? "reachable" : "unreachable";
    if (shown) {
      if (card) card.title.textContent = recoveryHeadline(probeState);
      return;
    }
    if (recoveryStage(Date.now() - startedAt, probeState) === "recovery") showCard();
  };

  /** Retry asks this page's gateway again: one reload when it answers, and the card stays with what it found when it does
   * not, so the next press is the person's. The card never navigates by itself (SPEC.md "Offline reading and connection
   * recovery"). */
  const retry = async (): Promise<void> => {
    const built = card;
    if (!built || retrying || reloading) return;
    retrying = true;
    built.retry.disabled = true;
    setAlert(built.alert, "");
    try {
      if (await probeBootHealth()) {
        reload();
        return;
      }
      if (!alive()) return;
      probeState = "unreachable";
      built.title.textContent = recoveryHeadline(probeState);
      setAlert(built.alert, "Still can't reach this gateway.");
    } finally {
      retrying = false;
      built.retry.disabled = false;
    }
  };

  const addGatewayAndSwitch = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const built = card;
    if (!built || adding) return;
    const typedName = built.name.value.trim().slice(0, 60);
    const saved = savedGateways();
    const error = recoveryAddError({
      address: built.address.value,
      current: origin,
      saved,
      pageProtocol: location.protocol,
    });
    if (error) {
      setAlert(built.formError, error);
      return;
    }
    const url = normalizeGatewayAddress(built.address.value);
    if (!url) return;
    adding = true;
    built.submit.disabled = true;
    setAlert(built.formError, "");
    try {
      const probe = await probeBootGateway(url);
      if (!alive()) return;
      const refusal = recoveryRefusal(probe, url);
      if (refusal) {
        setAlert(built.formError, refusal);
        return;
      }
      let next = saved;
      try {
        next = addGateway(saved, { url, name: typedName || (probe.ok ? probe.name : ""), lastSeen: Date.now() }, origin);
        localStorage.setItem(GATEWAY_LIST_KEY, writeGatewayList(next));
      } catch {
        // The address is valid and answered as HUI; the page it opens still gets the way back in its fragment.
      }
      await switchTo(url, next);
    } finally {
      adding = false;
      built.submit.disabled = false;
    }
  };

  later(RECOVERY_PROBE_AT_MS, () => void probeHealth());
  // Ten seconds without the app is the page's own deadline, whatever the probe is still doing.
  later(RECOVERY_DEADLINE_MS, () => showCard());
}

install();
