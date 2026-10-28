/**
 * One card for the tools a turn used: a mark stack and a live "Using N tools" header that settles to "Used N tools",
 * and one row per call with the call in plain words, its result size and its status. Opening a row draws that tool's
 * own card body (read, command or codemode), so a call's detail keeps living where it already did. Presentation only:
 * the transcript still owns the order and the data, and a call without a known phrasing falls back to its name.
 */
import { html, nothing, type TemplateResult } from "lit";
import { icons } from "../../lib/icons.ts";
import type { TranscriptItem } from "../../api/sessions.ts";
import { readToolPresentation, renderReadToolBody, toolFilePath } from "./read-tool-card.ts";
import { commandToolPresentation, renderCommandToolBody } from "./command-tool-card.ts";
import { codemodeToolPresentation, renderCodemodeToolBody } from "./codemode-tool-card.ts";

export type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

const READ_TOOLS = new Set(["read", "read_file", "readfile", "notebookread", "notebook_read"]);
const EDIT_TOOLS = new Set(["edit", "edit_file", "apply_patch", "multiedit", "multi_edit"]);
const WRITE_TOOLS = new Set(["write", "write_file", "create_file", "file_write"]);
const SEARCH_TOOLS = new Set(["grep", "glob", "find", "search", "code_search", "ripgrep", "rg"]);
const COMMAND_TOOLS = new Set(["bash", "shell", "exec", "run_command", "run_terminal_cmd", "command", "terminal"]);
const FETCH_TOOLS = new Set(["web_fetch", "webfetch", "fetch"]);
const WEB_SEARCH_TOOLS = new Set(["web_search", "websearch"]);

function toolArgs(item: ToolItem): Record<string, unknown> {
  return item.args && typeof item.args === "object" && !Array.isArray(item.args) ? item.args as Record<string, unknown> : {};
}

function stringArg(item: ToolItem, ...keys: string[]): string {
  const args = toolArgs(item);
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** One line of the model's own words, clipped so a long command never pushes the row's meta away. */
function clip(text: string, max = 68): string {
  const oneLine = text.replace(/\s+/gu, " ").trim();
  if (oneLine.length <= max) return oneLine;
  const end = /[\uD800-\uDBFF]/.test(oneLine[max - 1] ?? "") && /[\uDC00-\uDFFF]/.test(oneLine[max] ?? "") ? max - 1 : max;
  return `${oneLine.slice(0, end).trimEnd()}…`;
}

function fileName(item: ToolItem): string {
  const path = toolFilePath(item);
  if (!path) return stringArg(item, "path", "file_path", "file", "filename");
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/u, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || path;
}

/** What the row says, in the tense its status calls for: `done` once it settled, `running` while it works. */
export function toolCallLabel(item: ToolItem): { done: string; running: string } {
  const name = item.name.trim().toLowerCase();
  const target = fileName(item);
  if (READ_TOOLS.has(name) && target) return { done: `Read ${target}`, running: `Reading ${target}` };
  if ((EDIT_TOOLS.has(name) || WRITE_TOOLS.has(name)) && target) {
    const [done, running] = WRITE_TOOLS.has(name) ? ["Wrote", "Writing"] : ["Edited", "Editing"];
    return { done: `${done} ${target}`, running: `${running} ${target}` };
  }
  if (COMMAND_TOOLS.has(name)) {
    const command = commandToolPresentation(item)?.preview ?? stringArg(item, "command");
    if (command) return { done: `Ran ${clip(command, 60)}`, running: `Running ${clip(command, 60)}` };
  }
  if (SEARCH_TOOLS.has(name)) {
    const pattern = stringArg(item, "pattern", "query", "glob", "expression");
    if (pattern) return { done: `Searched for ${clip(pattern, 44)}`, running: `Searching for ${clip(pattern, 44)}` };
  }
  if (FETCH_TOOLS.has(name)) {
    const url = stringArg(item, "url", "href");
    const host = url ? new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./u, "") : "";
    if (host) return { done: `Fetched ${host}`, running: `Fetching ${host}` };
  }
  if (WEB_SEARCH_TOOLS.has(name)) {
    const query = stringArg(item, "query", "q");
    if (query) return { done: `Searched the web for “${clip(query, 40)}”`, running: `Searching the web for “${clip(query, 40)}”` };
  }
  if (name === "codemode") return { done: "Ran a codemode script", running: "Running a codemode script" };
  if (name === "browser") return { done: "Used the browser", running: "Using the browser" };
  const readable = item.name.replace(/[_-]+/gu, " ").trim();
  return { done: `Used ${readable}`, running: `Using ${readable}` };
}

