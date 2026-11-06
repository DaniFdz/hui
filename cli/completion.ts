/** Shell completion for `hui`: the candidates a shell may offer for the words typed so far, and the bash and zsh
 * programs that ask for them (`cli/completions/`). Both read `cli/commands.ts`, so the words offered are the words
 * `parseCli` accepts, and the programs ask the CLI at every Tab instead of caching a list that a new release would
 * leave behind. */
import { readFile } from "node:fs/promises";
import { BOT_FACE_COLORS, BOT_FACE_EARS, BOT_FACE_SHAPES, BOT_TAGGING, BOT_THINKING_LEVELS } from "../server/bots-format.ts";
import { GPT_LIVE_VOICES } from "../server/calls-format.ts";
import { COMMAND_ALIASES, COMMAND_FLAGS } from "./commands.ts";

/** The shells `hui completion <shell>` prints a program for. */
export const COMPLETION_SHELLS = ["bash", "zsh"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

/** The program `cli/completions/` holds for each shell. */
const COMPLETION_FILES: Readonly<Record<CompletionShell, string>> = { bash: "hui.bash", zsh: "_hui" };

/** The values a flag takes, for the flags whose list the CLI already validates. */
const FLAG_VALUES: Readonly<Record<string, readonly string[]>> = {
  thinking: BOT_THINKING_LEVELS, tagging: BOT_TAGGING, shape: BOT_FACE_SHAPES, ears: BOT_FACE_EARS,
  color: BOT_FACE_COLORS.map((color) => color.id), "call-voice": GPT_LIVE_VOICES,
};

/** Words a command takes where no command is named, such as the shell `hui completion` prints a program for. */
const OPERAND_VALUES: Readonly<Record<string, readonly string[]>> = { completion: COMPLETION_SHELLS };

export function isCompletionShell(value: unknown): value is CompletionShell {
  return typeof value === "string" && (COMPLETION_SHELLS as readonly string[]).includes(value);
}

/**
 * What a shell should offer for `words`: the words typed after `hui`, the last one being what Tab completes.
 * Candidates are ordered and deduplicated; an empty answer means the shell falls back to its own (file names).
 */
export function completionCandidates(words: readonly string[], commands: Readonly<Record<string, readonly string[]>> = COMMAND_FLAGS): string[] {
  const partial = words.at(-1) ?? "";
  // `bots` and `schedules` name the same commands as `bot` and `schedule`.
  const typed = words.slice(0, -1).map((word, index) => (index === 0 ? COMMAND_ALIASES[word] ?? word : word));
  const previous = typed.at(-1) ?? "";
  const values = previous.startsWith("--") ? FLAG_VALUES[previous.slice(2)] : undefined;
  if (values && !partial.startsWith("-")) return prefixed(values, partial);
  if (partial.startsWith("-")) {
    const command = commandFor(typed, commands);
    return command ? prefixed(commands[command]!.map((flag) => `--${flag}`), partial) : [];
  }
  const prefix = typed.join(" ");
  const subcommands = new Set<string>();
  for (const key of Object.keys(commands)) {
    if (!prefix) subcommands.add(key.split(" ")[0]!);
    else if (key.startsWith(`${prefix} `)) subcommands.add(key.slice(prefix.length + 1).split(" ")[0]!);
  }
  if (!prefix) for (const alias of Object.keys(COMMAND_ALIASES)) subcommands.add(alias);
  // Only a command with no subcommand of its own reads words of its own.
  const operands = subcommands.size ? [] : OPERAND_VALUES[prefix] ?? [];
  return prefixed([...subcommands, ...operands], partial);
}

/** The entry whose flags apply here: the command typed, or the subcommand it reads when given none, as `hui gateway`
 * runs the gateway and `hui bot` lists bots. */
function commandFor(words: readonly string[], commands: Readonly<Record<string, readonly string[]>>): string | undefined {
  const joined = words.join(" ");
  if (joined in commands) return joined;
  for (const verb of ["run", "list"]) if (`${joined} ${verb}` in commands) return `${joined} ${verb}`;
  return undefined;
}

function prefixed(candidates: readonly string[], partial: string): string[] {
  return [...new Set(candidates.filter((candidate) => candidate.startsWith(partial)))].sort();
}

/** The completion program for a shell: installed by the package or printed by `hui completion <shell>`. */
export async function completionScript(shell: CompletionShell): Promise<string> {
  return readFile(new URL(`completions/${COMPLETION_FILES[shell]}`, import.meta.url), "utf8");
}

/** The shell `hui completion` was asked for, refused when it names none this CLI has a program for. */
export function completionShell(value: string | undefined): CompletionShell {
  if (!isCompletionShell(value)) throw new Error(`hui completion takes one shell: ${COMPLETION_SHELLS.join(" or ")}.`);
  return value;
}
