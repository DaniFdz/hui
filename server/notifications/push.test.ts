/**
 * Web Push without a dependency, from the protocol's own vectors outwards: the RFC 8291 example seals byte for byte,
 * a real notification opens again with only the user agent's private key, the VAPID header is a JWT a push service can
 * verify, and a publish carries that body and header while naming neither the endpoint nor the keys in an error.
 */
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { test } from "vitest";
import {
  PushPublishError,
  encryptPushMessage,
  isPushGone,
  publishPush,
  publishPushBatch,
  sealPushPayload,
  vapidAuthorization,
  type PushMessage,
  type PushSubscriptionRecord,
  type VapidKeys,
} from "./push.ts";

const b64 = (value: Buffer): string => value.toString("base64url");
const unb64 = (value: string): Buffer => Buffer.from(value, "base64url");

/** RFC 8291 §5: one user agent, one application server, one plaintext, and the message the first produces. */
const RFC = {
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  /**
   * The RFC's printed point. It is 86 characters here and 87 in the RFC's notation, because a printed transcription
   * dropped one: the point of `uaPrivate` is `…-VV-JvLexhq…`, and the vector below only reproduces when the key is the
   * one its private scalar names, so this constant is the derived point and the assertion in the test proves it.
   */
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  plaintext: "When I grow up, I want to be a watermelon",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const RFC_SUBSCRIPTION: PushSubscriptionRecord = {
  endpoint: "https://push.example.net/rfc",
  keys: { p256dh: RFC.uaPublic, auth: RFC.authSecret },
};

/** A VAPID pair taken from the RFC's application server: a fixed key, so a signature is reproducible. */
const VAPID: VapidKeys = { publicKey: RFC.asPublic, privateKey: RFC.asPrivate };

test("the RFC 8291 §5 example seals to exactly its published message", () => {
  const expected = unb64(RFC.body);
  const userAgent = createECDH("prime256v1");
  userAgent.setPrivateKey(unb64(RFC.uaPrivate));
  assert.equal(b64(userAgent.getPublicKey()), RFC.uaPublic, "the user-agent key is the point its private scalar names");
  const applicationServer = createECDH("prime256v1");
  applicationServer.setPrivateKey(unb64(RFC.asPrivate));
  assert.equal(b64(applicationServer.getPublicKey()), RFC.asPublic);

  // The RFC's plaintext is not a PushMessage: sealing text is the seam `encryptPushMessage` wraps with JSON.
  const sealed = sealPushPayload(RFC.plaintext, RFC_SUBSCRIPTION, { salt: expected.subarray(0, 16), ecdh: applicationServer });
  assert.equal(sealed.body.toString("base64url"), RFC.body, "the sealed body equals the RFC's message byte for byte");
  assert.ok(sealed.body.equals(expected));
  assert.equal(sealed.body.length, expected.length);
  assert.equal(sealed.body.subarray(0, 16).toString("base64url"), "DGv6ra1nlYgDCS1FRnbzlw", "the salt is the message's first 16 bytes");
  assert.equal(sealed.body.readUInt32BE(16), 4096, "the record size");
  assert.equal(sealed.body.readUInt8(20), 65, "the key id length of an uncompressed point");
  assert.equal(b64(sealed.body.subarray(21, 86)), RFC.asPublic, "the message carries the sender's ephemeral public key");
  assert.equal(sealed.headers["content-encoding"], "aes128gcm");
});

test("a notification opens again with only the user agent's private key", () => {
  const userAgent = createECDH("prime256v1");
  userAgent.generateKeys();
  const p256dh = b64(userAgent.getPublicKey());
  const auth = b64(Buffer.from("an auth secret 1"));
  const subscription: PushSubscriptionRecord = { endpoint: "https://push.example.net/device", keys: { p256dh, auth } };
  const message: PushMessage = { title: "Fix the drawer", body: "Deploy to staging?", path: "/sessions/01JABCDEFG", tag: "hui-run", priority: "high" };
  const sealed = encryptPushMessage(message, subscription);
  assert.equal(sealed.headers["urgency"], "high");

  /** What a browser does with the body: parse the header, ECDH with its own key, then the same HKDF steps. */
  const parsed = (body: Buffer): PushMessage => {
    const salt = body.subarray(0, 16);
    assert.equal(body.readUInt32BE(16), 4096);
    const keyLength = body.readUInt8(20);
    assert.equal(keyLength, 65);
    const ephemeral = body.subarray(21, 21 + keyLength);
    const ciphertext = body.subarray(21 + keyLength);
    const secret = userAgent.computeSecret(ephemeral);
    const info = Buffer.concat([Buffer.from("WebPush: info\u0000"), unb64(p256dh), ephemeral]);
    const ikm = Buffer.from(hkdfSync("sha256", secret, unb64(auth), info, 32));
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\u0000"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\u0000"), 12));
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
    assert.equal(plain[plain.length - 1], 2, "the single record ends with its padding delimiter");
    return JSON.parse(plain.subarray(0, plain.length - 1).toString("utf8")) as PushMessage;
  };

  const opened = parsed(sealed.body);
  assert.deepEqual(opened, message);
  assert.equal(opened.path, "/sessions/01JABCDEFG");
  // A tap can never leave the app: the path is relative or the message is not sealed at all.
  assert.throws(() => encryptPushMessage({ title: "x", path: "https://elsewhere.example.net/" }, subscription), /relative in-app path/u);
  assert.throws(() => encryptPushMessage({ title: "x", path: "//elsewhere.example.net/" }, subscription), /relative in-app path/u);
});

