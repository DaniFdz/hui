/**
 * A gateway extension's panel inside the Work pane. The frame is sandboxed (an opaque origin with no network), so the
 * panel cannot call HUI itself: it asks this parent over `postMessage`, and the parent answers only calls to that
 * extension's own declared routes with the browser's `x-hui` session. Height, theme and an https link are the other
 * messages; everything else is ignored.
 */
import { html, nothing } from "lit";

import { callExtensionRoute, loadExtensions } from "../api/extensions.ts";
import type { ExtensionStatus } from "../api/schema/extensions.ts";
import {
  BRIDGE_CALL_TIMEOUT_MS, BRIDGE_CHANNEL, BRIDGE_MAX_IN_FLIGHT, BRIDGE_MAX_RESPONSE_BYTES, jsonBytes, parseBridgeCall,
} from "../lib/extensions/bridge.ts";
import { HuiElement } from "../lit/hui-element.ts";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 2000;

export class HuiExtensionPanel extends HuiElement {
  static override properties = {
    extensionId: { type: String },
    sessionId: { type: String },
    visible: { type: Boolean },
  };
  /** Empty opens the first enabled panel (the launcher's view); Settings passes one id. */
  declare extensionId: string;
  declare sessionId: string;
  declare visible: boolean;

  #extensions: ExtensionStatus[] = [];
  #selected = "";
  #loading = true;
  #error = "";
  #height = 360;
  #title = "";
  #inflight = new Map<number, AbortController>();
  #themeObserver?: MutationObserver;

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.#onMessage);
    void this.#load();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this.#onMessage);
    this.#themeObserver?.disconnect();
    for (const controller of this.#inflight.values()) controller.abort();
    this.#inflight.clear();
  }

