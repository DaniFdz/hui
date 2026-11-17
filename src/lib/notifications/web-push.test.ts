import assert from "node:assert/strict";
import { test } from "vitest";
import {
  PUSH_SUBSCRIBE_ERRORS,
  STANDALONE_QUERY,
  base64url,
  base64urlBytes,
  currentSubscription,
  isIosDevice,
  isStandalone,
  pushDeviceState,
  subscribeDevice,
  type PushEnvironment,
  type PushRegistrationLike,
  type PushManagerLike,
  type PushSubscribeFailure,
  type PushSubscriptionLike,
} from "./web-push.ts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPADOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function environment(overrides: Partial<PushEnvironment> = {}): PushEnvironment {
  return { secure: true, pushManager: true, userAgent: CHROME, standalone: false, ...overrides };
}

test("a page without PushManager, an insecure address, an uninstalled iPhone and a ready device are distinct", () => {
  assert.equal(pushDeviceState(environment({ pushManager: false })), "unsupported");
  assert.equal(pushDeviceState(environment({ secure: false })), "insecure");
  assert.equal(pushDeviceState(environment({ userAgent: IPHONE })), "ios-not-installed");
  assert.equal(pushDeviceState(environment({ userAgent: IPHONE, standalone: true })), "ready");
  assert.equal(pushDeviceState(environment()), "ready");
  // iPadOS says Macintosh and shows a touch screen instead of naming itself in the user agent.
  assert.equal(pushDeviceState(environment({ userAgent: IPADOS, platform: "MacIntel", maxTouchPoints: 5 })), "ios-not-installed");
  assert.equal(pushDeviceState(environment({ userAgent: IPADOS, platform: "MacIntel", maxTouchPoints: 0 })), "ready", "a Mac with a trackpad is not an iPad");
  assert.equal(isIosDevice({ userAgent: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)" }), true);
  assert.equal(isIosDevice({ userAgent: CHROME, platform: "Linux x86_64", maxTouchPoints: 0 }), false);
  // The iOS rule is the one the copy names, so an insecure iPhone is told about the address before the Home Screen.
  assert.equal(pushDeviceState(environment({ userAgent: IPHONE, secure: false })), "insecure");
});

test("a refused notification permission is its own state, and the one no click can fix", () => {
  assert.equal(pushDeviceState(environment({ permission: "denied" })), "blocked");
  assert.equal(pushDeviceState(environment({ permission: "granted" })), "ready");
  assert.equal(pushDeviceState(environment({ permission: "default" })), "ready", "a permission still to be asked for is not a block");
  assert.equal(pushDeviceState(environment()), "ready", "a page that reports no permission is asked on the click");
  // A refused permission takes precedence over `ready`, and never over a browser that cannot subscribe at all.
  assert.equal(pushDeviceState(environment({ permission: "denied", userAgent: IPHONE })), "ios-not-installed");
  assert.equal(pushDeviceState(environment({ permission: "denied", secure: false })), "insecure");
  assert.equal(pushDeviceState(environment({ permission: "denied", pushManager: false })), "unsupported");
});

test("standalone reads Safari's own flag first, then the display-mode media query", () => {
  const queries: string[] = [];
  const matchMedia = (query: string) => { queries.push(query); return { matches: true }; };
  assert.equal(isStandalone({ matchMedia }), true);
  assert.deepEqual(queries, [STANDALONE_QUERY]);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(isStandalone({ navigator: { standalone: true }, matchMedia: () => ({ matches: false }) }), true);
  assert.equal(isStandalone({ navigator: { standalone: false } }), false);
  assert.equal(isStandalone({}), false, "a page that answers nothing is not an installed app");
});

test("base64url is the unpadded alphabet a push service and VAPID use, and reads back", () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([0]), new Uint8Array([0xff, 0xfe]), Uint8Array.from({ length: 65 }, (_, index) => index * 3), new Uint8Array([0xfb, 0xff, 0xbf])]) {
    const encoded = base64url(bytes);
    assert.equal(encoded, Buffer.from(bytes).toString("base64url"), "the same string Buffer produces");
    assert.deepEqual([...base64urlBytes(encoded) ?? []], [...bytes]);
    assert.doesNotMatch(encoded, /[+/=]/u);
  }
  // A gateway may send the padded standard alphabet; both read as the same bytes.
  assert.deepEqual([...(base64urlBytes("+/8=") ?? [])], [0xfb, 0xff]);
  assert.equal(base64urlBytes("not base64 url!"), undefined);
  assert.equal(base64urlBytes(""), undefined);
  assert.equal(base64urlBytes("a"), undefined, "one leftover character is not a byte");
});

/** A fake subscription: the browser's endpoint and the two keys a push service seals to. */
function subscription(keys: { p256dh?: ArrayBuffer | null; auth?: ArrayBuffer | null } = {}): PushSubscriptionLike & { asked: string[] } {
  const asked: string[] = [];
  const p256dh = keys.p256dh === undefined ? Uint8Array.from({ length: 65 }, (_, index) => index % 256).buffer : keys.p256dh;
  const auth = keys.auth === undefined ? Uint8Array.from({ length: 16 }, (_, index) => index).buffer : keys.auth;
  return {
    asked,
    endpoint: "https://push.example.net/device/capability",
    getKey(name) {
      asked.push(name);
      return name === "p256dh" ? p256dh : auth;
    },
  };
}

