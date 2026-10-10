/**
 * The composer's slash commands: HUI's own commands, the runtime's commands merged under them, discovery and
 * completion at the caret, and parsers that reserve HUI's command names so a malformed variant is never sent to
 * the model as a prompt.
 */
import { commandReference } from "./command-references.ts";
import type { RuntimeCommand } from "./sessions-store.ts";

export type ComposerCommand = Omit<RuntimeCommand, "source"> & { source: RuntimeCommand["source"] | "hui" };
export const HUI_COMMANDS: readonly ComposerCommand[] = [{ name: "update", description: "Check for HUI updates and install the latest release", source: "hui" }];
export const HUI_SESSION_COMMANDS: readonly ComposerCommand[] = [
  { name: "clear", description: "Clear this session's context and start a fresh PI transcript", source: "hui" },
  { name: "reload", description: "Reload extensions, skills, prompts and context files for this session", source: "hui" },
  { name: "compact", description: "Summarize older context to free space; add text to say what to keep", source: "hui" },
  { name: "btw", description: "Ask a quick side question without changing session context", source: "hui" },
  { name: "side", description: "Alias for /btw", source: "hui" },
];
/** A bot's chat is permanent: the gateway refuses to reset or compact it. */
export const BOT_CHAT_REFUSED_COMMANDS: readonly string[] = ["clear", "compact"];
/** `botChat` leaves out the commands a bot's permanent chat refuses; their
 * names stay reserved so a runtime command cannot take their place. */
export function composerCommands(commands: readonly RuntimeCommand[], includeSessionCommands = false, botChat = false): ComposerCommand[] {
  const huiCommands = includeSessionCommands ? [...HUI_COMMANDS, ...HUI_SESSION_COMMANDS] : HUI_COMMANDS;
  const names = new Set(huiCommands.map((command) => command.name));
  const offered = botChat ? huiCommands.filter((command) => !BOT_CHAT_REFUSED_COMMANDS.includes(command.name)) : huiCommands;
  return [...offered, ...commands.filter((command) => !names.has(command.name))];
}
/** Why a bot's chat does not run this text as a command, or undefined when it may. */
export function botChatCommandRefusal(text: string): string | undefined {
  const command = parseClearCommand(text) ? "clear" : parseCompactCommand(text) ? "compact" : undefined;
  return command ? `A bot keeps one permanent chat, so /${command} is not available here. Its memory summarizes older messages by itself.` : undefined;
}
/** Reserve the entire /update namespace, including invalid arguments, so an
 * operational command can never accidentally become a model prompt. */
export function parseUpdateCommand(text: string): "update" | "check" | "invalid" | null {
  const trimmed = text.trim();
  if (!/^\/update(?:\s|$)/u.test(trimmed)) return null;
  if (trimmed === "/update") return "update";
  if (/^\/update\s+--check$/u.test(trimmed)) return "check";
  return "invalid";
}

/** Reserve bare session commands so malformed variants never become model prompts. */
function parseBareCommand<Name extends string>(text: string, name: Name): Name | "invalid" | null {
  const trimmed = text.trim();
  if (!new RegExp(`^/${name}(?:\\s|$)`, "u").test(trimmed)) return null;
  return trimmed === `/${name}` ? name : "invalid";
}
export const parseClearCommand = (text: string) => parseBareCommand(text, "clear");
export const parseReloadCommand = (text: string) => parseBareCommand(text, "reload");
/** `/compact` with optional focus text for PI's summary; undefined when not a compact. */
export function parseCompactCommand(text: string): { instructions?: string } | undefined {
  const match = /^\/compact(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (!match) return undefined;
  const instructions = match[1]?.trim();
  return instructions ? { instructions } : {};
}

/** Discover leading commands; nested paths and prose use other completion modes. */
export function slashCommandQuery(text: string, caret: number, selectionEnd = caret): string | null {
  if (caret !== selectionEnd || caret < 1 || !/^[/$]/u.test(text)) return null;
  const token = /^[/$]([^\s]*)/u.exec(text)?.[1] ?? "";
  if (token.includes("/")) return null;
  return caret <= token.length + 1 ? (text.startsWith("$") ? text.slice(0, caret) : text.slice(1, caret)).toLocaleLowerCase() : null;
}

export function filterSlashCommands(commands: readonly ComposerCommand[], query: string): ComposerCommand[] {
  const search = query.replace(/^\$/u, "").toLocaleLowerCase();
  const order = { hui: -1, extension: 0, skill: 1, prompt: 2 };
  return commands.filter((command) => (!query.startsWith("$") || (command.source === "skill" || command.source === "extension")) &&
    `${command.name} ${command.description} ${command.source}`.toLocaleLowerCase().includes(search),
  ).sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name));
}

/** Preserve existing arguments when completing a command edited in place. */
export function completeSlashCommand(text: string, name: string): { text: string; caret: number } {
  const rest = text.replace(/^\/[^\s]*/u, "");
  const suffix = rest || " ";
  const command = `/${name}`;
  return { text: command + suffix, caret: command.length + (suffix.startsWith(" ") ? 1 : 0) };
}

/** Both discovery menus insert the same stable alias; templates keep their slash syntax. */
export function completeCommandReference(text: string, command: ComposerCommand, catalog: readonly ComposerCommand[]): { text: string; caret: number } {
  const rest = text.replace(/^[/$][^\s]*/u, "") || " ";
  const reference = commandReference(command, catalog);
  return { text: reference + rest, caret: reference.length + (rest.startsWith(" ") ? 1 : 0) };
}
