/**
 * Web Push without a dependency: how one notification becomes the body a phone's subscription carries (RFC 8291
 * `aes128gcm`), and how it is authorised as HUI itself (RFC 8292 VAPID). A subscription's endpoint is a capability URL
 * and its `p256dh`/`auth` values are secrets, so nothing here puts either in an error, a log or a diagnostic; the VAPID
 * private key is the gateway's identity and is never printed. Reaching a push service is never on the path of a
 * session: every device's publish goes out with the others, so one service that never answers costs the batch one
 * deadline instead of one per device, and the delivery around it decides what the operator is told.
 */
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type ECDH } from "node:crypto";

/** One browser's subscription, as the page hands it over. */
export type PushSubscriptionRecord = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** What one notification says. `path` is the relative in-app path a tap opens (`/sessions/<id>`), never a URL. */
export type PushMessage = {
  title: string;
  body?: string;
  path: string;
  tag?: string;
  priority?: "low" | "normal" | "high";
};

/** The body a push service carries and the headers that describe it. */
export type SealedPush = { body: Buffer; headers: Record<string, string> };

/** The seam that pins the ephemeral key and salt, so a test can reproduce a published vector byte for byte. */
export type SealSeam = { salt?: Buffer; ecdh?: ECDH };

export type VapidKeys = {
  /** The uncompressed P-256 point (65 bytes) as base64url: what `applicationServerKey` takes. */
  publicKey: string;
  /** The 32-byte P-256 scalar as base64url. Never printed, logged or returned in an error. */
  privateKey: string;
};

export type PushPublishOptions = {
  /** How long the push service keeps the message for a device that is offline. */
  ttlSeconds?: number;
  /** VAPID's `sub`, a contact address for the push service; omitted from the claims when empty. */
  subject?: string;
  now?: Date;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
};

/** RFC 8292 allows a VAPID token to live 12 hours, and no longer. */
const VAPID_TTL_SECONDS = 12 * 60 * 60;
/** The largest record a push service must accept; one HUI notification is far smaller than this. */
const RECORD_SIZE = 4096;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const PUBLISH_TIMEOUT_MS = 10_000;

const b64 = (value: string | Buffer): string => Buffer.from(value).toString("base64url");
const unb64 = (value: string): Buffer => Buffer.from(value, "base64url");

/** One HKDF-SHA256 round, the only KDF this protocol uses. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

/** A fresh P-256 keypair for one message; `generateKeys` returns the point, not the pair, so it is its own step. */
function freshEphemeralKey(): ECDH {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return ecdh;
}

/** The urgency a push service uses to drop a notification under load, from the message's own priority. */
function urgencyOf(priority: PushMessage["priority"]): string {
  return priority === "high" ? "high" : priority === "low" ? "low" : "normal";
}

/**
 * Seals one plaintext as a single `aes128gcm` record (RFC 8188/8291). Exported because the RFC's vector message is not
 * a `PushMessage`: everything else goes through `encryptPushMessage`, which seals the notification's JSON envelope.
 */
export function sealPushPayload(
  plaintext: string | Buffer,
  subscription: PushSubscriptionRecord,
  seam: SealSeam = {},
): SealedPush {
  const userAgentKey = unb64(subscription.keys.p256dh);
  const authSecret = unb64(subscription.keys.auth);
  if (userAgentKey.length !== 65 || userAgentKey[0] !== 4) {
    throw new Error("The push subscription's p256dh key is not an uncompressed P-256 point.");
  }
  if (authSecret.length !== 16) throw new Error("The push subscription's auth secret is not 16 bytes.");
  const salt = seam.salt ?? randomBytes(16);
  if (salt.length !== 16) throw new Error("A push message's salt is 16 bytes.");
  const ephemeral = seam.ecdh ?? freshEphemeralKey();
  const ephemeralKey = ephemeral.getPublicKey();
  const shared = ephemeral.computeSecret(userAgentKey);
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from("WebPush: info\u0000"), userAgentKey, ephemeralKey]), 32);
  const cipher = createCipheriv(
    "aes-128-gcm",
    hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\u0000"), 16),
    hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\u0000"), 12),
  );
  // One record, so the plaintext ends with the padding delimiter of the last record.
  const plain = Buffer.concat([typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext, Buffer.from([2])]);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(ephemeralKey.length, 20);
  return {
    body: Buffer.concat([header, ephemeralKey, ciphertext]),
    headers: { "content-encoding": "aes128gcm", "content-type": "application/octet-stream" },
  };
}

/** One notification as the body a subscription's push service carries, and the headers to post it with. */
export function encryptPushMessage(
  message: PushMessage,
  subscription: PushSubscriptionRecord,
  seam: SealSeam = {},
): SealedPush {
  if (!message.path.startsWith("/") || message.path.startsWith("//")) {
    throw new Error("A push message's path must be a relative in-app path.");
  }
  const sealed = sealPushPayload(JSON.stringify(message), subscription, seam);
  return { body: sealed.body, headers: { ...sealed.headers, urgency: urgencyOf(message.priority) } };
}

