/**
 * `<hui-session-ref>`: a `session:<id>` reference the agent wrote in chat (`markdown/parser.ts`). It shows exactly the
 * text that was typed until the app's registry knows which session it names
 * (`lib/session/session-reference-store.ts`); then it is a chip with that session's title and status that links to
 * `/sessions/<id>`, where a plain left click is the app's own in-place navigation (`lib/in-app-links.ts`). An unknown
 * id, an ambiguous prefix or a registry that has not arrived yet leaves plain text, never a dead link, and the chip
 * appears in place when the list publishes. A registry that publishes the same id with a new title or status updates the
 * chip where it stands — the anchor stays the same element, so focus and an open tooltip survive a status flip — and one
 * that changes neither leaves it alone entirely. A chip can never sit inside a link: the parser skips a link's own label.
 *
 * A plain custom element, not Lit: it lives inside Markdown HTML, draws two spans of its own and holds no template.
 */
import {
  lookupSessionReference,
  sessionReferenceDetail,
  sessionReferenceLabel,
  subscribeSessionReferences,
  type SessionReference,
} from "../lib/session/session-reference-store.ts";
import { sessionStatusLabel } from "../lib/session/labels.ts";

/** What an unresolved reference reads: the text the writer typed, as the parser left it inside the element. */
export function sessionRefFallbackText(query: string): string {
  return `session:${query}`;
}

/** What one publish means for a drawn chip: it resolves to a different session and is rebuilt, the same session with a
 * new title or status label is updated where it stands, and anything identical is left alone. A rebuild would replace
 * the anchor the reader is holding, so a status flip updates the text of the chip that is already there. */
export function sessionRefUpdate(
  shown: { id: string; title: string; status: string } | undefined,
  reference: { id: string; title: string; status: string },
): "none" | "in-place" | "rebuild" {
  if (!shown || shown.id !== reference.id) return "rebuild";
  return shown.title === reference.title && shown.status === reference.status ? "none" : "in-place";
}

const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

export class HuiSessionRef extends Base {
  /** The typed text the parser left inside the element, put back whenever the reference does not resolve. */
  #fallback = "";
  #stop: (() => void) | undefined;
  #anchor: HTMLAnchorElement | undefined;
  /** What the drawn chip says: the id, title and status label `sessionRefUpdate` compares. */
  #shown: { id: string; title: string; status: string } | undefined;
  /** Whether the element holds only its fallback text, which is what the parser wrote. */
  #bare = true;

  connectedCallback() {
    // A chip the transcript moved (a re-render, a pane dragged elsewhere) keeps the text it was drawn from.
    if (!this.#shown) this.#fallback = this.textContent ?? "";
    this.#stop = subscribeSessionReferences(this.apply);
    this.apply();
  }

  disconnectedCallback() {
    this.#stop?.();
    this.#stop = undefined;
  }

  private apply = () => {
    const query = this.dataset["query"] ?? "";
    const reference = lookupSessionReference(query);
    if (!reference) {
      this.#anchor = undefined;
      this.#shown = undefined;
      this.#showFallback(query);
      return;
    }
    const status = sessionStatusLabel(reference);
    const current = { id: reference.id, title: reference.title, status };
    const update = sessionRefUpdate(this.#shown, current);
    if (update === "none") {
      // The stage or pull-request count moved on: the tooltip follows without touching the chip.
      this.#relabel(reference);
      return;
    }
    this.#shown = current;
    if (update === "in-place") this.#updateChip(reference, status);
    else this.#showChip(reference, status);
  };

  /** The accessible name and tooltip follow the registry even when the chip itself is left alone. */
  #relabel(reference: SessionReference) {
    const anchor = this.#anchor;
    if (!anchor) return;
    const label = sessionReferenceLabel(reference);
    const detail = sessionReferenceDetail(reference);
    if (anchor.getAttribute("aria-label") !== label) anchor.setAttribute("aria-label", label);
    if (anchor.getAttribute("data-hui-tooltip") !== detail) anchor.setAttribute("data-hui-tooltip", detail);
  }

  /** The same session with a new title or status: its own text changes where the chip stands, so the anchor keeps
   * focus, the tooltip it has open and any pointer the reader has on it. */
  #updateChip(reference: SessionReference, status: string) {
    const anchor = this.#anchor;
    if (!anchor) return;
    const title = anchor.querySelector(".session-ref__title");
    if (title) title.textContent = reference.title;
    const state = anchor.querySelector(".session-ref__status");
    if (state) {
      state.textContent = status;
      state.setAttribute("data-status", reference.status);
    }
    this.#relabel(reference);
  }

  #showFallback(query: string) {
    if (this.#bare) return;
    this.replaceChildren(this.ownerDocument.createTextNode(this.#fallback || sessionRefFallbackText(query)));
    this.#bare = true;
  }

  #showChip(reference: SessionReference, status: string) {
    const document = this.ownerDocument;
    const anchor = document.createElement("a");
    anchor.className = "session-ref";
    anchor.setAttribute("href", `/sessions/${reference.id}`);
    anchor.setAttribute("data-testid", "session-ref");
    anchor.setAttribute("aria-label", sessionReferenceLabel(reference));
    anchor.setAttribute("data-hui-tooltip", sessionReferenceDetail(reference));
    const title = document.createElement("span");
    title.className = "session-ref__title";
    title.textContent = reference.title;
    const state = document.createElement("span");
    state.className = "session-ref__status";
    state.setAttribute("data-status", reference.status);
    state.textContent = status;
    anchor.append(title, state);
    this.replaceChildren(anchor);
    this.#anchor = anchor;
    this.#bare = false;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-session-ref")) {
  customElements.define("hui-session-ref", HuiSessionRef);
}

declare global {
  interface HTMLElementTagNameMap {
    "hui-session-ref": HuiSessionRef;
  }
}
