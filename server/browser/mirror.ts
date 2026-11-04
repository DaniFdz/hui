/**
 * The browser state this machine mirrors with each worker: one document per
 * worker, side by side with that worker's own, so Settings → Tools → Browser's
 * "Mirror browser state" lends a login made on either side to the other. Each
 * document is private to the operator (0600): it holds live cookies. State
 * travels through this machine and never from one worker to another; a worker's
 * document is only ever read for this machine's browser and updated from it.
 */
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { EMPTY_BROWSER_STATE, mergeBrowserState, normalizeBrowserState, trimBrowserState, type BrowserState } from "./state.ts";
import { writeAtomic } from "../worker/sync-apply.ts";

const WORKER_ID = /^[A-Za-z0-9_-]{1,80}$/u;
const FILE = /^([A-Za-z0-9_-]{1,80})\.json$/u;

export function browserMirrorDir(configDir: string): string {
  return join(configDir, "browser-mirror");
}

/** One machine's mirrored state, in a file only the operator can read. */
export class BrowserStateFile {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async read(): Promise<BrowserState> {
    try {
      return normalizeBrowserState(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      return EMPTY_BROWSER_STATE;
    }
  }

  /** Merges what a browser captured and returns the merged document. */
  async merge(state: BrowserState): Promise<BrowserState> {
    const merged = trimBrowserState(mergeBrowserState(await this.read(), state));
    await writeAtomic(this.path, `${JSON.stringify(merged)}\n`, 0o600);
    return merged;
  }

  remove(): Promise<void> {
    return rm(this.path, { force: true });
  }
}

export class BrowserMirrorStore {
  readonly dir: string;

  constructor(configDir: string) {
    this.dir = browserMirrorDir(configDir);
  }

  /** One worker's document; none means nothing was mirrored with it yet. */
  file(workerId: string): BrowserStateFile {
    if (!WORKER_ID.test(workerId)) throw new Error(`Not a worker id: ${workerId}`);
    return new BrowserStateFile(join(this.dir, `${workerId}.json`));
  }

  read(workerId: string): Promise<BrowserState> {
    return this.file(workerId).read();
  }

  /** Merges what a worker or this machine captured and returns the merged document. */
  merge(workerId: string, state: BrowserState): Promise<BrowserState> {
    return this.file(workerId).merge(state);
  }

  /** Every worker this machine has mirrored with. */
  async workers(): Promise<string[]> {
    const entries = await readdir(this.dir).catch(() => [] as string[]);
    return entries.flatMap((entry) => FILE.exec(entry)?.[1] ?? []);
  }

  /** What this machine's browser seeds itself with: everything mirrored with every worker. */
  async everything(): Promise<BrowserState> {
    let state = EMPTY_BROWSER_STATE;
    for (const workerId of await this.workers()) state = mergeBrowserState(state, await this.read(workerId));
    return trimBrowserState(state);
  }

  /** A removed worker's cookies do not outlive it. */
  forget(workerId: string): Promise<void> {
    return this.file(workerId).remove();
  }
}
