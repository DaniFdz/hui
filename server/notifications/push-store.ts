/**
 * The gateway's own Web Push state: one VAPID keypair and the browser subscriptions HUI sends to, under
 * `CONFIG_DIR/notifications` at mode 0600. The keypair is generated once and reused forever, so a phone that
 * subscribed keeps receiving HUI's pushes across restarts. A subscription's endpoint is a capability URL and its keys
 * are secrets, so nothing here puts either in an error; a file that is missing or corrupt reads as the empty state,
 * as HUI's settings do, and nothing here creates a keypair until a caller asks for one.
 */
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_DIR } from "../paths.ts";

import type { PushSubscriptionRecord, VapidKeys } from "./push.ts";
import { isLoopbackEndpointHost } from "./push.ts";
export type { PushSubscriptionRecord, VapidKeys } from "./push.ts";

export type StoredPushSubscription = PushSubscriptionRecord & {
  /** A digest of the endpoint, so a view can name a device without carrying its capability URL. */
  id: string;
  createdAt: string;
  /** What the operator calls this device, when the browser said. */
  device?: string;
};

/** Beyond this many subscriptions, adding one drops the oldest: a device list no one can prune is its own bug. */
export const MAX_PUSH_SUBSCRIPTIONS = 20;

/** The short id a view or a route uses for one device: never the endpoint, and never reversible. */
export function pushSubscriptionId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

const vapidKeypairs = new Map<string, Promise<VapidKeys>>();
const subscriptionQueues = new Map<string, Promise<unknown>>();

const notificationsDir = (dir: string): string => join(dir, "notifications");
const vapidFile = (dir: string): string => join(notificationsDir(dir), "vapid.json");
const subscriptionsFile = (dir: string): string => join(notificationsDir(dir), "push-subscriptions.json");

/** The gateway's VAPID keypair, generated on first use. Concurrent callers share one in-flight generation. */
export function vapidKeys(dir: string = CONFIG_DIR): Promise<VapidKeys> {
  const file = vapidFile(dir);
  const pending = vapidKeypairs.get(file);
  if (pending) return pending;
  const next = loadOrCreateVapidKeys(file);
  vapidKeypairs.set(file, next);
  // A failed generation is not cached: the next caller tries again instead of reusing the rejection.
  void next.catch(() => {
    if (vapidKeypairs.get(file) === next) vapidKeypairs.delete(file);
  });
  return next;
}

export async function listPushSubscriptions(dir: string = CONFIG_DIR): Promise<StoredPushSubscription[]> {
  const raw = await readJson(subscriptionsFile(dir));
  const listed = typeof raw === "object" && raw !== null ? (raw as { subscriptions?: unknown }).subscriptions : undefined;
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((entry) => {
    const record = storedSubscription(entry);
    return record ? [record] : [];
  });
}

/** Registers one browser. The same endpoint again replaces its key set, which is what a browser rotation is. */
export async function addPushSubscription(
  subscription: PushSubscriptionRecord & { device?: string },
  dir: string = CONFIG_DIR,
): Promise<StoredPushSubscription> {
  if (!isPushEndpoint(subscription.endpoint)) throw new Error("A push subscription endpoint must be an https: URL, or a loopback http: one.");
  const { p256dh, auth } = subscription.keys;
  if (!p256dh || !auth) throw new Error("A push subscription needs its p256dh and auth keys.");
  const saved = await changeSubscriptions(dir, (current) => upsert(current, { ...subscription, keys: { p256dh, auth } }));
  const record = saved.find((entry) => entry.endpoint === subscription.endpoint);
  if (!record) throw new Error("Could not save the push subscription.");
  return record;
}

export async function removePushSubscription(endpoint: string, dir: string = CONFIG_DIR): Promise<void> {
  await changeSubscriptions(dir, (current) => (current.some((entry) => entry.endpoint === endpoint) ? current.filter((entry) => entry.endpoint !== endpoint) : current));
}

/** Drops the subscriptions a push service said are gone (404/410), and keeps every other one. */
export async function prunePushSubscriptions(endpoints: readonly string[], dir: string = CONFIG_DIR): Promise<void> {
  const gone = new Set(endpoints);
  if (!gone.size) return;
  await changeSubscriptions(dir, (current) => (current.some((entry) => gone.has(entry.endpoint)) ? current.filter((entry) => !gone.has(entry.endpoint)) : current));
}