/** The quiet result size before the status: how many lines, matches or rows came back. Only what the output itself
 * proves; an unknown tool gets none rather than a guess. */
export function toolCallMeta(item: ToolItem): string | undefined {
  const name = item.name.trim().toLowerCase();
  if (name === "codemode") {
    const view = codemodeToolPresentation(item);
    if (view) return `${view.calls.length} call${view.calls.length === 1 ? "" : "s"}`;
  }
  const output = item.output?.trimEnd() ?? "";
  if (!output) return undefined;
  const lines = output.split("\n").filter((line) => line.trim()).length;
  if (READ_TOOLS.has(name) || EDIT_TOOLS.has(name) || WRITE_TOOLS.has(name)) return `${lines} line${lines === 1 ? "" : "s"}`;
  if (SEARCH_TOOLS.has(name)) return `${lines} result${lines === 1 ? "" : "s"}`;
  return undefined;
}

type ToolKind = "read" | "command" | "codemode" | "edit" | "search" | "web" | "other";

function toolKind(item: ToolItem): ToolKind {
  const name = item.name.trim().toLowerCase();
  if (READ_TOOLS.has(name)) return "read";
  if (COMMAND_TOOLS.has(name)) return "command";
  if (name === "codemode") return "codemode";
  if (EDIT_TOOLS.has(name) || WRITE_TOOLS.has(name)) return "edit";
  if (SEARCH_TOOLS.has(name)) return "search";
  if (FETCH_TOOLS.has(name) || WEB_SEARCH_TOOLS.has(name) || name === "browser") return "web";
  return "other";
}

const KIND_ICON: Record<ToolKind, TemplateResult> = {
  read: icons.fileText,
  command: icons.squareTerminal,
  codemode: icons.zap,
  edit: icons.edit,
  search: icons.search,
  web: icons.globe,
  other: icons.wrench,
};

type Status = "running" | "succeeded" | "failed";

function statusOf(item: ToolItem): Status {
  if (item.failed || item.status === "failed") return "failed";
  return (item.status ?? "running") === "running" ? "running" : "succeeded";
}

function statusGlyph(status: Status) {
  if (status === "running") return html`<span class="tool-call-row__spin" aria-hidden="true"></span>`;
  if (status === "failed") return html`<span class="tool-call-row__status tool-call-row__status--failed" role="img" aria-label="Failed">${icons.alertTriangle}</span>`;
  return html`<span class="tool-call-row__status tool-call-row__status--done" role="img" aria-label="Done">${icons.check}</span>`;
}

