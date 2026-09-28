import { fetchJson } from "./settings-store.ts";

export async function loadWorkingDirectorySuggestions(input: string): Promise<string[]> {
  const body = await fetchJson<{ directories?: string[] }>(
    `/__hui/directories?q=${encodeURIComponent(input || "~/")}`,
  );
  return body.directories ?? [];
}
