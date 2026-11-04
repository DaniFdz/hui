/**
 * The enable list for gateway extensions: `extensions.json` beside the config directory, `{ version: 1, enabled: [] }`.
 * A missing file means nothing is enabled; a corrupt one reads as empty and reports why, and is only rewritten when the
 * operator changes something. Writes are atomic and private, like the other HUI stores.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { EXTENSIONS_FILE } from "../paths.ts";
import { extensionId, MAX_ERROR_CHARS } from "./registry.ts";

export const EXTENSIONS_STORE_VERSION = 1;
export const MAX_ENABLED_EXTENSIONS = 64;

export type ExtensionsStore = {
  readonly enabled: readonly string[];
  /** Why the file could not be used, when it exists but does not read. */
  readonly error?: string;
};

/** Sorted, deduped ids the grammar accepts, at most `MAX_ENABLED_EXTENSIONS`. */
export function normalizeEnabled(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = extensionId(entry.trim());
    if (id) ids.add(id);
  }
  return [...ids].sort().slice(0, MAX_ENABLED_EXTENSIONS);
}

export async function readExtensions(path: string = EXTENSIONS_FILE): Promise<ExtensionsStore> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: [] };
    return { enabled: [], error: `extensions.json could not be read: ${message(error)}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { enabled: [], error: "extensions.json is not valid JSON" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { enabled: [], error: "extensions.json must be a JSON object" };
  }
  const record = raw as Record<string, unknown>;
  if (record["version"] !== EXTENSIONS_STORE_VERSION) {
    return { enabled: [], error: `unsupported extensions.json version: ${JSON.stringify(record["version"])}` };
  }
  if (!Array.isArray(record["enabled"])) {
    return { enabled: [], error: "extensions.json needs an enabled array" };
  }
  return { enabled: normalizeEnabled(record["enabled"]) };
}

export async function writeExtensions(enabled: readonly string[], path: string = EXTENSIONS_FILE): Promise<void> {
  const body = `${JSON.stringify({ version: EXTENSIONS_STORE_VERSION, enabled: normalizeEnabled(enabled) }, null, 2)}\n`;
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, body, { mode: 0o600 });
  await rename(temporary, path);
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, MAX_ERROR_CHARS);
}