/** The RFC 8292 `Authorization` header: `vapid t=<ES256 JWT>,k=<uncompressed point>`. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now: Date = new Date(), subject = ""): string {
  const aud = endpointOrigin(endpoint);
  const scalar = unb64(keys.privateKey);
  if (scalar.length !== 32) throw new Error("The VAPID private key is not a 32-byte P-256 scalar.");
  const pair = createECDH("prime256v1");
  pair.setPrivateKey(scalar);
  // The advertised key is always the point of the signing scalar, so `k=` cannot disagree with the signature.
  const point = pair.getPublicKey();
  if (keys.publicKey && keys.publicKey !== b64(point)) throw new Error("The VAPID public key does not belong to its private key.");
  const jwk = { kty: "EC", crv: "P-256", d: b64(scalar), x: b64(point.subarray(1, 33)), y: b64(point.subarray(33, 65)) };
  const claims = { aud, exp: Math.floor(now.getTime() / 1000) + VAPID_TTL_SECONDS, ...(subject.trim() ? { sub: subject.trim() } : {}) };
  const input = `${b64(JSON.stringify({ typ: "JWT", alg: "ES256" }))}.${b64(JSON.stringify(claims))}`;
  const signature = sign("sha256", Buffer.from(input), { key: createPrivateKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `vapid t=${input}.${b64(signature)},k=${b64(point)}`;
}

/** A push service only this machine can reach: `http://127.0.0.1…` or `http://[::1]…`. The E2E stands a push service
 * up beside the gateway and decrypts what arrives, which cannot have TLS, and no other address may take plain http: a
 * real subscription is always `https:` so its capability URL is never readable on the wire. */
export function isLoopbackEndpointHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "[::1]";
}

/** The push service rejected this endpoint, and the caller may know why by status without this module printing it. */
export class PushPublishError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The push service answered HTTP ${status}.`);
    this.name = "PushPublishError";
    this.status = status;
  }
}

/** The push service no longer knows this subscription (404/410): the caller prunes it and never sends again. */
export class PushGoneError extends PushPublishError {
  constructor(status: number) {
    super(status);
    this.name = "PushGoneError";
  }
}

export function isPushGone(error: unknown): error is PushGoneError {
  return error instanceof PushGoneError;
}

/**
 * Posts one already-sealed message to one subscription. Resolves once the push service accepted it, and throws a
 * sentence that never names the endpoint or its keys; the caller contains the failure and prunes a gone subscription.
 */
export async function publishPush(
  subscription: PushSubscriptionRecord,
  sealed: SealedPush,
  keys: VapidKeys,
  options: PushPublishOptions = {},
): Promise<void> {
  const endpoint = subscription.endpoint;
  endpointOrigin(endpoint);
  const deadline = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(PUBLISH_TIMEOUT_MS)])
    : AbortSignal.timeout(PUBLISH_TIMEOUT_MS);
  const headers = {
    ...sealed.headers,
    ttl: String(options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    authorization: vapidAuthorization(endpoint, keys, options.now, options.subject),
  };
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(sealed.body),
      signal: deadline,
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    throw new Error(`Could not reach the push service: ${withoutEndpoint(error, endpoint)}`);
  }
  // The answer's body is never read: it can echo the request, and nothing here needs it.
  void response.body?.cancel().catch(() => undefined);
  if (response.status >= 200 && response.status < 300) return;
  throw response.status === 404 || response.status === 410 ? new PushGoneError(response.status) : new PushPublishError(response.status);
}

/** What one batch did: how many push services accepted the message, the subscriptions whose service says they are gone
 * (the endpoints the caller prunes, the only thing here that names a subscription), and the first failure that was not
 * a gone one. */
export type PushBatchResult = { sent: number; gone: string[]; failure?: unknown };

/**
 * One message to every subscription at once. Each device gets a body only it can read, and every publish starts before
 * any of them is awaited, so a batch of twenty subscriptions behind a dead push service waits out one deadline rather
 * than twenty. A gone subscription is collected for pruning and is not a failure, and the first other failure is
 * reported once without stopping the others; no rejection here ever names an endpoint or a key.
 */
export async function publishPushBatch(
  subscriptions: readonly PushSubscriptionRecord[],
  message: PushMessage,
  keys: VapidKeys,
  options: PushPublishOptions = {},
): Promise<PushBatchResult> {
  const settled = await Promise.allSettled(subscriptions.map(async (subscription) => {
    // An async body, so a subscription this machine cannot seal is one rejection and not a throw past the others.
    await publishPush(subscription, encryptPushMessage(message, subscription), keys, options);
  }));
  const gone: string[] = [];
  let sent = 0;
  let failure: unknown;
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      sent += 1;
      continue;
    }
    if (!isPushGone(result.reason)) {
      failure ??= result.reason;
      continue;
    }
    const endpoint = subscriptions[index]?.endpoint;
    if (endpoint !== undefined) gone.push(endpoint);
  }
  return { sent, gone, ...(failure === undefined ? {} : { failure }) };
}

/** The origin VAPID audiences name: the only part of an endpoint a push service publishes, and https or a loopback
 * http: URL, which is what a push service on the gateway's own machine can be. */
function endpointOrigin(endpoint: string): string {
  let url: URL | undefined;
  try {
    url = new URL(endpoint);
  } catch {
    url = undefined;
  }
  if (!url || !url.hostname) throw new Error("A push subscription endpoint is a valid https: URL or a loopback http: one.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackEndpointHost(url.hostname))) {
    throw new Error("A push subscription endpoint is a valid https: URL or a loopback http: one.");
  }
  return url.origin;
}

/** A transport failure's reason with the endpoint (a capability URL) taken out of it. */
function withoutEndpoint(error: unknown, endpoint: string): string {
  const reason = error instanceof Error ? error.message : String(error);
  return endpoint ? reason.split(endpoint).join("the push endpoint") : reason;
}