/** The tool's own body when it has one; otherwise the arguments and output as the generic card shows them. */
export function renderToolBody(item: ToolItem, onCopy: (text: string, key: string) => void): TemplateResult {
  if (readToolPresentation(item)) return renderReadToolBody(item, { onCopy: (text) => Promise.resolve(onCopy(text, `tool-${item.id}`) as unknown as boolean) });
  if (commandToolPresentation(item)) return renderCommandToolBody(item, { onCopy: (text) => Promise.resolve(onCopy(text, `tool-${item.id}`) as unknown as boolean) });
  if (codemodeToolPresentation(item)) return renderCodemodeToolBody(item, { onCopy: (text) => Promise.resolve(onCopy(text, `tool-${item.id}`) as unknown as boolean) });
  return html`<div class="chat-tool-msg-body"><div class="chat-tool-card">
    ${item.args !== undefined ? html`<section class="chat-tool-card__block"><div class="chat-tool-card__block-header"><span class="chat-tool-card__block-label">Input</span></div><pre class="chat-tool-card__block-content"><code>${typeof item.args === "string" ? item.args : JSON.stringify(item.args, null, 2)}</code></pre></section>` : nothing}
    ${item.output !== undefined ? html`<section class="chat-tool-card__block"><div class="chat-tool-card__block-header"><span class="chat-tool-card__block-label">Output</span></div><pre class="chat-tool-card__block-content"><code>${item.output || "No output"}</code></pre></section>` : nothing}
  </div></div>`;
}

export type ToolCallGroupOptions = {
  /** Marks the card as the one row id, so its open state survives a re-render. */
  id: string;
  expanded: boolean;
  onToggle: (open: boolean) => void;
  /** Why the group is open: one of its calls is open, or it is still working. */
  expansionId: (item: ToolItem) => string;
  expandedIds: ReadonlySet<string>;
  onRowToggle: (expansionId: string, open: boolean) => void;
  onCopy: (text: string, key: string) => void;
};

/** The tool calls of one activity row as one card. */
export function renderToolCallGroup(items: readonly ToolItem[], options: ToolCallGroupOptions): TemplateResult {
  const running = items.some((item) => statusOf(item) === "running");
  const tools = items.length;
  const kinds = [...new Set(items.map(toolKind))];
  const marks = kinds.slice(0, 4).map((kind) => html`<span class="tool-call-group__mark" title=${kind}>${KIND_ICON[kind]}</span>`);
  return html`<div class="tool-call-group">
    <details class="tool-call-group__disclosure" .open=${options.expanded}
      @toggle=${(event: Event) => options.onToggle((event.currentTarget as HTMLDetailsElement).open)}>
      <summary class="tool-call-group__head">
        <span class="tool-call-group__marks" aria-hidden="true">${marks}${kinds.length > 4 ? html`<span class="tool-call-group__mark tool-call-group__mark--more">+${kinds.length - 4}</span>` : nothing}</span>
        <span class=${running ? "tool-call-group__label tool-call-group__label--live" : "tool-call-group__label"}>${running ? "Using" : "Used"} ${tools} ${tools === 1 ? "tool" : "tools"}</span>
        ${running ? html`<span class="tool-call-group__spin" aria-hidden="true"></span>` : nothing}
        <span class="tool-call-group__chevron" aria-hidden="true">${icons.chevron}</span>
      </summary>
      ${options.expanded ? html`<div class="tool-call-group__rows">
        ${items.map((item) => {
          const status = statusOf(item);
          const label = toolCallLabel(item);
          const meta = toolCallMeta(item);
          const expansionId = options.expansionId(item);
          const open = options.expandedIds.has(expansionId);
          const title = status === "running" ? label.running : label.done;
          return html`<div class="tool-call-row" data-status=${status}>
            <button type="button" class=${open ? "tool-call-row__toggle is-open" : "tool-call-row__toggle"} aria-expanded=${String(open)}
              @click=${() => options.onRowToggle(expansionId, !open)}>
              <span class="tool-call-row__icon" aria-hidden="true">${KIND_ICON[toolKind(item)]}</span>
              <span class=${status === "running" ? "tool-call-row__title tool-call-row__title--live" : "tool-call-row__title"}>${title}</span>
              ${meta ? html`<span class="tool-call-row__meta">${meta}</span>` : nothing}
              ${statusGlyph(status)}
              <span class="tool-call-row__chevron" aria-hidden="true">${icons.chevron}</span>
            </button>
            ${open ? renderToolBody(item, options.onCopy) : nothing}
          </div>`;
        })}
      </div>` : nothing}
    </details>
  </div>`;
}
