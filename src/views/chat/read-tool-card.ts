/** Read-tool presentation port from OpenClaw 2026.9.5 chat-tool-cards.ts and
 * chat-tool-content.ts, ec9c1a13. No workspace/approval actions are fabricated. The path a read, edit or write tool
 * names is a file reference (`components/file-link.ts`) that opens it in the Files view once it is confirmed. */
import { html, nothing } from "lit";
import { icons } from "../../lib/icons.ts";
import { openMessageContextMenu } from "../../lib/message-context-menu.ts";
import { displayToolValue, readToolPresentation } from "../../lib/tool-cards.ts";
import type { TranscriptItem } from "../../api/sessions.ts";

type Tool = Extract<TranscriptItem, { kind: "tool" }>;

/** A tool's path as a file reference; `label` is what to show (by default the path itself). */
export function renderToolFileReference(path: string, label: string = path) {
  return html`<hui-file-ref data-path=${path.trim()}>${label}</hui-file-ref>`;
}

export function syncToolOverflow(event: Event) {
  const target = event.currentTarget as HTMLElement;
  const content = target.querySelector<HTMLElement>(".chat-tool-disclosure__content");
  target.classList.toggle("chat-tool-disclosure--overflowing", !!content && content.scrollWidth > content.clientWidth);
}

export function renderReadToolCard(item: Tool, options: {
  expanded: boolean;
  onToggle: () => void;
  onCopy: (text: string) => Promise<boolean>;
}) {
  const view = readToolPresentation(item);
  if (!view) return html``;
  const running = (item.status ?? "running") === "running";
  const failed = item.failed || item.status === "failed";
  return html`<div class="chat-tool-msg-collapse chat-tool-msg-collapse--manual ${options.expanded ? "is-open" : ""}" data-tool-id=${item.id}>
    <div class="chat-inline-disclosure chat-tool-msg-summary chat-tool-row chat-tool-row--file ${running ? "chat-tool-row--running" : ""}"
      @pointerenter=${syncToolOverflow} @focusin=${syncToolOverflow}>
      <button class="chat-tool-row__toggle" type="button" aria-expanded=${String(options.expanded)} aria-label=${`Read ${view.target}`} @click=${options.onToggle}></button>
      <span class="chat-tool-msg-summary__icon">${icons.fileText}</span>
      <span class="chat-tool-disclosure__content"><span class="chat-tool-row__verb">Read</span> <span class="chat-tool-row__target">${view.target}</span></span>
      ${failed && !options.expanded ? html`<span class="chat-tool-failure">failed</span>` : nothing}
      <span class="chat-tool-row__chevron" aria-hidden="true">${icons.chevron}</span>
    </div>
    ${options.expanded ? renderReadToolBody(item, { onCopy: options.onCopy }) : nothing}
  </div>`;
}

/** The opened card on its own: a read row inside a tool-call group draws it under the group's own row. */
export function renderReadToolBody(item: Tool, options: { onCopy: (text: string) => Promise<boolean> }) {
  const view = readToolPresentation(item);
  if (!view) return html``;
  const running = (item.status ?? "running") === "running";
  const failed = item.failed || item.status === "failed";
  const output = item.output?.trim() ? item.output : failed ? "No output — tool failed." : "";
  const copy = (event: MouseEvent | KeyboardEvent) => openMessageContextMenu(event, item.output ?? "", options.onCopy);
  return html`<div class="chat-tool-msg-body"><div class="chat-tool-card ${failed ? "chat-tool-card--error" : ""}"
    tabindex="0" @contextmenu=${copy} @keydown=${copy}>
    <div class="chat-tool-card__header"><div class="chat-tool-card__detail">from ${renderToolFileReference(view.path, view.shortPath)}</div><div class="chat-tool-card__actions"></div></div>
    ${view.extras.length > 12 ? html`<div class="chat-tool-card__block"><div class="chat-tool-card__block-header"><span class="chat-tool-card__block-icon">${icons.zap}</span><span class="chat-tool-card__block-label">Tool input</span></div><pre class="chat-tool-card__block-content"><code>${JSON.stringify(item.args, null, 2)}</code></pre></div>`
      : view.extras.length > 0 ? html`<div class="chat-tool-kv">${view.extras.map(([key, value]) => html`<div class="chat-tool-kv__row"><span class="chat-tool-kv__key">${key}:</span><span class="chat-tool-kv__value">${displayToolValue(value)}</span></div>`)}</div>` : nothing}
    ${output ? html`<div class="chat-tool-card__block">
      ${failed ? html`<div class="chat-tool-card__block-header"><span class="chat-tool-card__block-icon">${icons.zap}</span><span class="chat-tool-card__block-label">Tool error</span></div>` : nothing}
      <pre class="chat-tool-card__block-content"><code>${output}</code></pre>
    </div>` : nothing}
    <div class="chat-tool-card__outcome">${failed ? "failed" : running ? "Running" : "Completed"}</div>
  </div></div>`;
}
