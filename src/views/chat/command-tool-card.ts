/** Command rows/terminal blocks ported from OpenClaw 2026.9.5
 * chat-tool-cards.ts and chat-tool-content.ts, ec9c1a13. PI owns execution. */
import { html, nothing } from "lit";
import { icons } from "../../lib/icons.ts";
import { openMessageContextMenu } from "../../lib/message-context-menu.ts";
import type { TranscriptItem } from "../../api/sessions.ts";
import { commandToolPresentation, displayToolValue } from "../../lib/tool-cards.ts";
import { renderHighlightedCommand } from "./command-highlight.ts";
import { syncToolOverflow } from "./read-tool-card.ts";

type Tool = Extract<TranscriptItem, { kind: "tool" }>;

/** Preserve selectable command text; keyboard activation still toggles. */
export function shouldToggleToolDisclosure(event: MouseEvent): boolean {
  if (event.detail === 0) return true;
  const target = event.currentTarget;
  const selection = window.getSelection();
  if (!(target instanceof Node) || !selection || selection.isCollapsed) return true;
  return ![selection.anchorNode, selection.focusNode].some((node) => node !== null && target.contains(node));
}

export function renderCommandToolCard(item: Tool, options: {
  expanded: boolean;
  onToggle: () => void;
  onCopy: (text: string) => Promise<boolean>;
}) {
  const view = commandToolPresentation(item);
  if (!view) return html``;
  const running = (item.status ?? "running") === "running";
  const failed = item.failed || item.status === "failed";
  const copy = (event: MouseEvent | KeyboardEvent) => openMessageContextMenu(event, item.output ?? "", options.onCopy);
  return html`<div class="chat-tool-msg-collapse chat-tool-msg-collapse--manual ${options.expanded ? "is-open" : ""}" data-tool-id=${item.id}>
    <button class="chat-inline-disclosure chat-tool-msg-summary chat-tool-row ${running ? "chat-tool-row--running" : ""}"
      type="button" aria-expanded=${String(options.expanded)}
      @pointerenter=${syncToolOverflow} @focus=${syncToolOverflow}
      @click=${(event: MouseEvent) => { if (shouldToggleToolDisclosure(event)) options.onToggle(); }}>
      <span class="chat-tool-msg-summary__icon">${icons.squareTerminal}</span>
      <span class="chat-tool-disclosure__content"><span class="chat-tool-row__prompt" aria-hidden="true">$</span><code class="chat-tool-row__cmd">${renderHighlightedCommand(view.preview)}</code></span>
      ${failed && !options.expanded ? html`<span class="chat-tool-failure">failed</span>` : nothing}
      <span class="chat-tool-row__chevron" aria-hidden="true">${icons.chevron}</span>
    </button>
    ${options.expanded ? html`<div class="chat-tool-msg-body"><div class="chat-tool-card chat-tool-card--flush ${failed ? "chat-tool-card--error" : ""}"
      tabindex="0" @contextmenu=${copy} @keydown=${copy}>
      <div class="chat-tool-card__actions"></div>
      <div class="chat-tool-term"><div class="chat-tool-term__cmd"><span class="chat-tool-term__prompt">$</span><code>${renderHighlightedCommand(view.command)}</code></div>
        ${item.output?.trim() ? html`<pre class="chat-tool-term__out"><code>${item.output}</code></pre>` : nothing}
      </div>
      ${view.extras.length > 0 ? html`<div class="chat-tool-kv">${view.extras.map(([key, value]) => html`<div class="chat-tool-kv__row"><span class="chat-tool-kv__key">${key}:</span><span class="chat-tool-kv__value">${displayToolValue(value)}</span></div>`)}</div>` : nothing}
      <div class="chat-tool-card__outcome">${failed ? "failed" : running ? "Running" : "Completed"}</div>
    </div></div>` : nothing}
  </div>`;
}