test("the VAPID header is an ES256 JWT over the endpoint's origin", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const header = vapidAuthorization("https://push.example.net/x?capability=secret", VAPID, now);
  assert.match(header, /^vapid t=[A-Za-z0-9_.-]+,k=[A-Za-z0-9_-]+$/u);
  const [token, advertised] = header.slice("vapid ".length).split(",");
  assert.ok(token && advertised);
  assert.equal(advertised, `k=${RFC.asPublic}`, "the advertised key is the uncompressed P-256 point");
  const [encodedHeader, encodedClaims, encodedSignature] = token.slice(2).split(".");
  assert.ok(encodedHeader && encodedClaims && encodedSignature, "a JWT is three base64url segments");
  for (const segment of [encodedHeader, encodedClaims, encodedSignature]) assert.doesNotMatch(segment, /[=+/]/u, "base64url without padding");
  assert.equal(unb64(encodedHeader).toString("utf8"), '{"typ":"JWT","alg":"ES256"}');
  const claims = JSON.parse(unb64(encodedClaims).toString("utf8")) as { aud: string; exp: number; sub?: string };
  assert.deepEqual(claims, { aud: "https://push.example.net", exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60 });
  assert.equal("sub" in claims, false, "no subject means no sub claim at all");
  assert.equal(claims.exp, 1_767_268_800, "twelve hours after the injected now");

  const point = unb64(RFC.asPublic);
  const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64(point.subarray(1, 33)), y: b64(point.subarray(33, 65)) }, format: "jwk" });
  const signature = unb64(encodedSignature);
  assert.equal(signature.length, 64, "ES256 signs as a raw r||s pair, not as DER");
  assert.equal(verify("sha256", Buffer.from(`${encodedHeader}.${encodedClaims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature), true);

  const withSubject = vapidAuthorization("https://push.example.net/x", VAPID, now, " mailto:ops@example.com ");
  const claimsWithSubject = JSON.parse(unb64(withSubject.slice("vapid t=".length).split(".")[1] ?? "").toString("utf8")) as { sub?: string };
  assert.equal(claimsWithSubject.sub, "mailto:ops@example.com");

  assert.throws(() => vapidAuthorization("http://push.example.net/x", VAPID), /valid https: URL/u);
  assert.throws(
    () => vapidAuthorization("https://push.example.net/x", { publicKey: RFC.asPublic, privateKey: RFC.uaPrivate }),
    (error: Error) => {
      assert.match(error.message, /does not belong/u);
      assert.doesNotMatch(error.message, /p256dh|auth|yfWPiYE|q1dXpw3/u, "no key material in an error");
      return true;
    },
  );
});

test("publishing posts the sealed body with its headers, a TTL, an urgency and the VAPID header", async () => {
  const subscription: PushSubscriptionRecord = { endpoint: "https://push.example.net/device/abc", keys: RFC_SUBSCRIPTION.keys };
  const sealed = encryptPushMessage({ title: "HUI", body: "Done", path: "/sessions/a", priority: "low" }, subscription);
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  await publishPush(subscription, sealed, VAPID, { fetcher, now: new Date("2026-01-01T00:00:00.000Z") });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.url, subscription.endpoint);
  assert.equal(call.init.method, "POST");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers["content-encoding"], "aes128gcm");
  assert.equal(headers["urgency"], "low");
  assert.equal(headers["ttl"], "86400", "a day is the default the push service keeps an offline message for");
  assert.match(headers["authorization"] ?? "", /^vapid t=[^,]+,k=[A-Za-z0-9_-]+$/u);
  assert.ok(call.init.body instanceof Uint8Array);
  assert.deepEqual(Buffer.from(call.init.body as Uint8Array), sealed.body);
  assert.ok(call.init.signal instanceof AbortSignal, "every publish carries its own deadline");

  await publishPush(subscription, sealed, VAPID, { fetcher, ttlSeconds: 60 });
  assert.equal((calls[1]?.init.headers as Record<string, string>)["ttl"], "60");
});

test("a refused, gone or unreachable push service rejects without naming the endpoint", async () => {
  const subscription: PushSubscriptionRecord = { endpoint: "https://push.example.net/device/capability-token", keys: RFC_SUBSCRIPTION.keys };
  const sealed = sealPushPayload("hello", subscription);
  const answering = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch;

  await assert.rejects(publishPush(subscription, sealed, VAPID, { fetcher: answering(410) }), (error: unknown) => {
    assert.ok(isPushGone(error), "410 means the subscription is gone");
    assert.equal((error as PushPublishError).status, 410);
    assert.match(error.message, /HTTP 410/u);
    assert.doesNotMatch(error.message, /push\.example\.net|capability-token/u, "the endpoint is a capability and never appears");
    return true;
  });
  await assert.rejects(publishPush(subscription, sealed, VAPID, { fetcher: answering(404) }), (error: unknown) => {
    assert.ok(isPushGone(error));
    assert.equal((error as PushPublishError).status, 404);
    return true;
  });
  await assert.rejects(publishPush(subscription, sealed, VAPID, { fetcher: answering(500) }), (error: unknown) => {
    assert.equal(isPushGone(error), false, "a server error is not a dead subscription");
    assert.equal((error as PushPublishError).status, 500);
    return true;
  });

  const failing = (async () => {
    throw new Error(`connect ECONNREFUSED ${subscription.endpoint}`);
  }) as typeof fetch;
  await assert.rejects(publishPush(subscription, sealed, VAPID, { fetcher: failing }), (error: Error) => {
    assert.match(error.message, /Could not reach the push service: connect ECONNREFUSED the push endpoint/u);
    assert.doesNotMatch(error.message, /capability-token/u, "a transport reason never carries the endpoint through");
    return true;
  });

  const refused: PushSubscriptionRecord = { endpoint: "http://push.example.net/x", keys: RFC_SUBSCRIPTION.keys };
  const calls: string[] = [];
  await assert.rejects(publishPush(refused, sealed, VAPID, { fetcher: (async (url: string | URL | Request) => { calls.push(String(url)); return new Response(null, { status: 201 }); }) as typeof fetch }), /valid https: URL/u);
  assert.deepEqual(calls, [], "an endpoint HUI cannot send to is refused before anything is posted");
});

test("a push service on this machine may be a loopback http endpoint, and no other plain http one is", async () => {
  const sealed = sealPushPayload("hello", RFC_SUBSCRIPTION);
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  /** The `aud` a push service would verify: the origin of the endpoint, and nothing more. */
  const audience = (authorization: string): string => {
    const claims = unb64(authorization.slice("vapid t=".length).split(",")[0]?.split(".")[1] ?? "").toString("utf8");
    return (JSON.parse(claims) as { aud: string }).aud;
  };

  for (const [endpoint, aud] of [["http://127.0.0.1:8787/push/device/capability", "http://127.0.0.1:8787"], ["http://[::1]:8787/push/device", "http://[::1]:8787"]] as const) {
    await publishPush({ endpoint, keys: RFC_SUBSCRIPTION.keys }, sealed, VAPID, { fetcher });
    const call = calls.at(-1);
    assert.equal(call?.url, endpoint, "the local test push service receives it");
    assert.equal(audience(call?.headers["authorization"] ?? ""), aud);
  }

  const refused = ["http://push.example.net/x", "http://localhost:8787/push/x", "http://127.0.0.2:8787/push/x"];
  const before = calls.length;
  for (const endpoint of refused) {
    await assert.rejects(
      publishPush({ endpoint, keys: RFC_SUBSCRIPTION.keys }, sealed, VAPID, { fetcher }),
      /valid https: URL or a loopback http: one/u,
    );
    assert.throws(() => vapidAuthorization(endpoint, VAPID), /valid https: URL or a loopback http: one/u);
  }
  assert.equal(calls.length, before, "an endpoint HUI cannot send to is refused before anything is posted");
});

test("one batch reaches every device at once and one dead service costs the others nothing", async () => {
  const live: PushSubscriptionRecord = { endpoint: "https://push.example.net/device/live", keys: RFC_SUBSCRIPTION.keys };
  const dropped: PushSubscriptionRecord = { endpoint: "https://push.example.net/device/dropped", keys: RFC_SUBSCRIPTION.keys };
  const broken: PushSubscriptionRecord = { endpoint: "https://push.example.net/device/broken", keys: RFC_SUBSCRIPTION.keys };
  const endpoints = [live.endpoint, dropped.endpoint, broken.endpoint];

  // No timer and no sleep: every request is held until all three have been entered, which only a batch that starts
  // them together can ever satisfy.
  let entered = 0;
  let release = (): void => {};
  const allEntered = new Promise<void>((resolve) => { release = resolve; });
  const fetcher = (async (url: string | URL | Request) => {
    entered += 1;
    if (entered === endpoints.length) release();
    await allEntered;
    const endpoint = String(url);
    if (endpoint === dropped.endpoint) return new Response(null, { status: 410 });
    if (endpoint === broken.endpoint) throw new Error(`connect ECONNREFUSED ${endpoint}`);
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  const result = await publishPushBatch([live, dropped, broken], { title: "HUI", path: "/sessions/a" }, VAPID, { fetcher });

  assert.equal(entered, 3, "all three requests were in flight before any answer was read");
  assert.equal(result.sent, 1, "only the accepting service counts");
  assert.deepEqual(result.gone, [dropped.endpoint], "the 410 subscription is the one to prune");
  assert.ok(result.failure instanceof Error, "the transport error is reported, not swallowed");
  const message = result.failure.message;
  assert.match(message, /Could not reach the push service: connect ECONNREFUSED the push endpoint/u);
  for (const endpoint of endpoints) assert.equal(message.includes(endpoint), false, "no failure names an endpoint");
});
