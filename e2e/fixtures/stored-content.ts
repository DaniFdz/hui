/** Reads persisted fixture bytes under their stable storage identity: a SQLite WAL and its checkpoint are one database. */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export async function storedContent(root: string, text: string): Promise<string[]> {
  const files = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((file) => !file.startsWith("vite-cache/"));
  const holding = await Promise.all(files.map(async (file) => {
    const bytes = await readFile(join(root, file), "latin1")
      .catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? "" : Promise.reject(error));
    return bytes.includes(text) ? [file.replace(/\.sqlite-(?:wal|shm)$/u, ".sqlite")] : [];
  }));
  return [...new Set(holding.flat())].sort();
}
