/**
 * An extension's full page: its entry document in a sandboxed frame under HUI's navigation. The frame has an opaque
 * origin and no network; the only channel is the parent bridge for this extension's declared routes, plus theme,
 * height, https links and an allowlisted conversation navigation. It is the page equivalent of an extension panel.
 */
import { html, nothing } from "lit";

import { callExtensionRoute, loadExtensions } from "../api/extensions.ts";
import type { ExtensionStatus } from "../api/schema/extensions.ts";
import {
  BRIDGE_CALL_TIMEOUT_MS, BRIDGE_CHANNEL, BRIDGE_MAX_IN_FLIGHT, BRIDGE_MAX_RESPONSE_BYTES, EXTENSION_NAVIGATE_EVENT,
  allowedNavigatePath, jsonBytes, parseBridgeCall,
} from "../lib/extensions/bridge.ts";
import { HuiElement } from "../lit/hui-element.ts";

export class HuiExtensionPage extends HuiElement {
  static override properties = {
    extensionId: { type: String },
  };
  declare extensionId: string;

  #extension: ExtensionStatus | undefined;
  #loading = true;
  #error = "";
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
      this.#extension = extensions.find((extension) => extension.id === this.extensionId);
      if (!this.#extension) this.#error = "This extension page is not installed.";
      else if (this.#extension.state !== "loaded") this.#error = `This extension is ${this.#extension.state}. Enable it in Settings → Extensions.`;
      else if (!this.#extension.page) this.#error = "This extension does not provide a page.";
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "The extension page could not be loaded.";
    }
    this.#loading = false;
    this.requestUpdate();
  }

  #frame(): HTMLIFrameElement | undefined {
    return this.querySelector("iframe[data-extension-page-frame]") ?? undefined;
  }

  #send(message: Record<string, unknown>) {
    // A sandboxed frame's origin is opaque, so the channel name and the source check identify the parent.
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
    const extension = this.#extension;
    if (!extension) return;
    this.#send({ type: "init", extensionId: extension.id, theme: this.#theme() });
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
    if (data["type"] === "open" && typeof data["value"] === "string") {
      try {
        const url = new URL(data["value"] as string);
        if (url.protocol === "https:") window.open(url.href, "_blank", "noopener,noreferrer");
      } catch {
        // Not a URL: ignored, like every other unknown message.
      }
      return;
    }
    if (data["type"] === "navigate" && typeof data["value"] === "string") {
      const path = allowedNavigatePath(data["value"]);
      if (path) this.dispatchEvent(new CustomEvent(EXTENSION_NAVIGATE_EVENT, { bubbles: true, composed: true, detail: { path } }));
      return;
    }
    if (data["type"] === "call") void this.#call(data);
  };

  async #call(value: Record<string, unknown>) {
    const extension = this.#extension;
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
    const entry = extension.page?.entry ?? "index.html";
    return `/__hui/ext-ui/${encodeURIComponent(extension.id)}/${entry.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
  }

  override render() {
    const extension = this.#extension;
    return html`<section class="extension-page" data-extension-page=${this.extensionId} data-testid="extension-page" data-page-title=${this.#title || nothing}>
      ${this.#loading
        ? html`<p class="extension-page__note" role="status">Reading the extension page…</p>`
        : this.#error || !extension?.page
          ? html`<p class="extension-page__note extension-page__note--error" role="alert">${this.#error || "This extension page is unavailable."}</p>`
          : html`<iframe
              class="extension-page__frame"
              data-extension-page-frame data-testid="extension-page-frame"
              title=${extension.page.title}
              sandbox="allow-scripts allow-forms"
              referrerpolicy="no-referrer"
              .src=${this.#src(extension)}
              @load=${() => this.#postInit()}
            ></iframe>`}
    </section>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-extension-page")) {
  customElements.define("hui-extension-page", HuiExtensionPage);
}
