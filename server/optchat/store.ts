/**
 * OptChat's storage (spec section 2): two append-only JSONL streams in one
 * directory, `main/` for the log (one message per line) and `tree/` for the
 * summaries (one node per line). A line goes to the file of the local day it is
 * written on; ids are global. Each line is one write followed by an fsync before
 * the append resolves, so a crash loses nothing written. A torn line (a crash
 * mid-write) is reported and skipped at load, and a file left without a final
 * newline gets one before its next line. Nothing here edits or deletes a line:
 * the log is history. One writer per directory: the owner holds a lock (HUI's
 * gateway holds its Durable store lock, which covers this directory).
 */
import { mkdir, open, readdir, readFile, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { localDay } from "./text.ts";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/** user: the user's words; talk: the agent's replies; tool: its calls; echo: their results; note: imported memories. */
export type Kind = "user" | "talk" | "tool" | "echo" | "note";
export const KINDS: readonly Kind[] = ["user", "talk", "tool", "echo", "note"];
/** One message; `size` is the bytes of `kind: text`, `date` ISO time, `src` the integration's own metadata. */
export type MessageLine = { i: number; kind: Kind; text: string; size: number; date: string; src?: JsonValue };
/** One summary node; `size` is the bytes of `text`. */
export type NodeLine = { l: number; i: number; text: string; size: number };
/** Reports a problem the load or a write recovered from. */
export type Report = (problem: string) => void;

const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/u;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isIndex = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isMessage = (value: unknown): value is MessageLine => isRecord(value) && isIndex(value["i"])
  && KINDS.includes(value["kind"] as Kind) && typeof value["text"] === "string" && typeof value["size"] === "number"
  && typeof value["date"] === "string";
const isNode = (value: unknown): value is NodeLine => isRecord(value) && isIndex(value["l"]) && isIndex(value["i"])
  && typeof value["text"] === "string" && typeof value["size"] === "number";

/** Directory fsync makes a new file's name durable; platforms without it (EISDIR, EINVAL) are best effort. */
export async function syncDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (!["EISDIR", "EINVAL", "EPERM", "EBADF"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  } finally {
    await handle?.close();
  }
}

/** The JSON lines of a file, oldest first, skipping torn ones; `terminated` when it ends with a newline. */
export async function readLines(path: string, report: Report): Promise<{ values: unknown[]; terminated: boolean }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { values: [], terminated: true };
    throw error;
  }
  const values: unknown[] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    try { values.push(JSON.parse(line)); }
    catch { report(`${path}:${index + 1}: skipped a torn line of ${line.length} characters`); }
  });
  return { values, terminated: text === "" || text.endsWith("\n") };
}

/** One append-only JSONL file: each line is one write and an fsync. */
export class LineFile {
  readonly path: string;
  #handle: FileHandle | undefined;
  #terminated: boolean;

  /** `terminated` false: the file ends mid-line (a torn write), so the next line starts with a newline of its own. */
  constructor(path: string, terminated = true) {
    this.path = path;
    this.#terminated = terminated;
  }

  async append(value: unknown): Promise<void> {
    const line = `${this.#terminated ? "" : "\n"}${JSON.stringify(value)}\n`;
    let created = false;
    if (!this.#handle) {
      this.#handle = await open(this.path, "a", 0o600);
      created = (await this.#handle.stat()).size === 0;
    }
    try {
      const { bytesWritten } = await this.#handle.write(line);
      if (bytesWritten !== Buffer.byteLength(line)) throw new Error(`Short write to ${this.path}`);
      await this.#handle.sync();
    } catch (error) {
      // Whatever reached the disk, the next line must start on a line of its own.
      this.#terminated = false;
      throw error;
    }
    this.#terminated = true;
    if (created) await syncDirectory(dirname(this.path));
  }

  async close(): Promise<void> {
    const handle = this.#handle;
    this.#handle = undefined;
    await handle?.close();
  }
}

/** A stream split into one file per local day; only the current day's file stays open. */
class DayStream {
  readonly #dir: string;
  readonly #unterminated: Set<string>;
  #file: LineFile | undefined;

  constructor(dir: string, unterminated: Set<string>) {
    this.#dir = dir;
    this.#unterminated = unterminated;
  }

  async append(value: unknown, now: Date): Promise<void> {
    const path = join(this.#dir, `${localDay(now)}.jsonl`);
    if (this.#file?.path !== path) {
      await this.#file?.close();
      this.#file = new LineFile(path, !this.#unterminated.delete(path));
    }
    await this.#file.append(value);
  }

  async close(): Promise<void> {
    await this.#file?.close();
    this.#file = undefined;
  }

  /** Every line of the stream, in file (day) order, and the files that end mid-line. */
  static async load(dir: string, report: Report): Promise<{ values: unknown[]; unterminated: Set<string> }> {
    const names = (await readdir(dir)).filter((name) => DAY_FILE.test(name)).sort();
    const values: unknown[] = [];
    const unterminated = new Set<string>();
    for (const name of names) {
      const path = join(dir, name);
      const lines = await readLines(path, report);
      values.push(...lines.values);
      if (!lines.terminated) unterminated.add(path);
    }
    return { values, unterminated };
  }
}

export type StoreContents = { readonly messages: MessageLine[]; readonly nodes: NodeLine[] };

export class Store {
  readonly #main: DayStream;
  readonly #tree: DayStream;
  readonly #now: () => Date;
  /** Writes run one at a time, in call order, whichever stream they go to. */
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(main: DayStream, tree: DayStream, now: () => Date) {
    this.#main = main;
    this.#tree = tree;
    this.#now = now;
  }

  /** Opens (creating) the directory and loads both streams. A gap in the message ids means lost history: refused. */
  static async open(dir: string, options: { now: () => Date; report: Report }): Promise<{ store: Store } & StoreContents> {
    const mainDir = join(dir, "main");
    const treeDir = join(dir, "tree");
    await mkdir(mainDir, { recursive: true, mode: 0o700 });
    await mkdir(treeDir, { recursive: true, mode: 0o700 });
    const main = await DayStream.load(mainDir, options.report);
    const tree = await DayStream.load(treeDir, options.report);
    const valid = <T>(values: unknown[], check: (value: unknown) => value is T, where: string): T[] => values.filter((value): value is T => {
      if (check(value)) return true;
      options.report(`${where}: skipped a malformed line`);
      return false;
    });
    const messages: MessageLine[] = [];
    // A clock set back can put a later id in an earlier day's file: order by id (stable), and the first line wins.
    for (const line of valid(main.values, isMessage, mainDir).sort((a, b) => a.i - b.i)) {
      if (line.i < messages.length) { options.report(`${mainDir}: skipped a second message ${line.i}`); continue; }
      if (line.i > messages.length) throw new Error(`OptChat log ${mainDir} has no message ${messages.length}`);
      messages.push(line);
    }
    const nodes = valid(tree.values, isNode, treeDir);
    return { store: new Store(new DayStream(mainDir, main.unterminated), new DayStream(treeDir, tree.unterminated), options.now), messages, nodes };
  }

  #enqueue(write: () => Promise<void>): Promise<void> {
    const run = this.#queue.then(write);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  appendMessage(line: MessageLine): Promise<void> {
    return this.#enqueue(() => this.#main.append(line, this.#now()));
  }

  appendNode(line: NodeLine): Promise<void> {
    return this.#enqueue(() => this.#tree.append(line, this.#now()));
  }

  /** Waits for queued writes, then closes the files. */
  async close(): Promise<void> {
    await this.#queue;
    await this.#main.close();
    await this.#tree.close();
  }
}
