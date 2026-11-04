/**
 * The browser state one machine hands to another: cookies, and the per-origin
 * localStorage and IndexedDB a page keeps a login in. Settings → Tools →
 * Browser's "Mirror browser state" decides whether a browser exports this and
 * seeds itself from it; `browser/manager.ts` reads and writes it through the
 * DevTools protocol, so no profile file, its format or its encryption is ever
 * touched. Documents merge by identity (a cookie by domain, path and name; a
 * storage key by origin and key) with the newest capture winning; a login made
 * on either machine therefore reaches the other, and a sign-out does not (its
 * absence cannot be told apart from never having been there). Page values travel
 * as the small tagged JSON `STATE_CAPTURE` writes, so Dates, binaries, Blobs,
 * Maps and Sets survive the trip.
 */

/** A cookie as `Storage.getCookies` returns it, without what only describes one machine. */
export type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  /** When this value was captured; the newer one wins a merge. */
  at: number;
};

export type StoredValue = { key: string; value: string | null; at: number };

export type StoredRecord = { key: string; value: string; at: number };

export type StoredStore = { name: string; records: StoredRecord[] };

export type StoredDatabase = { name: string; version: number; stores: StoredStore[] };

export type StoredOrigin = {
  origin: string;
  at: number;
  localStorage: StoredValue[];
  indexedDB: StoredDatabase[];
  /** What this machine could not carry, for the session's status line. */
  skipped: string[];
};

export type BrowserState = { cookies: StoredCookie[]; origins: StoredOrigin[] };

export const EMPTY_BROWSER_STATE: BrowserState = { cookies: [], origins: [] };
/** A mirror stays small: past this, the oldest origins go before any cookie does. */
export const MAX_STATE_BYTES = 2 * 1024 * 1024;
/** Anything read from a file or a worker's frame: only what the document can hold comes through, bounded. */
export function normalizeBrowserState(value: unknown): BrowserState {
  if (typeof value !== "object" || value === null) return EMPTY_BROWSER_STATE;
  const record = (item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item);
  const text = (item: unknown) => typeof item === "string" ? item.slice(0, 100_000) : "";
  const number = (item: unknown) => typeof item === "number" && Number.isFinite(item) ? item : 0;
  const strings = (item: unknown) => Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string").slice(0, 20) : [];
  const cookies = (Array.isArray((value as { cookies?: unknown }).cookies) ? (value as { cookies: unknown[] }).cookies : []).filter(record).flatMap((cookie) => {
    const name = text(cookie["name"]);
    const domain = text(cookie["domain"]);
    if (!name || !domain) return [];
    const sameSite: StoredCookie["sameSite"] = cookie["sameSite"] === "Strict" || cookie["sameSite"] === "Lax" || cookie["sameSite"] === "None" ? cookie["sameSite"] : undefined;
    return [{
      name, domain, value: text(cookie["value"]), path: text(cookie["path"]) || "/", at: number(cookie["at"]),
      ...(typeof cookie["expires"] === "number" ? { expires: number(cookie["expires"]) } : {}),
      ...(cookie["httpOnly"] === true ? { httpOnly: true } : {}),
      ...(cookie["secure"] === true ? { secure: true } : {}),
      ...(sameSite ? { sameSite } : {}),
    }];
  }).slice(0, 2_000);
  const origins = (Array.isArray((value as { origins?: unknown }).origins) ? (value as { origins: unknown[] }).origins : []).filter(record).flatMap((origin) => {
    const url = text(origin["origin"]);
    if (!isHttpOrigin(url)) return [];
    return [{
      origin: url, at: number(origin["at"]), skipped: strings(origin["skipped"]),
      localStorage: (Array.isArray(origin["localStorage"]) ? origin["localStorage"] : []).filter(record).flatMap((entry) =>
        typeof entry["key"] === "string" ? [{ key: text(entry["key"]), value: typeof entry["value"] === "string" ? text(entry["value"]) : null, at: number(entry["at"]) }] : []),
      indexedDB: (Array.isArray(origin["indexedDB"]) ? origin["indexedDB"] : []).filter(record).flatMap((database) =>
        typeof database["name"] === "string" ? [{
          name: text(database["name"]), version: Math.max(1, number(database["version"])),
          stores: (Array.isArray(database["stores"]) ? database["stores"] : []).filter(record).flatMap((store) =>
            typeof store["name"] === "string" ? [{
              name: text(store["name"]),
              records: (Array.isArray(store["records"]) ? store["records"] : []).filter(record).flatMap((item) =>
                typeof item["key"] === "string" && typeof item["value"] === "string" ? [{ key: text(item["key"]), value: text(item["value"]), at: number(item["at"]) }] : []),
            }] : []),
        }] : []),
    }];
  }).slice(0, 200);
  return { cookies, origins };
}

