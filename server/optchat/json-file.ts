/**
 * One JSON file a memory keeps beside its log and tree, replaced whole: written
 * to a temporary file, synced, renamed over the old one, and the directory
 * synced. The log and the tree are the append-only history; these files are
 * state derived from it that the next open reads back (the views, and what the
 * compactor spent). Writes are coalesced, so a crash loses at most the latest
 * state and never a correct one, and a failed write is reported once per
 * failing spell rather than on every attempt.
 */
import { open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { syncDirectory } from "./store.ts";

export class JsonFile {
  readonly #path: string;
  readonly #snapshot: () => unknown;
  readonly #report: (problem: string, error?: unknown) => void;
  #dirty = false;
  #writing: Promise<void> | undefined;
  #failing = false;

  constructor(path: string, snapshot: () => unknown, report: (problem: string, error?: unknown) => void) {
    this.#path = path;
    this.#snapshot = snapshot;
    this.#report = report;
  }

  /** The state changed: it is written after any write in flight, once, with the latest state. */
  changed(): void {
    this.#dirty = true;
    this.#writing ??= Promise.resolve().then(() => this.#drain());
  }

  /** Resolves once every change so far is on disk, or failed. */
  async flush(): Promise<void> {
    while (this.#writing) await this.#writing;
  }

  async #drain(): Promise<void> {
    try {
      while (this.#dirty) {
        this.#dirty = false;
        await this.#write(this.#snapshot());
      }
    } finally {
      this.#writing = undefined;
    }
  }

  async #write(value: unknown): Promise<void> {
    const temp = `${this.#path}.tmp`;
    try {
      const handle = await open(temp, "w", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(value)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, this.#path);
      await syncDirectory(dirname(this.#path));
      this.#failing = false;
    } catch (error) {
      // The live state stays right; a lost write costs a stale read at the next open at most.
      if (!this.#failing) this.#report(`OptChat could not save ${this.#path}`, error);
      this.#failing = true;
    }
  }
}