async function loadOrCreateVapidKeys(file: string): Promise<VapidKeys> {
  const stored = vapidKeysFrom(await readJson(file));
  if (stored) return stored;
  const created = generateVapidKeys();
  await writeJson(file, created);
  return created;
}

/** A fresh P-256 pair as the raw material the protocol needs: the 32-byte scalar and its uncompressed point. */
function generateVapidKeys(): VapidKeys {
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
  if (!jwk.d || !jwk.x || !jwk.y) throw new Error("Could not export a P-256 VAPID key.");
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return { publicKey: point.toString("base64url"), privateKey: jwk.d };
}

function vapidKeysFrom(raw: unknown): VapidKeys | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { publicKey, privateKey } = raw as Partial<VapidKeys>;
  if (typeof publicKey !== "string" || typeof privateKey !== "string") return undefined;
  if (Buffer.from(publicKey, "base64url").length !== 65 || Buffer.from(privateKey, "base64url").length !== 32) return undefined;
  return { publicKey, privateKey };
}

/** A stored subscription, or nothing when the entry is not one HUI could send to. */
function storedSubscription(raw: unknown): StoredPushSubscription | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { endpoint, keys, createdAt, device } = raw as Partial<StoredPushSubscription>;
  if (typeof endpoint !== "string" || !isPushEndpoint(endpoint) || typeof keys !== "object" || keys === null) return undefined;
  const { p256dh, auth } = keys as Partial<PushSubscriptionRecord["keys"]>;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !p256dh || !auth) return undefined;
  return {
    endpoint,
    keys: { p256dh, auth },
    id: pushSubscriptionId(endpoint),
    createdAt: typeof createdAt === "string" ? createdAt : new Date(0).toISOString(),
    ...(typeof device === "string" && device ? { device } : {}),
  };
}

/** A push endpoint is an `https:` URL, or a loopback `http:` one for a push service on the gateway's own machine: any
 * other scheme cannot be a push service, and credentials do not belong in one. */
function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (!url.hostname || url.username || url.password) return false;
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackEndpointHost(url.hostname));
  } catch {
    return false;
  }
}

/** The list with this subscription added, its old key set replaced, and the oldest dropped once the list is full. */
function upsert(current: StoredPushSubscription[], subscription: PushSubscriptionRecord & { device?: string }): StoredPushSubscription[] {
  const existing = current.find((entry) => entry.endpoint === subscription.endpoint);
  const device = subscription.device || existing?.device;
  const record: StoredPushSubscription = {
    endpoint: subscription.endpoint,
    keys: { ...subscription.keys },
    id: pushSubscriptionId(subscription.endpoint),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    ...(device ? { device } : {}),
  };
  const others = current.filter((entry) => entry.endpoint !== subscription.endpoint);
  // A replacement always has room: it is the same device. Only a new device can push the list over its bound.
  const kept = existing || others.length < MAX_PUSH_SUBSCRIPTIONS ? others : [...others].sort(byCreatedAt).slice(-(MAX_PUSH_SUBSCRIPTIONS - 1));
  return [...kept, record];
}

const byCreatedAt = (a: StoredPushSubscription, b: StoredPushSubscription): number => a.createdAt.localeCompare(b.createdAt);

/** Reads, changes and writes the list once, after any change already running for the same file. */
function changeSubscriptions(
  dir: string,
  change: (current: StoredPushSubscription[]) => StoredPushSubscription[],
): Promise<StoredPushSubscription[]> {
  const file = subscriptionsFile(dir);
  const before = subscriptionQueues.get(file) ?? Promise.resolve();
  const next = before.catch(() => undefined).then(async () => {
    const current = await listPushSubscriptions(dir);
    const listed = change(current);
    if (listed !== current) await writeJson(file, { subscriptions: listed });
    return listed;
  });
  subscriptionQueues.set(file, next);
  void next.catch(() => undefined).finally(() => {
    if (subscriptionQueues.get(file) === next) subscriptionQueues.delete(file);
  });
  return next;
}

/** Parsed contents, or nothing: a file that is missing or corrupt is the empty state, never an error. */
async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Writes HUI's private state atomically and at mode 0600, renaming into place so no reader sees half a file. */
async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
