// OpenClaw 2026.9.5 resizable-divider port (MIT, ec9c1a13).
import { css, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("resizable-divider")
export class ResizableDivider extends LitElement {
  @property({ type: Number }) splitRatio = 0.5;
  @property({ type: Number }) minRatio = 0.15;
  @property({ type: Number }) maxRatio = 0.85;
  @property() label = "Resize";
  /** Stable pane hosts need not be adjacent siblings in visual order. */
  @property({ type: Number }) resizeExtent: number | undefined;
  @property({ reflect: true }) orientation: "vertical" | "horizontal" = "vertical";
  private pointerId: number | undefined;
  private startPosition = 0;
  private startRatio = 0;
  private dragRatio = 0;
  private dragSize = 0;
  private frame = 0;
  private pendingPosition: number | undefined;

  static override styles = css`
    :host { width: var(--resize-handle-size, 6px); cursor: col-resize; flex-shrink: 0; position: relative; touch-action: none; user-select: none; }
    :host::before { content: ""; position: absolute; top: 0; left: -4px; right: -4px; bottom: 0; }
    :host::after { content: ""; position: absolute; top: 0; bottom: 0; inset-inline-start: var(--resize-handle-line-inline, 50%); width: var(--resize-handle-line-size, 1px); transform: translateX(-50%); background: var(--resize-handle-rest-color, var(--border, #1e2028)); transition: background 150ms ease-out, width 150ms ease-out; }
    :host(:hover)::after, :host(.dragging)::after, :host(:focus-visible)::after { width: var(--resize-handle-active-line-size, 2px); background: var(--resize-handle-active-color, currentColor); }
    :host(:focus-visible) { outline: 2px solid var(--accent, #ff5c5c); outline-offset: 2px; }
    :host([orientation="horizontal"]) { width: auto; height: var(--resize-handle-size, 6px); cursor: row-resize; }
    :host([orientation="horizontal"])::before { top: -4px; left: 0; right: 0; bottom: -4px; }
    :host([orientation="horizontal"])::after { top: var(--resize-handle-line-block, 50%); bottom: auto; inset-inline-start: 0; left: 0; right: 0; width: auto; height: var(--resize-handle-line-size, 1px); transform: translateY(-50%); transition: background 150ms ease-out, height 150ms ease-out; }
    :host([orientation="horizontal"]:hover)::after, :host([orientation="horizontal"].dragging)::after, :host([orientation="horizontal"]:focus-visible)::after { width: auto; height: var(--resize-handle-active-line-size, 2px); }
  `;

  override render() { return nothing; }

  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute("role", "separator");
    this.tabIndex = 0;
    this.addEventListener("pointerdown", this.start);
    this.addEventListener("keydown", this.keydown);
  }

  override disconnectedCallback() {
    this.stop();
    this.removeEventListener("pointerdown", this.start);
    this.removeEventListener("keydown", this.keydown);
    super.disconnectedCallback();
  }

  override updated() {
    this.setAttribute("aria-orientation", this.orientation);
    this.setAttribute("aria-label", this.label);
    this.setAttribute("aria-valuemin", String(Math.round(this.minRatio * 100)));
    this.setAttribute("aria-valuemax", String(Math.round(this.maxRatio * 100)));
    this.setAttribute("aria-valuenow", String(Math.round(this.splitRatio * 100)));
  }

  private clamp(ratio: number) { return Math.min(this.maxRatio, Math.max(this.minRatio, ratio)); }

  private emit(ratio: number, end = false) {
    const splitRatio = this.clamp(ratio);
    this.setAttribute("aria-valuenow", String(Math.round(splitRatio * 100)));
    this.dispatchEvent(new CustomEvent(end ? "resize-end" : "resize", { detail: { splitRatio }, bubbles: true, composed: true }));
    return splitRatio;
  }

  private start = (event: PointerEvent) => {
    if (event.button !== 0 || this.pointerId !== undefined) return;
    this.focus({ preventScroll: true });
    const before = this.previousElementSibling?.getBoundingClientRect();
    const after = this.nextElementSibling?.getBoundingClientRect();
    this.dragSize = this.resizeExtent ?? (this.orientation === "horizontal" ? (before?.height ?? 0) + (after?.height ?? 0) : (before?.width ?? 0) + (after?.width ?? 0));
    if (this.dragSize <= 0) return;
    this.startPosition = this.orientation === "horizontal" ? event.clientY : event.clientX;
    this.startRatio = this.dragRatio = this.splitRatio;
    this.pointerId = event.pointerId;
    this.setPointerCapture(event.pointerId);
    this.classList.add("dragging");
    window.addEventListener("pointermove", this.move);
    window.addEventListener("pointerup", this.finish);
    window.addEventListener("pointercancel", this.finish);
    window.addEventListener("blur", this.finish);
    this.addEventListener("lostpointercapture", this.finish);
    event.preventDefault();
  };

  private move = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.pendingPosition = this.orientation === "horizontal" ? event.clientY : event.clientX;
    this.frame ||= requestAnimationFrame(this.flush);
  };

  private flush = () => {
    this.frame = 0;
    if (this.pendingPosition === undefined) return;
    this.dragRatio = this.emit(this.startRatio + (this.pendingPosition - this.startPosition) / this.dragSize);
    this.pendingPosition = undefined;
  };

  private finish = (event: Event) => {
    if (event instanceof PointerEvent && event.pointerId !== this.pointerId) return;
    if (this.pointerId !== undefined) {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.flush();
      this.emit(this.dragRatio, true);
    }
    this.stop();
  };

  private stop() {
    const pointer = this.pointerId;
    this.pointerId = undefined;
    this.classList.remove("dragging");
    this.removeEventListener("lostpointercapture", this.finish);
    if (pointer !== undefined && this.hasPointerCapture(pointer)) this.releasePointerCapture(pointer);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pendingPosition = undefined;
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.finish);
    window.removeEventListener("pointercancel", this.finish);
    window.removeEventListener("blur", this.finish);
  }

  private keydown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.02;
    const previous = this.orientation === "horizontal" ? "ArrowUp" : "ArrowLeft";
    const next = this.orientation === "horizontal" ? "ArrowDown" : "ArrowRight";
    const ratio = event.key === previous ? this.splitRatio - step : event.key === next ? this.splitRatio + step : event.key === "Home" ? this.minRatio : event.key === "End" ? this.maxRatio : undefined;
    if (ratio === undefined) return;
    event.preventDefault();
    this.emit(ratio);
    this.emit(ratio, true);
  };
}