export const isHttpOrigin = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
};

export function sizeOf(state: BrowserState): number {
  return Buffer.byteLength(JSON.stringify(state));
}

const cookieId = (cookie: StoredCookie) => `${cookie.domain}\u0000${cookie.path}\u0000${cookie.name}`;

/** Newest capture wins per cookie and per storage key; nothing is ever deleted. */
export function mergeBrowserState(base: BrowserState, incoming: BrowserState): BrowserState {
  const cookies = new Map<string, StoredCookie>();
  for (const cookie of [...base.cookies, ...incoming.cookies]) {
    const known = cookies.get(cookieId(cookie));
    if (!known || (cookie.at ?? 0) >= (known.at ?? 0)) cookies.set(cookieId(cookie), cookie);
  }
  const origins = new Map<string, StoredOrigin>();
  for (const origin of [...base.origins, ...incoming.origins]) {
    const known = origins.get(origin.origin);
    origins.set(origin.origin, known ? mergeOrigin(known, origin) : origin);
  }
  return { cookies: [...cookies.values()], origins: [...origins.values()] };
}

function mergeOrigin(base: StoredOrigin, incoming: StoredOrigin): StoredOrigin {
  const localStorage = new Map(base.localStorage.map((entry) => [entry.key, entry]));
  for (const entry of incoming.localStorage) {
    const known = localStorage.get(entry.key);
    if (!known || entry.at >= known.at) localStorage.set(entry.key, entry);
  }
  const databases = new Map(base.indexedDB.map((database) => [database.name, database]));
  for (const database of incoming.indexedDB) {
    const known = databases.get(database.name);
    databases.set(database.name, known ? mergeDatabase(known, database) : database);
  }
  return {
    origin: base.origin,
    at: Math.max(base.at, incoming.at),
    localStorage: [...localStorage.values()],
    indexedDB: [...databases.values()],
    skipped: [...new Set([...base.skipped, ...incoming.skipped])],
  };
}

function mergeDatabase(base: StoredDatabase, incoming: StoredDatabase): StoredDatabase {
  const stores = new Map(base.stores.map((store) => [store.name, store]));
  for (const store of incoming.stores) {
    const known = stores.get(store.name);
    if (!known) {
      stores.set(store.name, store);
      continue;
    }
    const records = new Map(known.records.map((record) => [record.key, record]));
    for (const record of store.records) {
      const knownRecord = records.get(record.key);
      if (!knownRecord || record.at >= knownRecord.at) records.set(record.key, record);
    }
    stores.set(store.name, { name: store.name, records: [...records.values()] });
  }
  return { name: base.name, version: Math.max(base.version, incoming.version), stores: [...stores.values()] };
}

/** The newest origins first, within the mirror's budget; cookies always stay, since a login is what this is for. */
export function trimBrowserState(state: BrowserState, maximum = MAX_STATE_BYTES): BrowserState {
  if (sizeOf(state) <= maximum) return state;
  const origins = [...state.origins].sort((a, b) => b.at - a.at);
  while (origins.length > 1 && sizeOf({ cookies: state.cookies, origins }) > maximum) origins.pop();
  const trimmed = { cookies: state.cookies, origins };
  if (sizeOf(trimmed) <= maximum) return trimmed;
  const cookies = [...state.cookies].sort((a, b) => b.at - a.at);
  while (cookies.length > 0 && sizeOf({ cookies, origins }) > maximum) cookies.pop();
  return { cookies, origins };
}

// ── Page-side scripts ────────────────────────────────────────────────────────

const BASE64 = String.raw`function (bytes) {
  let text = "";
  const view = new Uint8Array(bytes);
  for (let at = 0; at < view.length; at += 0x8000) text += String.fromCharCode(...view.subarray(at, at + 0x8000));
  return btoa(text);
}`;

