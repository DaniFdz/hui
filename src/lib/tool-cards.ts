/**
 * What the chat's read, command and codemode tool cards show, worked out from a tool call: the file a read names, the
 * command a shell call runs, a codemode script's calls and outcome. Pure, so the web's cards
 * (`src/views/chat/*-tool-card.ts`) and the iOS core read tool calls the same way.
 */
import type { TranscriptItem } from "../api/sessions.ts";
import { stripShellPreamble } from "./tool-shell-display.ts";

type Tool = Extract<TranscriptItem, { kind: "tool" }>;

const READ_TOOLS = ["read", "read_file", "readfile", "notebookread", "notebook_read"];
/** Tools whose path argument names the one file they change. */
const FILE_TOOLS = [...READ_TOOLS, "edit", "edit_file", "multiedit", "multi_edit", "write", "write_file", "create_file", "notebookedit", "notebook_edit"];
const PATH_KEYS = ["path", "file_path", "filePath", "file", "filepath", "filename", "notebook_path"];

function toolArgs(item: Tool): Record<string, unknown> | null {
  return item.args && typeof item.args === "object" && !Array.isArray(item.args) ? item.args as Record<string, unknown> : null;
}

/** The file a read, edit or write tool call names, as the agent passed it. */
export function toolFilePath(item: Tool): string | undefined {
  if (!FILE_TOOLS.includes(item.name.trim().toLowerCase())) return undefined;
  const args = toolArgs(item);
  return PATH_KEYS.map((key) => args?.[key]).find((value): value is string => typeof value === "string" && !!value.trim());
}

export function readToolPresentation(item: Tool) {
  if (!READ_TOOLS.includes(item.name.trim().toLowerCase())) return null;
  const args = toolArgs(item);
  const path = toolFilePath(item);
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = normalized.slice(normalized.lastIndexOf("/") + 1) || path;
  const shortPath = path.replace(/^\/(?:Users|home)\/[^/]+(\/|$)/, "~$1").replace(/^C:\\Users\\[^\\]+(\\|$)/i, "~$1");
  // These are the exact row-summarized fields in upstream tool content.
  const summarizedKeys = new Set(["path", "file_path", "filePath", "notebook_path"]);
  const extras = Object.entries(args ?? {}).filter(([key]) => !summarizedKeys.has(key));
  return { target, path, shortPath, detail: `from ${shortPath}`, extras };
}

export function displayToolValue(value: unknown): string {
  const text = typeof value === "string" ? value : value === null || value === undefined ? String(value)
    : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Avoid cutting a UTF-16 surrogate pair, as in the upstream display helper.
  const end = text.length > 400 && /[\uD800-\uDBFF]/.test(text[399] ?? "") && /[\uDC00-\uDFFF]/.test(text[400] ?? "") ? 399 : 400;
  return text.slice(0, end);
}

type CommandToolView = { command: string; preview: string; extras: [string, unknown][] };

// Every render of the transcript asks for each tool row's view, and parsing
// the shell for its preview costs ~12 ms per render on a long session.
// Transcript items are replaced, never mutated, so one parse per item holds.
const commandViews = new WeakMap<Tool, CommandToolView | null>();

export function commandToolPresentation(item: Tool): CommandToolView | null {
  let view = commandViews.get(item);
  if (view === undefined) commandViews.set(item, view = presentCommandTool(item));
  return view;
}

