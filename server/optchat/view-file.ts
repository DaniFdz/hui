/**
 * The saved views of an OptChat memory: `view.json` in its directory holds the
 * chat view and the compaction view, each as its parts and whether a batch is
 * under way. A view folded again from the log differs from the live one (nodes
 * built at other moments, a batch at another message), and every cached prefix
 * dies with the old one, so a memory keeps its views here and folds them again
 * only when the file is missing or does not fit the log and the tree. The file is
 * replaced whole: written to a temporary file, synced, renamed over the old one,
 * and the directory synced. Writes are coalesced, so a crash loses at most the
 * latest state; the next open appends the messages logged after the saved one,
 * which costs one cache miss at worst and never a wrong view.
 */
import { open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { syncDirectory } from "./store.ts";
import { endOf, label, startOf, type Part, type Tree } from "./tree.ts";
import type { ViewState } from "./view.ts";

export const VIEW_FILE = "view.json";
const VERSION = 1;
/** A deeper part would cover more than 2^52 messages: no log is that long, and ids stay safe integers. */
const MAX_LEVEL = 52;

/** Both views of a memory. */
export type SavedViews = { readonly chat: ViewState; readonly compaction: ViewState };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isIndex = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** The parsed file, or why it cannot be used: missing, unreadable or not JSON. */
export async function readViews(dir: string): Promise<{ readonly value: unknown } | { readonly problem: string }> {
  let text: string;
  try {
    text = await readFile(join(dir, VIEW_FILE), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { problem: code === "ENOENT" ? `${VIEW_FILE} is missing` : `${VIEW_FILE} could not be read (${code ?? String(error)})` };
  }
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return { problem: `${VIEW_FILE} is not valid JSON` };
  }
}

function viewState(value: unknown, name: string, log: number, tree: Tree): ViewState | string {
  if (!isRecord(value) || !Array.isArray(value["parts"]) || typeof value["batch"] !== "boolean") return `its ${name} view is malformed`;
  const parts: Part[] = [];
  let end = 0;
  for (const part of value["parts"] as unknown[]) {
    if (!Array.isArray(part) || part.length !== 2 || !isIndex(part[0]) || !isIndex(part[1]) || part[0] > MAX_LEVEL) return `its ${name} view holds a malformed part`;
    const checked: Part = [part[0], part[1]];
    if (startOf(checked) !== end) return `its ${name} view does not tile the chat: ${label(checked)} ${end ? `follows message ${end - 1}` : "comes first"}`;
    if (checked[0] > 0 && !tree.has(checked[0], checked[1])) return `its ${name} view holds ${label(checked)}, which is not built`;
    end = endOf(checked);
    parts.push(checked);
  }
  if (end > log) return `its ${name} view covers ${end} messages, but the log holds ${log}`;
  return { parts, batch: value["batch"] };
}

/**
 * The views a file holds, when they fit the memory: each tiles messages [0, V) without a gap, with V at most the log's
 * length and the same for both, and each merged part is a built node. Otherwise why not, for a diagnostic.
 */
export function checkViews(value: unknown, log: number, tree: Tree): SavedViews | string {
  if (!isRecord(value) || value["version"] !== VERSION) return `${VIEW_FILE} has no version ${VERSION}`;
  const chat = viewState(value["chat"], "chat", log, tree);
  if (typeof chat === "string") return chat;
  const compaction = viewState(value["compaction"], "compaction", log, tree);
  if (typeof compaction === "string") return compaction;
  const end = (state: ViewState) => { const last = state.parts.at(-1); return last ? endOf(last) : 0; };
  if (end(chat) !== end(compaction)) return `its views cover ${end(chat)} and ${end(compaction)} messages`;
  return { chat, compaction };
}

/** Writes a memory's views whenever they change, one write at a time, the latest state each time. */
export class ViewFile {
  readonly #path: string;
  readonly #snapshot: () => SavedViews;
  readonly #report: (problem: string, error?: unknown) => void;
  #dirty = false;
  #writing: Promise<void> | undefined;
  #failing = false;

  constructor(dir: string, snapshot: () => SavedViews, report: (problem: string, error?: unknown) => void) {
    this.#path = join(dir, VIEW_FILE);
    this.#snapshot = snapshot;
    this.#report = report;
  }

  /** The views changed: they are written once the work in progress (a batch, say) is done, after any write in flight. */
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

  async #write(views: SavedViews): Promise<void> {
    const temp = `${this.#path}.tmp`;
    try {
      const handle = await open(temp, "w", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ version: VERSION, chat: views.chat, compaction: views.compaction })}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, this.#path);
      await syncDirectory(dirname(this.#path));
      this.#failing = false;
    } catch (error) {
      // The live views stay right; a lost write costs the next open a cache miss at most. Said once per failing spell.
      if (!this.#failing) this.#report(`OptChat could not save ${this.#path}`, error);
      this.#failing = true;
    }
  }
}
