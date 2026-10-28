/** Browser-local reading copies of visited conversations. Metadata stays separate from bounded, text-only rows so
 * restoring the sidebar never reads transcripts. Live questions, actions, media and credentials are not saved. */
import type { SessionGroup, SessionView, TranscriptEntry } from "../../api/sessions.ts";

const DATABASE = "hui-saved-conversations";
const METADATA = "sessions";
const TRANSCRIPTS = "transcripts";
const MAX_SESSIONS = 10;
const MAX_AGE = 7 * 24 * 60 * 60_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 200;
const encoder = new TextEncoder();
let allowedIds: ReadonlySet<string> | undefined;
let writes = Promise.resolve();
let generation = 0;

type SavedMetadata = { session: SessionView; savedAt: number; truncated: boolean };
export type SavedConversation = SavedMetadata & { transcript: TranscriptEntry[] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function savedSession(value: unknown): SessionView | undefined {
  if (!record(value)) return undefined;
  const { id, title, group, cwd, displayCwd, tool, createdAt, updatedAt } = value;
  if (typeof id !== "string" || !id || typeof title !== "string" || typeof group !== "string"
    || typeof cwd !== "string" || typeof displayCwd !== "string" || typeof tool !== "string"
    || typeof createdAt !== "string" || typeof updatedAt !== "string") return undefined;
  const session: SessionView = {
    id, title, group, cwd, displayCwd, tool, createdAt, updatedAt, status: "disconnected",
    stage: value.stage === "implementation" || value.stage === "testing" || value.stage === "done" ? value.stage : "investigation",
    stageOrigin: "default",
    ...(typeof value.icon === "string" ? { icon: value.icon } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.thinking === "string" ? { thinking: value.thinking } : {}),
  };
  return encoder.encode(JSON.stringify(session)).length <= 32 * 1024 ? session : undefined;
}

function metadata(value: unknown): SavedMetadata | undefined {
  if (!record(value) || typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)
    || value.savedAt > Date.now() || Date.now() - value.savedAt >= MAX_AGE || typeof value.truncated !== "boolean") return undefined;
  const session = savedSession(value.session);
  return session ? { session, savedAt: value.savedAt, truncated: value.truncated } : undefined;
}

function textRow(value: unknown): TranscriptEntry | undefined {
  if (!record(value) || value.pending === true || (value.kind === "message" && value.failed === true)) return undefined;
  const id = typeof value.id === "string" ? { id: value.id } : {};
  switch (value.kind) {
    case "message":
      return (value.role === "user" || value.role === "assistant") && typeof value.text === "string"
        ? { kind: "message", ...id, role: value.role, text: value.text } : undefined;
    case "thinking":
      return typeof value.text === "string" ? { kind: "thinking", ...id, text: value.text } : undefined;
    case "tool":
      return typeof value.id === "string" && typeof value.name === "string"
        ? { kind: "tool", id: value.id, name: value.name, ...(typeof value.output === "string" ? { output: value.output } : {}),
            ...(typeof value.failed === "boolean" ? { failed: value.failed } : {}) } : undefined;
    case "compaction":
      return typeof value.summary === "string" && typeof value.tokensBefore === "number" && Number.isFinite(value.tokensBefore)
        ? { kind: "compaction", ...id, summary: value.summary, tokensBefore: value.tokensBefore } : undefined;
    case "error":
      return typeof value.message === "string" ? { kind: "error", ...id, message: value.message } : undefined;
    default: return undefined;
  }
}

function readingCopy(session: SessionView, entries: readonly TranscriptEntry[]): SavedConversation | undefined {
  const safeSession = savedSession(session);
  if (!safeSession) return undefined;
  const transcript: TranscriptEntry[] = [];
  let bytes = encoder.encode(JSON.stringify(safeSession)).length + 128;
  let truncated = entries.length > MAX_ROWS;
  for (let index = entries.length - 1; index >= Math.max(0, entries.length - MAX_ROWS); index -= 1) {
    const row = textRow(entries[index]);
    if (!row) continue;
    const json = JSON.stringify(row);
    if (json.length > MAX_BYTES || bytes + encoder.encode(json).length + 1 > MAX_BYTES) { truncated = true; break; }
    bytes += encoder.encode(json).length + 1;
    transcript.push(row);
  }
  if (entries.length && !transcript.length) return undefined;
  return { session: safeSession, savedAt: Date.now(), truncated, transcript: transcript.reverse() };
}

async function database(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  return new Promise((resolve) => {
    let expired = false;
    const finish = (value: IDBDatabase | undefined) => { clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { expired = true; finish(undefined); }, 2_000);
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(METADATA);
      request.result.createObjectStore(TRANSCRIPTS);
    };
    request.onerror = () => finish(undefined);
    request.onblocked = () => { expired = true; finish(undefined); };
    request.onsuccess = () => {
      if (expired) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      finish(request.result);
    };
  });
}