function presentCommandTool(item: Tool): CommandToolView | null {
  const args = item.args && typeof item.args === "object" && !Array.isArray(item.args) ? item.args as Record<string, unknown> : null;
  if (!args || typeof args.command !== "string" || !args.command.trim()) return null;
  const namedCommand = ["bash", "exec", "shell", "run_command", "run_terminal_cmd"].includes(item.name.trim().toLowerCase());
  if (!namedCommand && Object.keys(args).length > 3) return null;
  // Original tool-call-view wrapper normalization is display-only.
  const source = args.command;
  const match = source.match(/^\s*(?:\/(?:usr\/)?bin\/)?(?:ba|z|da)?sh\s+-l?c\s+(['"])([\s\S]+)\1\s*$/);
  const command = match?.[2] ?? source;
  const preview = (stripShellPreamble(command).command || command).replace(/\s+/gu, " ").trim();
  const end = /[\uD800-\uDBFF]/.test(preview[199] ?? "") && /[\uDC00-\uDFFF]/.test(preview[200] ?? "") ? 199 : 200;
  return { command, preview: preview.slice(0, end), extras: Object.entries(args).filter(([key]) => key !== "command") };
}

export type CodemodeCall = { name: string; args: string; status: "running" | "ok" | "error" | "cancelled"; durationMs?: number; error?: string };
export type CodemodeView = {
  code: string;
  calls: CodemodeCall[];
  /** The tools called, in first-call order: `read ×3, bash`. */
  tools: string;
  state: "running" | "completed" | "failed";
  failedCalls: number;
  /** What the model got, without the "Script completed / Wall time / Output:" header. */
  output: string;
  wallSeconds?: string;
  fullOutputPath?: string;
};

const STATUSES = new Set(["running", "ok", "error", "cancelled"]);
const HEADER = /^Script (completed|failed)\nWall time ([\d.]+) seconds\nOutput:\n?/u;

function isCall(value: unknown): value is CodemodeCall {
  const call = value as Partial<CodemodeCall> | null;
  return typeof call?.name === "string" && STATUSES.has(call.status as string);
}

/** Transcript items are replaced, never mutated: one view per item. */
const codemodeViews = new WeakMap<Tool, CodemodeView | null>();

export function codemodeToolPresentation(item: Tool): CodemodeView | null {
  let view = codemodeViews.get(item);
  if (view === undefined) codemodeViews.set(item, view = presentCodemode(item));
  return view;
}

function presentCodemode(item: Tool): CodemodeView | null {
  const code = (item.args as { code?: unknown } | undefined)?.code;
  if (item.name !== "codemode" || typeof code !== "string") return null;
  const details = (item.details ?? {}) as { calls?: unknown; fullOutputPath?: unknown };
  const calls = Array.isArray(details.calls) ? details.calls.filter(isCall) : [];
  const counts = new Map<string, number>();
  for (const call of calls) counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  const named = [...counts].map(([name, count]) => count > 1 ? `${name} ×${count}` : name);
  const header = HEADER.exec(item.output ?? "");
  const running = (item.status ?? "running") === "running";
  return {
    code,
    calls,
    tools: named.length > 4 ? `${named.slice(0, 4).join(", ")} +${named.length - 4} more` : named.join(", "),
    state: running ? "running" : item.failed || item.status === "failed" || header?.[1] === "failed" ? "failed" : "completed",
    failedCalls: calls.filter((call) => call.status === "error").length,
    output: (header ? item.output!.slice(header[0].length) : item.output ?? "").replace(/\n+$/u, ""),
    ...(header ? { wallSeconds: header[2]! } : {}),
    ...(typeof details.fullOutputPath === "string" ? { fullOutputPath: details.fullOutputPath } : {}),
  };
}

export function formatCallDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

/** The row's line after the name: the tools the script called. Its badge says what failed. */
export function codemodeSummary(view: CodemodeView): string {
  if (!view.calls.length) return view.state === "running" ? "Starting…" : "no tool calls";
  return view.state === "running" ? `${view.tools}…` : view.tools;
}

export function codemodeOutcome(view: CodemodeView): string {
  const calls = view.calls.length;
  const cancelled = view.calls.filter((call) => call.status === "cancelled").length;
  const parts = [`${calls} call${calls === 1 ? "" : "s"}`, ...(view.failedCalls ? [`${view.failedCalls} failed`] : []), ...(cancelled ? [`${cancelled} cancelled`] : [])].join(", ");
  if (view.state === "running") return `Running · ${parts} so far`;
  const time = view.wallSeconds ? ` ${view.state === "failed" ? "after" : "in"} ${view.wallSeconds}s` : "";
  return `${view.state === "failed" ? "Failed" : "Completed"}${time} · ${parts}`;
}
