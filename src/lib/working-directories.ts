/**
 * Directory suggestions for choosing a session's working directory, locally or on a worker. The gateway
 * lists the directories; the browser never touches the filesystem.
 */
import { fetchJson } from "./settings-store.ts";

export async function loadWorkingDirectorySuggestions(input: string, worker?: string): Promise<string[]> {
  const body = await fetchJson<{ directories?: string[] }>(
    `/__hui/directories?q=${encodeURIComponent(input || "~/")}${worker ? `&worker=${encodeURIComponent(worker)}` : ""}`,
  );
  return body.directories ?? [];
}
