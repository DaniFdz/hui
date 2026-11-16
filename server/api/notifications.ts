/**
 * The notifications surface: the ntfy test route, and Web Push — the gateway's public VAPID key with the devices that
 * subscribed, registering and forgetting one browser, and one test push. A subscription's endpoint is a capability URL
 * and its `p256dh`/`auth` values are secrets, so no payload here carries any of them back, and the VAPID private key
 * never leaves the gateway's config directory.
 */
import { Type, type Static } from "typebox";

export const NotificationTestResponse = Type.Object({ sent: Type.Literal(true) }, { $id: "NotificationTestResponse" });
export type NotificationTestResponse = Static<typeof NotificationTestResponse>;

export const NotificationTestError = Type.Object({ error: Type.String() }, { $id: "NotificationTestError" });
export type NotificationTestError = Static<typeof NotificationTestError>;

/** One push message's outcome. `sent` counts the push services that accepted it, so the page can say the truth. */
export const PushTestResponse = Type.Object({ sent: Type.Number(), devices: Type.Number() }, { $id: "PushTestResponse" });
export type PushTestResponse = Static<typeof PushTestResponse>;

/** What this gateway pushes as: the VAPID public key a browser subscribes with, and each subscribed device by a
 * digest of its endpoint. The endpoint itself, its keys and the private key are deliberately absent. */
export const PushStatusResponse = Type.Object({
  publicKey: Type.String(),
  devices: Type.Array(Type.Object({ id: Type.String(), createdAt: Type.String(), device: Type.Optional(Type.String()) })),
}, { $id: "PushStatusResponse" });
export type PushStatusResponse = Static<typeof PushStatusResponse>;

/** What a browser sends when it subscribes: its push service endpoint and the keys the message is sealed to. */
export const PushSubscribeRequest = Type.Object({
  endpoint: Type.String(),
  keys: Type.Object({ p256dh: Type.String(), auth: Type.String() }),
  device: Type.Optional(Type.String()),
}, { $id: "PushSubscribeRequest" });
export type PushSubscribeRequest = Static<typeof PushSubscribeRequest>;

/** The device id a screen uses to name this subscription: a digest of the endpoint, never the endpoint. */
export const PushSubscribeResponse = Type.Object({ subscribed: Type.Literal(true), id: Type.String() }, { $id: "PushSubscribeResponse" });
export type PushSubscribeResponse = Static<typeof PushSubscribeResponse>;

export const PushUnsubscribeRequest = Type.Object({ endpoint: Type.String() }, { $id: "PushUnsubscribeRequest" });
export type PushUnsubscribeRequest = Static<typeof PushUnsubscribeRequest>;

export const PushUnsubscribeResponse = Type.Object({ removed: Type.Boolean() }, { $id: "PushUnsubscribeResponse" });
export type PushUnsubscribeResponse = Static<typeof PushUnsubscribeResponse>;

/** A refused push request. Its sentence never names the endpoint or a key. */
export const PushError = Type.Object({ error: Type.String() }, { $id: "PushError" });
export type PushError = Static<typeof PushError>;

export const routeSchemas = [
  { method: "POST", path: "/__hui/notifications/test", response: NotificationTestResponse },
  { method: "GET", path: "/__hui/notifications/push", response: PushStatusResponse },
  { method: "POST", path: "/__hui/notifications/push/subscribe", request: PushSubscribeRequest, response: PushSubscribeResponse },
  { method: "POST", path: "/__hui/notifications/push/unsubscribe", request: PushUnsubscribeRequest, response: PushUnsubscribeResponse },
  { method: "POST", path: "/__hui/notifications/push/test", response: PushTestResponse },
];
