/**
 * The device's gateway list in `localStorage`, under one key, as the thin adapter around `gateway-list.ts`: reading the
 * saved list, adding, marking seen and removing through its rules, and telling the page when the list changed. The
 * gateway serving the page is the current one, so it is never stored, renamed or removed here, and storage that
 * refuses to be read (private browsing) reads as an empty list instead of throwing.
 */
import {
  addGateway,
  GATEWAY_LIST_KEY,
  markGatewaySeen,
  readGatewayList,
  removeGateway,
  writeGatewayList,
  type GatewayEntry,
} from "./gateway-list.ts";

/** The slice of `localStorage` this store uses. */
export type GatewayStorage = Pick<Storage, "getItem" | "setItem">;

/** This browser's storage, or `null` where reading it throws (private browsing, a disabled store). */
export function browserGatewayStorage(): GatewayStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export class GatewayStore {
  readonly #storage: GatewayStorage | null;
  readonly #now: () => number;
  readonly #current: string;
  readonly #listeners = new Set<() => void>();
  #entries: GatewayEntry[];

  constructor(options: { storage?: GatewayStorage | null; now?: () => number; current?: string } = {}) {
    this.#storage = options.storage === undefined ? browserGatewayStorage() : options.storage;
    this.#now = options.now ?? Date.now;
    this.#current = normalizeCurrent(options.current ?? globalThis.location?.origin ?? "");
    this.#entries = this.#read();
  }

  /** The gateway that served this page, as an address the list can compare with. */
  get current(): string {
    return this.#current;
  }

  list(): readonly GatewayEntry[] {
    return this.#entries;
  }

  /** Adds or refreshes a gateway this page probed. The current gateway is never stored. */
  add(url: string, name: string): readonly GatewayEntry[] {
    return this.#commit(addGateway(this.#entries, { url, name, lastSeen: this.#now() }, this.#current));
  }

  /** Records another sighting of a gateway and what it calls itself now. */
  markSeen(url: string, name?: string): readonly GatewayEntry[] {
    return this.#commit(markGatewaySeen(this.#entries, url, { name, lastSeen: this.#now() }, this.#current));
  }

  /** Forgets a gateway. The current gateway stays, whatever asked. */
  remove(url: string): readonly GatewayEntry[] {
    return this.#commit(removeGateway(this.#entries, url, this.#current));
  }

  /** Calls `listener` after every change this store makes, so one page's views redraw together. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  #read(): GatewayEntry[] {
    try {
      return readGatewayList(this.#storage?.getItem(GATEWAY_LIST_KEY) ?? null);
    } catch {
      return [];
    }
  }

  #commit(entries: GatewayEntry[]): readonly GatewayEntry[] {
    this.#entries = entries;
    try {
      this.#storage?.setItem(GATEWAY_LIST_KEY, writeGatewayList(entries));
    } catch {
      // Storage full or read-only: the page still shows what it knows until it reloads.
    }
    for (const listener of [...this.#listeners]) listener();
    return entries;
  }
}

/** The origin form the list compares: no trailing slash, so `/` and an empty path are the same gateway. */
function normalizeCurrent(current: string): string {
  return current.replace(/\/+$/u, "");
}