/** The gateway's public key: a real 65-byte uncompressed point stands in for the browser's only requirement. */
const APPLICATION_SERVER_KEY = base64url(Uint8Array.from({ length: 65 }, (_, index) => (index === 0 ? 4 : index)));

/** A registration whose push manager answers what the test says, and subscribes for real otherwise. */
function registration(overrides: {
  subscribe?: PushManagerLike["subscribe"];
  getSubscription?: PushManagerLike["getSubscription"];
} = {}): PushRegistrationLike {
  return {
    pushManager: {
      subscribe: overrides.subscribe ?? (async () => subscription()),
      getSubscription: overrides.getSubscription ?? (async () => null),
    },
  };
}

test("a subscription becomes the endpoint and keys the gateway stores, from the gateway's public key", async () => {
  const requests: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }[] = [];
  const fake = subscription();
  const result = await subscribeDevice({
    applicationServerKey: APPLICATION_SERVER_KEY,
    registration: registration({ subscribe: async (options) => { requests.push(options); return fake; } }),
  });
  assert.equal(requests.length, 1);
  const [options] = requests;
  assert.equal(options?.userVisibleOnly, true, "a push must show a notification, or Chrome refuses it");
  assert.deepEqual([...options?.applicationServerKey ?? []], [...Uint8Array.from({ length: 65 }, (_, index) => (index === 0 ? 4 : index))], "the point, decoded from base64url");
  assert.deepEqual(fake.asked.sort(), ["auth", "p256dh"]);
  assert.deepEqual(result, {
    ok: true,
    endpoint: "https://push.example.net/device/capability",
    p256dh: base64url(Uint8Array.from({ length: 65 }, (_, index) => index % 256)),
    auth: base64url(Uint8Array.from({ length: 16 }, (_, index) => index)),
  });
});

test("every refusal is a sentence instead of a raw browser error", async () => {
  const noWorker = await subscribeDevice({ applicationServerKey: APPLICATION_SERVER_KEY, registration: undefined });
  assert.deepEqual(noWorker, { ok: false, reason: "no-service-worker", error: PUSH_SUBSCRIBE_ERRORS["no-service-worker"] });

  const insecure = await subscribeDevice({ applicationServerKey: APPLICATION_SERVER_KEY, registration: registration(), secure: false });
  assert.deepEqual(insecure, { ok: false, reason: "insecure", error: PUSH_SUBSCRIBE_ERRORS.insecure });

  for (const key of ["", "not a key!", base64url(new Uint8Array(64)), base64url(Uint8Array.from({ length: 65 }, () => 2))]) {
    const noKey = await subscribeDevice({ applicationServerKey: key, registration: registration() });
    assert.deepEqual(noKey, { ok: false, reason: "no-key", error: PUSH_SUBSCRIBE_ERRORS["no-key"] }, key);
  }

  const throwing = (name: string) => registration({
    subscribe: async () => { const error = new Error(`${name}: the browser's own words`); error.name = name; throw error; },
  });
  const expected: [string, PushSubscribeFailure["reason"]][] = [
    ["NotAllowedError", "permission-denied"],
    ["NotSupportedError", "no-push-service"],
    ["AbortError", "no-push-service"],
    ["TypeError", "failed"],
  ];
  for (const [name, reason] of expected) {
    const result = await subscribeDevice({ applicationServerKey: APPLICATION_SERVER_KEY, registration: throwing(name) });
    assert.deepEqual(result, { ok: false, reason, error: PUSH_SUBSCRIBE_ERRORS[reason] });
    assert.doesNotMatch(result.ok ? "" : result.error, /browser's own words/u, "no browser text reaches the operator");
  }

  for (const keys of [{ p256dh: null }, { auth: null }, { p256dh: new ArrayBuffer(0) }]) {
    const missing = await subscribeDevice({ applicationServerKey: APPLICATION_SERVER_KEY, registration: registration({ subscribe: async () => subscription(keys) }) });
    assert.deepEqual(missing, { ok: false, reason: "failed", error: PUSH_SUBSCRIBE_ERRORS.failed });
  }
  const empty = await subscribeDevice({
    applicationServerKey: APPLICATION_SERVER_KEY,
    registration: registration({ subscribe: async () => ({ ...subscription(), endpoint: "  " }) }),
  });
  assert.deepEqual(empty, { ok: false, reason: "failed", error: PUSH_SUBSCRIBE_ERRORS.failed });
});

test("an existing subscription answers with its endpoint, and a browser that refuses answers with nothing", async () => {
  assert.equal(await currentSubscription(undefined), undefined);
  assert.equal(await currentSubscription(registration()), undefined, "no subscription yet");
  const existing = subscription();
  assert.equal(await currentSubscription(registration({ getSubscription: async () => existing })), existing.endpoint);
  assert.equal(await currentSubscription(registration({ getSubscription: async () => ({ ...existing, endpoint: " " }) })), undefined);
  const refusing = registration({ getSubscription: async () => { throw new TypeError("the push service is gone"); } });
  assert.equal(await currentSubscription(refusing), undefined, "a browser that cannot answer is not a subscribed device");
});
