/**
 * This device's Web Push as decisions a test can make: what this page can do at all, the Home Screen requirement on
 * iPhone and iPad, one `PushSubscription` turned into the keys the gateway stores, and this device's existing
 * subscription for the button's state after a reload. Nothing here reads a browser global: the controller hands in the
 * page's environment and its service worker registration, so the raw browser errors never reach a view and every
 * refusal is a sentence the operator can act on.
 */

/** What this page can do about Web Push: the facts `pushDeviceState` decides on, gathered by the controller. */
export type PushEnvironment = {
  /** `window.isSecureContext`: Web Push needs https, or the browser's own localhost. */
  secure: boolean;
  /** Whether the browser exposes `PushManager` at all. */
  pushManager: boolean;
  userAgent: string;
  /** iPadOS reports a Mac platform and a touch screen instead of `iPad` in its user agent. */
  platform?: string;
  maxTouchPoints?: number;
  /** `true` inside the installed app, which is the only place Safari on iOS subscribes at all. */
  standalone: boolean;
  /** `Notification.permission` as the page already reads it; `"denied"` means no click can subscribe this device. */
  permission?: NotificationPermission;
};

/** What this browser can do about Web Push, in the order the page reports it. `blocked` is a device that can subscribe
 * but whose operator has refused notifications for HUI: the one state a click cannot fix. */
export type PushDeviceState = "unsupported" | "insecure" | "ios-not-installed" | "blocked" | "ready";

/** Where `isStandalone` reads: the standalone media query and Safari's own flag. */
export type StandaloneSource = {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
};

/** What the standalone media query asks: an app installed to the Home Screen, a desktop or the dock. */
export const STANDALONE_QUERY = "(display-mode: standalone)";

/** Whether HUI is running as an installed app, which is the only way Safari on iOS may subscribe. */
export function isStandalone(source: StandaloneSource): boolean {
  if (source.navigator?.standalone === true) return true;
  return source.matchMedia?.(STANDALONE_QUERY).matches === true;
}

/** iPhone and iPad: Safari there subscribes only from a Home Screen install, so the page owes those steps. */
export function isIosDevice(environment: Pick<PushEnvironment, "userAgent" | "platform" | "maxTouchPoints">): boolean {
  if (/iPad|iPhone|iPod/u.test(environment.userAgent)) return true;
  return environment.platform === "MacIntel" && (environment.maxTouchPoints ?? 0) > 1;
}

/** The one thing to tell this page about Web Push: no push at all, an address that cannot subscribe, the iOS steps,
 * a blocked notification permission, or a device that can subscribe now. */
export function pushDeviceState(environment: PushEnvironment): PushDeviceState {
  if (!environment.pushManager) return "unsupported";
  if (!environment.secure) return "insecure";
  if (isIosDevice(environment) && !environment.standalone) return "ios-not-installed";
  // A browser that refused notifications subscribes nothing a person could see, so the page says so instead of
  // offering the click whose only outcome is a refusal.
  if (environment.permission === "denied") return "blocked";
  return "ready";
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUES = new Map([...ALPHABET].map((character, index) => [character, index] as const));

/** Base64url without padding: what a push service hands out and what the gateway stores and signs with. */
export function base64url(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += ALPHABET[first >> 2];
    encoded += ALPHABET[((first & 0b11) << 4) | ((second ?? 0) >> 4)];
    if (second === undefined) break;
    encoded += ALPHABET[((second & 0b1111) << 2) | ((third ?? 0) >> 6)];
    if (third === undefined) break;
    encoded += ALPHABET[third & 0b111111];
  }
  return encoded;
}