/** Runs in a tab of the origin: what its localStorage and IndexedDB hold right now. */
export const STATE_CAPTURE = String.raw`async function () {
  const bytes = ${BASE64};
  const encode = async (value, depth = 8) => {
    const tag = (kind, body) => ({ t: kind, v: body });
    if (value === undefined) return tag("undefined");
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return tag("bigint", String(value));
    if (value instanceof Date) return tag("date", value.toISOString());
    if (value instanceof ArrayBuffer) return tag("bin", bytes(value));
    if (ArrayBuffer.isView(value)) return tag("bin", bytes(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
    if (typeof Blob !== "undefined" && value instanceof Blob) return { t: "blob", mime: value.type, v: bytes(await value.arrayBuffer()) };
    if (depth <= 0) return tag("deep");
    if (value instanceof Map) { const items = []; for (const [key, item] of value) items.push([await encode(key, depth - 1), await encode(item, depth - 1)]); return tag("map", items); }
    if (value instanceof Set) { const items = []; for (const item of value) items.push(await encode(item, depth - 1)); return tag("set", items); }
    if (Array.isArray(value)) { const items = []; for (const item of value) items.push(await encode(item, depth - 1)); return items; }
    if (typeof value === "object") { const body = {}; for (const [key, item] of Object.entries(value)) body[key] = await encode(item, depth - 1); return tag("obj", body); }
    return tag("skip");
  };
  const skipped = [];
  const localStorageEntries = [];
  for (let at = 0; at < localStorage.length; at += 1) {
    const key = localStorage.key(at);
    if (key !== null) localStorageEntries.push([key, localStorage.getItem(key)]);
  }
  const indexedDBEntries = [];
  let names = [];
  try { names = await indexedDB.databases(); } catch { skipped.push("indexedDB.databases"); }
  for (const info of names) {
    if (!info.name) continue;
    const database = await new Promise((done) => {
      const request = info.version ? indexedDB.open(info.name, info.version) : indexedDB.open(info.name);
      request.onerror = () => done(undefined);
      // Reading never upgrades: a version the page has not opened yet is not ours to create.
      request.onupgradeneeded = () => { request.transaction.abort(); };
      request.onsuccess = () => done(request.result);
    }).catch(() => undefined);
    if (!database) { skipped.push("indexedDB " + info.name); continue; }
    const stores = [];
    for (const storeName of database.objectStoreNames) {
      const records = await new Promise((done) => {
        const transaction = database.transaction(storeName, "readonly");
        const target = transaction.objectStore(storeName);
        const values = target.getAll();
        const keys = target.getAllKeys();
        transaction.oncomplete = () => done([values.result, keys.result]);
        transaction.onerror = transaction.onabort = () => done(undefined);
      }).catch(() => undefined);
      if (!records) { skipped.push("indexedDB " + info.name + "/" + storeName); continue; }
      const encoded = [];
      for (let at = 0; at < records[0].length; at += 1) {
        encoded.push({ key: JSON.stringify(await encode(records[1][at])), value: JSON.stringify(await encode(records[0][at])) });
      }
      stores.push({ name: storeName, records: encoded });
    }
    database.close();
    indexedDBEntries.push({ name: database.name, version: database.version, stores });
  }
  return { localStorage: localStorageEntries, indexedDB: indexedDBEntries, skipped };
}`;

/** Runs in a tab of the origin before any page: writes that origin's stored state back. */
export const STATE_SEED = String.raw`async function (payload) {
  const decoded = (value) => {
    const bytes = (text) => {
      const raw = atob(text);
      const view = new Uint8Array(raw.length);
      for (let at = 0; at < raw.length; at += 1) view[at] = raw.charCodeAt(at);
      return view;
    };
    const walk = (item) => {
      if (item === null || typeof item !== "object") return item;
      if (Array.isArray(item)) return item.map(walk);
      switch (item.t) {
        case "undefined": return undefined;
        case "bigint": return BigInt(item.v);
        case "date": return new Date(item.v);
        case "bin": return bytes(item.v).buffer;
        case "blob": return new Blob([bytes(item.v)], { type: item.mime });
        case "map": return new Map(item.v.map(([key, value]) => [walk(key), walk(value)]));
        case "set": return new Set(item.v.map(walk));
        case "obj": return Object.fromEntries(Object.entries(item.v).map(([key, value]) => [key, walk(value)]));
        default: return undefined;
      }
    };
    return walk(value);
  };
  const skipped = [];
  for (const [key, value] of payload.localStorage) {
    try { localStorage.setItem(key, value); } catch { skipped.push("localStorage " + key); }
  }
  for (const database of payload.indexedDB) {
    try {
      const connection = await new Promise((done, fail) => {
        const request = indexedDB.open(database.name, database.version);
        request.onupgradeneeded = () => {
          for (const store of database.stores) if (!request.result.objectStoreNames.contains(store.name)) request.result.createObjectStore(store.name);
        };
        request.onerror = () => fail(request.error);
        request.onsuccess = () => done(request.result);
      });
      for (const store of database.stores) {
        if (!connection.objectStoreNames.contains(store.name)) continue;
        await new Promise((done) => {
          const transaction = connection.transaction(store.name, "readwrite");
          const target = transaction.objectStore(store.name);
          for (const record of store.records) target.put(decoded(JSON.parse(record.value)), decoded(JSON.parse(record.key)));
          transaction.oncomplete = done;
          transaction.onerror = transaction.onabort = done;
        });
      }
      connection.close();
    } catch { skipped.push("indexedDB " + database.name); }
  }
  return skipped;
}`;