async function access<T>(mode: IDBTransactionMode, use: (tx: IDBTransaction, done: (value: T) => void) => void): Promise<T | undefined> {
  try {
    const db = await database();
    if (!db) return undefined;
    try {
      return await new Promise<T | undefined>((resolve) => {
        const tx = db.transaction([METADATA, TRANSCRIPTS], mode);
        let result: T | undefined;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => resolve(undefined);
        use(tx, (value) => { result = value; });
      });
    } finally { db.close(); }
  } catch { return undefined; }
}

function mutate(use: (tx: IDBTransaction) => void): Promise<void> {
  writes = writes.then(() => access<void>("readwrite", use)).then(() => undefined);
  return writes;
}

export async function saveConversation(session: SessionView, transcript: readonly TranscriptEntry[]): Promise<void> {
  if (allowedIds && !allowedIds.has(session.id)) return;
  const copy = readingCopy(session, transcript);
  if (!copy) return;
  await mutate((tx) => {
    if (allowedIds && !allowedIds.has(session.id)) return;
    const sessions = tx.objectStore(METADATA);
    const rows = tx.objectStore(TRANSCRIPTS);
    const all = sessions.getAll();
    const keys = sessions.getAllKeys();
    keys.onsuccess = () => {
      const values: unknown[] = all.result;
      const keep = values.map(metadata).filter((value): value is SavedMetadata => value !== undefined && value.session.id !== session.id)
        .sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SESSIONS - 1);
      const ids = new Set(keep.map((value) => value.session.id));
      for (const key of keys.result) if (key !== session.id && !ids.has(String(key))) { sessions.delete(key); rows.delete(key); }
      const { transcript: entries, ...meta } = copy;
      sessions.put(meta, session.id);
      rows.put(entries, session.id);
    };
  });
}

export async function readSavedConversation(id: string): Promise<SavedConversation | undefined> {
  const reading = generation;
  await writes;
  const copy = await access<SavedConversation>("readonly", (tx, done) => {
    const meta = tx.objectStore(METADATA).get(id);
    const entries = tx.objectStore(TRANSCRIPTS).get(id);
    entries.onsuccess = () => {
      const saved = metadata(meta.result);
      const value: unknown = entries.result;
      if (!saved || saved.session.id !== id || (allowedIds && !allowedIds.has(id)) || !Array.isArray(value) || value.length > MAX_ROWS) return;
      const transcript = value.map(textRow);
      if (transcript.some((row) => row === undefined)) return;
      const rows = transcript.filter((row): row is TranscriptEntry => row !== undefined);
      if (encoder.encode(JSON.stringify({ ...saved, transcript: rows })).length <= MAX_BYTES) done({ ...saved, transcript: rows });
    };
  });
  return reading === generation ? copy : undefined;
}

export async function savedConversationGroups(): Promise<SessionGroup[]> {
  const reading = generation;
  await writes;
  const groups = await access<SessionGroup[]>("readwrite", (tx, done) => {
    const store = tx.objectStore(METADATA);
    const all = store.getAll();
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      const values: unknown[] = all.result;
      const valid = values.map(metadata);
      for (const [index, key] of keys.result.entries()) {
        if (!valid[index] || valid[index]?.session.id !== key) {
          store.delete(key);
          tx.objectStore(TRANSCRIPTS).delete(key);
          valid[index] = undefined;
        }
      }
      const sessions = valid.filter((value): value is SavedMetadata => value !== undefined && (!allowedIds || allowedIds.has(value.session.id)))
        .sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SESSIONS).map((value) => value.session);
      const groups = new Map<string, SessionGroup>();
      for (const session of sessions) {
        let group = groups.get(session.group);
        if (!group) { group = { label: session.group, sessions: [] }; groups.set(session.group, group); }
        group.sessions.push(session);
      }
      done([...groups.values()]);
    };
  });
  return reading === generation ? groups ?? [] : [];
}

export async function reconcileSavedConversations(groups: readonly SessionGroup[]): Promise<void> {
  allowedIds = new Set(groups.flatMap((group) => group.sessions.map((session) => session.id)));
  const ids = allowedIds;
  await mutate((tx) => {
    const keys = tx.objectStore(METADATA).getAllKeys();
    keys.onsuccess = () => {
      for (const key of keys.result) if (!ids.has(String(key))) {
        tx.objectStore(METADATA).delete(key);
        tx.objectStore(TRANSCRIPTS).delete(key);
      }
    };
  });
}

export async function forgetConversation(id?: string): Promise<void> {
  generation += 1;
  await mutate((tx) => {
    for (const name of [METADATA, TRANSCRIPTS]) {
      if (id === undefined) tx.objectStore(name).clear();
      else tx.objectStore(name).delete(id);
    }
  });
}