/** The bytes a base64url string names, or nothing when it is not one. Padding is accepted, as a gateway may send it. */
export function base64urlBytes(value: string): Uint8Array<ArrayBuffer> | undefined {
  const clean = value.trim().replace(/=+$/u, "").replace(/\+/gu, "-").replace(/\//gu, "_");
  if (!clean || clean.length % 4 === 1) return undefined;
  const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let written = 0;
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    const index = VALUES.get(character);
    if (index === undefined) return undefined;
    buffer = ((buffer << 6) | index) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

/** The keys the gateway stores for one browser: its push service endpoint and what a message is sealed to. */
export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };

/** One subscription as the browser describes it, so this module needs no DOM to be tested. */
export type PushSubscriptionLike = {
  endpoint: string;
  getKey(name: "p256dh" | "auth"): ArrayBuffer | null;
  /** Forgets this subscription at its push service; the pure helpers never call it. */
  unsubscribe?: () => Promise<boolean>;
};

export type PushManagerLike = {
  subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<PushSubscriptionLike>;
  getSubscription(): Promise<PushSubscriptionLike | null>;
};

export type PushRegistrationLike = { pushManager: PushManagerLike };

export type PushSubscribeFailure = {
  ok: false;
  /** Which refusal it was, so a caller can tell a blocked permission from a browser without a push service. */
  reason: "no-service-worker" | "insecure" | "no-key" | "permission-denied" | "no-push-service" | "failed";
  /** The sentence a view shows: what happened, and what the operator can do about it. */
  error: string;
};

export type PushSubscribeResult = ({ ok: true } & PushSubscriptionKeys) | PushSubscribeFailure;

/** Every refusal in the words a person reads, so no browser error text reaches a view. */
export const PUSH_SUBSCRIBE_ERRORS: Record<PushSubscribeFailure["reason"], string> = {
  "no-service-worker": "HUI's service worker is not running on this page yet. Reload HUI, then enable this device again.",
  insecure: "Web Push needs a secure address. Open HUI over HTTPS, then enable this device again.",
  "no-key": "The gateway has no usable push key yet. Reload HUI, then enable this device again.",
  "permission-denied": "Notifications are blocked for HUI in this browser's site settings. Allow them for HUI, then enable this device again.",
  "no-push-service": "This browser has no push service to deliver through. On a phone, open HUI from the Home Screen or use the HUI app; Phone (ntfy) still works as the fallback.",
  failed: "The browser could not subscribe this device. Check this browser's notification settings, then try again.",
};

function failure(reason: PushSubscribeFailure["reason"]): PushSubscribeFailure {
  return { ok: false, reason, error: PUSH_SUBSCRIBE_ERRORS[reason] };
}

/** Which refusal a browser error is, by the name the notification and push standards give it. */
function refused(error: unknown): PushSubscribeFailure["reason"] {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "permission-denied";
  if (name === "NotSupportedError" || name === "AbortError") return "no-push-service";
  return "failed";
}

/** One subscription key as the base64url the gateway stores, or nothing when the browser did not hand one over. */
function subscriptionKey(subscription: PushSubscriptionLike, name: "p256dh" | "auth"): string | undefined {
  let key: ArrayBuffer | null;
  try {
    key = subscription.getKey(name);
  } catch {
    return undefined;
  }
  return key && key.byteLength ? base64url(new Uint8Array(key)) : undefined;
}

/**
 * Subscribes this device through its own service worker and answers the keys the gateway stores, or a typed refusal
 * carrying the sentence to show. The VAPID public key is the gateway's, and a browser that is not a secure context or
 * has no registration never reaches the push service at all.
 */
export async function subscribeDevice(deps: {
  /** The gateway's VAPID public key, base64url, which every message is addressed to. */
  applicationServerKey: string;
  /** This page's service worker registration, or nothing while it has none. */
  registration: PushRegistrationLike | undefined;
  /** `window.isSecureContext`; a page that is not one cannot subscribe. Defaults to a secure page. */
  secure?: boolean;
}): Promise<PushSubscribeResult> {
  if (deps.secure === false) return failure("insecure");
  const key = base64urlBytes(deps.applicationServerKey);
  // The browser wants the unpadded point the gateway signs with, and refuses anything else with an opaque error.
  if (!key || key.length !== 65 || key[0] !== 4) return failure("no-key");
  const pushManager = deps.registration?.pushManager;
  if (!pushManager) return failure("no-service-worker");
  let subscription: PushSubscriptionLike;
  try {
    subscription = await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch (error) {
    return failure(refused(error));
  }
  const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint.trim() : "";
  const p256dh = endpoint ? subscriptionKey(subscription, "p256dh") : undefined;
  const auth = p256dh ? subscriptionKey(subscription, "auth") : undefined;
  if (!endpoint || !p256dh || !auth) return failure("failed");
  return { ok: true, endpoint, p256dh, auth };
}

/** This device's subscription endpoint when the browser already has one: the button's state after a reload. */
export async function currentSubscription(registration: PushRegistrationLike | undefined): Promise<string | undefined> {
  const pushManager = registration?.pushManager;
  if (!pushManager) return undefined;
  try {
    const subscription = await pushManager.getSubscription();
    const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint.trim() : "";
    return endpoint || undefined;
  } catch {
    return undefined;
  }
}
