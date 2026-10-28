/** PI's `codemode` tool as one card: the script, the calls it made (live while it runs, from the gateway's
 * `tool_update` details; afterwards from its result's `details.calls`) and the output the model got. The script's
 * calls never get rows of their own: their results went to the script, not the model. */
import { html, nothing, type TemplateResult } from "lit";
import { until } from "lit/directives/until.js";
import { icons } from "../../lib/icons.ts";
import { openMessageContextMenu } from "../../lib/message-context-menu.ts";
import type { TranscriptItem } from "../../api/sessions.ts";
import { renderToolFileReference, syncToolOverflow } from "./read-tool-card.ts";
import { shouldToggleToolDisclosure } from "./command-tool-card.ts";
import { codemodeOutcome, codemodeSummary, codemodeToolPresentation, formatCallDuration, type CodemodeCall } from "../../lib/tool-cards.ts";

type Tool = Extract<TranscriptItem, { kind: "tool" }>;

const STATUS_LABEL: Record<CodemodeCall["status"], string> = { running: "Running", ok: "Done", error: "Failed", cancelled: "Cancelled" };
const STATUS_GLYPH: Record<CodemodeCall["status"], string> = { running: "…", ok: "✓", error: "✗", cancelled: "⊘" };

/** JavaScript colours from the Files editor's parser, loaded on first use; the plain script until then. A script is
 * shown for as long as its card exists, so a few recent ones are kept. */
const highlighted = new Map<string, Promise<TemplateResult | string>>();
function renderScript(code: string) {
  let pending = highlighted.get(code);
  if (!pending) {
    if (highlighted.size >= 20) highlighted.delete(highlighted.keys().next().value!);
    pending = Promise.all([import("../../lib/code-languages.ts"), import("../../lib/diff/highlight.ts")])
      .then(async ([languages, { highlightBlock }]) => {
        const parser = await languages.loadLanguageParser("javascript");
        if (!parser) return code;
        return html`${highlightBlock(parser, code.split("\n")).map((segments, index) => html`${index ? "\n" : ""}${segments.map((segment) =>
          segment.className ? html`<span class=${segment.className}>${segment.text}</span>` : segment.text)}`)}`;
      })
      .catch(() => code);
    highlighted.set(code, pending);
  }
  return until(pending, code);
}

function renderCall(call: CodemodeCall) {
  return html`<li class="chat-tool-codemode__call" data-status=${call.status}>
    <span class="chat-tool-codemode__status" role="img" aria-label=${STATUS_LABEL[call.status]} title=${STATUS_LABEL[call.status]}>${STATUS_GLYPH[call.status]}</span>
    <span class="chat-tool-codemode__name">${call.name}</span>
    <code class="chat-tool-codemode__args">${call.args}</code>
    <span class="chat-tool-codemode__duration">${call.durationMs === undefined ? "" : formatCallDuration(call.durationMs)}</span>
    ${call.error ? html`<span class="chat-tool-codemode__error">${call.error}</span>` : nothing}
  </li>`;
}

export function renderCodemodeToolCard(item: Tool, options: {
  expanded: boolean;
  onToggle: () => void;
  onCopy: (text: string) => Promise<boolean>;
}) {
  const view = codemodeToolPresentation(item);
  if (!view) return html``;
  const failed = view.state === "failed";
  const copy = (text: string) => (event: MouseEvent | KeyboardEvent) => openMessageContextMenu(event, text, options.onCopy);
  const errorAt = view.output.search(/^Script error:/mu);
  return html`<div class="chat-tool-msg-collapse chat-tool-msg-collapse--manual chat-tool-codemode ${options.expanded ? "is-open" : ""}" data-tool-id=${item.id}>
    <button class="chat-inline-disclosure chat-tool-msg-summary chat-tool-row ${view.state === "running" ? "chat-tool-row--running" : ""}"
      type="button" aria-expanded=${String(options.expanded)}
      @pointerenter=${syncToolOverflow} @focus=${syncToolOverflow}
      @click=${(event: MouseEvent) => { if (shouldToggleToolDisclosure(event)) options.onToggle(); }}>
      <span class="chat-tool-msg-summary__icon">${icons.zap}</span>
      <span class="chat-tool-disclosure__content"><span class="chat-tool-row__verb">codemode</span> <span class="chat-tool-row__target">${codemodeSummary(view)}</span></span>
      ${failed ? html`<span class="chat-tool-failure">failed</span>` : view.failedCalls ? html`<span class="chat-tool-failure">${view.failedCalls} failed</span>` : nothing}
      ${view.wallSeconds ? html`<span class="chat-tool-codemode__time">${view.wallSeconds}s</span>` : nothing}
      <span class="chat-tool-row__chevron" aria-hidden="true">${icons.chevron}</span>
    </button>
    ${options.expanded ? html`<div class="chat-tool-msg-body"><div class="chat-tool-card ${failed ? "chat-tool-card--error" : ""}">
      <section class="chat-tool-card__block" tabindex="0" aria-label="Script" @contextmenu=${copy(view.code)} @keydown=${copy(view.code)}>
        <div class="chat-tool-card__block-header"><span class="chat-tool-card__block-label">Script</span></div>
        <pre class="chat-tool-card__block-content chat-tool-codemode__script"><code>${renderScript(view.code)}</code></pre>
      </section>
      ${view.calls.length ? html`<section class="chat-tool-card__block">
        <div class="chat-tool-card__block-header"><span class="chat-tool-card__block-label">Calls · ${view.calls.length}</span></div>
        <ol class="chat-tool-codemode__calls" tabindex="0" aria-label="Calls">${view.calls.map(renderCall)}</ol>
      </section>` : nothing}
      ${view.output ? html`<section class="chat-tool-card__block" tabindex="0" aria-label="Output" @contextmenu=${copy(item.output ?? "")} @keydown=${copy(item.output ?? "")}>
        <div class="chat-tool-card__block-header"><span class="chat-tool-card__block-label">Output</span></div>
        <pre class="chat-tool-card__block-content"><code>${errorAt < 0 ? view.output : html`${view.output.slice(0, errorAt)}<span class="chat-tool-codemode__script-error">${view.output.slice(errorAt)}</span>`}</code></pre>
        ${view.fullOutputPath ? html`<div class="chat-tool-kv"><div class="chat-tool-kv__row"><span class="chat-tool-kv__key">Full output:</span><span class="chat-tool-kv__value">${renderToolFileReference(view.fullOutputPath)}</span></div></div>` : nothing}
      </section>` : nothing}
      <div class="chat-tool-card__outcome">${codemodeOutcome(view)}</div>
    </div></div>` : nothing}
  </div>`;
}