  async #load() {
    try {
      const { extensions } = await loadExtensions();
      this.#extensions = extensions.filter((extension) => extension.panel);
      const wanted = this.#extensions.find((extension) => extension.id === this.extensionId);
      this.#selected = wanted?.id ?? this.#extensions.find((extension) => extension.state === "loaded")?.id ?? this.#extensions[0]?.id ?? "";
      this.#title = "";
      this.#error = "";
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "Extension panels could not be loaded.";
    }
    this.#loading = false;
    this.requestUpdate();
  }

  #extension(): ExtensionStatus | undefined {
    return this.#extensions.find((extension) => extension.id === this.#selected);
  }

  #frame(): HTMLIFrameElement | undefined {
    return this.querySelector("iframe[data-extension-frame]") ?? undefined;
  }

  #send(message: Record<string, unknown>) {
    // A sandboxed frame's origin is opaque: "null" would match no targetOrigin, so the channel name and the parent's
    // source check are what identify the conversation.
    this.#frame()?.contentWindow?.postMessage({ channel: BRIDGE_CHANNEL, ...message }, "*");
  }

  #theme() {
    const style = getComputedStyle(document.documentElement);
    return {
      mode: document.documentElement.dataset["themeMode"] ?? "",
      background: style.getPropertyValue("--panel").trim(),
      text: style.getPropertyValue("--text").trim(),
    };
  }

  #postInit() {
    const extension = this.#extension();
    if (!extension) return;
    this.#send({ type: "init", extensionId: extension.id, sessionId: this.sessionId, theme: this.#theme() });
    this.#themeObserver?.disconnect();
    this.#themeObserver = new MutationObserver(() => this.#send({ type: "theme", theme: this.#theme() }));
    this.#themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-mode", "style", "class"] });
  }

  #answer(message: Record<string, unknown>) {
    this.#send(message);
  }

  #onMessage = (event: MessageEvent) => {
    const frame = this.#frame();
    if (!frame || event.source !== frame.contentWindow) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data["channel"] !== BRIDGE_CHANNEL) return;
    if (data["type"] === "ready") { this.#postInit(); return; }
    if (data["type"] === "title" && typeof data["value"] === "string") {
      this.#title = (data["value"] as string).slice(0, 120);
      this.requestUpdate();
      return;
    }
    if (data["type"] === "height" && typeof data["value"] === "number" && Number.isFinite(data["value"])) {
      this.#height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(data["value"] as number)));
      this.requestUpdate();
      return;
    }
    if (data["type"] === "open" && typeof data["value"] === "string") {
      try {
        const url = new URL(data["value"] as string);
        if (url.protocol === "https:") window.open(url.href, "_blank", "noopener,noreferrer");
      } catch {
        // Not a URL: ignored, like any other unknown message.
      }
      return;
    }
    if (data["type"] === "call") void this.#call(data);
  };

  async #call(value: Record<string, unknown>) {
    const extension = this.#extension();
    if (!extension) return;
    const parsed = parseBridgeCall(value, extension.routes);
    if ("error" in parsed) {
      if (parsed.callId !== undefined) this.#answer({ type: "error", callId: parsed.callId, error: parsed.error });
      return;
    }
    const { call } = parsed;
    if (this.#inflight.size >= BRIDGE_MAX_IN_FLIGHT) {
      this.#answer({ type: "error", callId: call.callId, error: "too many calls" });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIDGE_CALL_TIMEOUT_MS);
    this.#inflight.set(call.callId, controller);
    try {
      const answer = await callExtensionRoute(extension.id, call.method, call.path, call.body, controller.signal);
      const bytes = jsonBytes(answer.body) ?? 0;
      if (bytes > BRIDGE_MAX_RESPONSE_BYTES) this.#answer({ type: "error", callId: call.callId, error: "response too large" });
      else this.#answer({ type: "result", callId: call.callId, status: answer.status, body: answer.body });
    } catch (error) {
      this.#answer({ type: "error", callId: call.callId, error: controller.signal.aborted ? "call timed out" : error instanceof Error ? error.message : "call failed" });
    } finally {
      clearTimeout(timer);
      this.#inflight.delete(call.callId);
    }
  }

  #src(extension: ExtensionStatus): string {
    const entry = extension.panel?.entry ?? "index.html";
    const path = entry.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    return `/__hui/ext-ui/${encodeURIComponent(extension.id)}/${path}`;
  }

  override render() {
    const extension = this.#extension();
    const loaded = extension?.state === "loaded";
    return html`<section class="extension-panel" data-extension-panel=${extension?.id ?? ""} data-testid="extension-panel">
      <header class="extension-panel__bar">
        <span class="extension-panel__title" data-testid="extension-title">${this.#title || extension?.panel?.title || "Extension panel"}</span>
        ${this.#extensions.length > 1
          ? html`<label class="extension-panel__pick">Panel
              <select @change=${(event: Event) => { this.#selected = (event.currentTarget as HTMLSelectElement).value; this.#title = ""; this.requestUpdate(); }}>
                ${this.#extensions.map((candidate) => html`<option value=${candidate.id} ?selected=${candidate.id === this.#selected}>${candidate.panel?.title ?? candidate.id}</option>`)}
              </select>
            </label>`
          : nothing}
      </header>
      ${this.#loading
        ? html`<p class="extension-panel__note" role="status">Reading extension panels…</p>`
        : this.#error
          ? html`<p class="extension-panel__note extension-panel__note--error" role="alert">${this.#error}</p>`
          : !extension
            ? html`<p class="extension-panel__note">No extension panels are installed. Add a <code>ui</code> entry to an extension and enable it in Settings → Extensions.</p>`
            : !loaded
              ? html`<p class="extension-panel__note">This extension is ${extension.state === "disabled" ? "disabled" : extension.state}. Enable it in Settings → Extensions.</p>`
              : html`<iframe
                  class="extension-panel__frame"
                  data-extension-frame data-testid="extension-frame"
                  title=${extension.panel?.title ?? extension.id}
                  sandbox="allow-scripts allow-forms"
                  referrerpolicy="no-referrer"
                  .src=${this.#src(extension)}
                  style=${`height:${this.#height}px`}
                  @load=${() => this.#postInit()}
                ></iframe>`}
    </section>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-extension-panel")) {
  customElements.define("hui-extension-panel", HuiExtensionPanel);
}
