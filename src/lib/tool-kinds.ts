/**
 * What one tool call counts as: the read, edit, write, search, command, fetch and web-search tool families, the kind a
 * call belongs to, and the counts an activity trail's header shows in their fixed order. Pure lookups and wording; the
 * tool cards keep their own presentation (`views/chat/tool-call-group.ts`).
 */
import type { TranscriptItem } from "../api/sessions.ts";

export type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

export const READ_TOOLS: ReadonlySet<string> = new Set(["read", "read_file", "readfile", "notebookread", "notebook_read"]);
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "edit_file", "apply_patch", "multiedit", "multi_edit"]);
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "write_file", "create_file", "file_write"]);
export const SEARCH_TOOLS: ReadonlySet<string> = new Set(["grep", "glob", "find", "search", "code_search", "ripgrep", "rg", "search_chat"]);
export const COMMAND_TOOLS: ReadonlySet<string> = new Set(["bash", "shell", "exec", "run_command", "run_terminal_cmd", "command", "terminal"]);
export const FETCH_TOOLS: ReadonlySet<string> = new Set(["web_fetch", "webfetch", "fetch"]);
export const WEB_SEARCH_TOOLS: ReadonlySet<string> = new Set(["web_search", "websearch"]);

/** The kind a trail counts: a web search is a search, a browse of a page a browser step, and a codemode script or an
 * unknown tool is another call. */
export type ToolActivityKind = "edit" | "write" | "read" | "search" | "run" | "fetch" | "browser" | "other";

export function toolActivityKind(tool: { name: string }): ToolActivityKind {
  const name = tool.name.trim().toLowerCase();
  if (READ_TOOLS.has(name)) return "read";
  if (EDIT_TOOLS.has(name)) return "edit";
  if (WRITE_TOOLS.has(name)) return "write";
  if (SEARCH_TOOLS.has(name) || WEB_SEARCH_TOOLS.has(name)) return "search";
  if (COMMAND_TOOLS.has(name)) return "run";
  if (FETCH_TOOLS.has(name)) return "fetch";
  if (name === "browser") return "browser";
  return "other";
}

/** The order the header counts in, with each kind's singular and plural name. */
const COUNTED: readonly { kind: ToolActivityKind; one: string; many: string }[] = [
  { kind: "edit", one: "edit", many: "edits" },
  { kind: "write", one: "write", many: "writes" },
  { kind: "read", one: "read", many: "reads" },
  { kind: "search", one: "search", many: "searches" },
  { kind: "run", one: "run", many: "runs" },
  { kind: "fetch", one: "fetch", many: "fetches" },
  { kind: "browser", one: "browser step", many: "browser steps" },
  { kind: "other", one: "other call", many: "other calls" },
];

/** What a run of calls did, in the header's fixed order and singular or plural: `5 edits, 3 reads, 2 runs`. A kind no
 * call used is left out rather than counted as zero. */
export function toolActivityCounts(tools: readonly { name: string }[]): string {
  const counts = new Map<ToolActivityKind, number>();
  for (const tool of tools) {
    const kind = toolActivityKind(tool);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return COUNTED
    .flatMap(({ kind, one, many }) => {
      const count = counts.get(kind) ?? 0;
      return count > 0 ? [`${count} ${count === 1 ? one : many}`] : [];
    })
    .join(", ");
}
