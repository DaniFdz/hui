/**
 * Path completion in the composer: finding the path or `@` mention at the caret, splicing a chosen suggestion
 * back in, and asking the gateway for matches. The browser never reads the filesystem itself.
 */
import { fetchJson } from "./settings-store.ts";

export type LocalPathSuggestion = {
  path: string;
  kind: "directory" | "file";
};

export type LocalPathQuery = {
  input: string;
  start: number;
  end: number;
  mention: boolean;
};

/** Find the path token at the caret; leading slash prefixes also join command discovery. */
export function localPathQuery(
  text: string,
  caret: number,
  selectionEnd = caret,
): LocalPathQuery | null {
  if (caret !== selectionEnd || caret < 1) return null;
  let start = caret;
  while (start > 0 && !/\s/u.test(text[start - 1] ?? "")) start -= 1;
  const token = text.slice(start, caret);
  const mention = token.startsWith("@");
  const input = mention ? token.slice(1) : token;
  if (!mention && !/^(?:\.\.?\/|~\/|\/)/u.test(input)) return null;
  return { input, start, end: caret, mention };
}

export function completeLocalPath(
  text: string,
  query: LocalPathQuery,
  suggestion: LocalPathSuggestion,
): { text: string; caret: number } {
  const replacement = `${query.mention ? "@" : ""}${suggestion.path}`;
  const completed = `${text.slice(0, query.start)}${replacement}${text.slice(query.end)}`;
  return { text: completed, caret: query.start + replacement.length };
}

export async function loadLocalPathSuggestions(cwd: string, input: string): Promise<LocalPathSuggestion[]> {
  const body = await fetchJson<{ paths?: LocalPathSuggestion[] }>(
    `/__hui/local-paths?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(input)}`,
  );
  return body.paths ?? [];
}
