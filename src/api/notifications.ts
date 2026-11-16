/**
 * The notifications routes: the ntfy test, so the operator can prove a phone's subscription, and Web Push — this
 * gateway's VAPID public key with the devices that subscribed, subscribing or forgetting this browser, and one test
 * push. Nothing here carries the VAPID private key, which never leaves the gateway's config directory.
 */
import { fetchJson } from "./request.ts";
import type {
  PushStatusResponse,
  PushSubscribeRequest,
  PushSubscribeResponse,
  PushTestResponse,
  PushUnsubscribeRequest,
  PushUnsubscribeResponse,
} from "./schema/notifications.ts";

const PUSH_URL = "/__hui/notifications/push";
const JSON_HEADERS = { "content-type": "application/json" } as const;

/** Publishes one message to the ntfy topic the gateway saved. The request has no body: the topic is the gateway's. */
export async function sendTestNotification(): Promise<void> {
  await fetchJson<{ sent: true }>("/__hui/notifications/test", {
    method: "POST",
    headers: JSON_HEADERS,
    body: "{}",
  });
}

/** What this gateway pushes as: its public key, and the subscribed devices by a digest of their endpoint. */
export async function fetchPushStatus(): Promise<PushStatusResponse> {
  return fetchJson<PushStatusResponse>(PUSH_URL);
}

/** Registers this browser's subscription, and answers the device id its endpoint digests to. */
export async function subscribePushDevice(subscription: PushSubscribeRequest): Promise<PushSubscribeResponse> {
  return fetchJson<PushSubscribeResponse>(`${PUSH_URL}/subscribe`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(subscription),
  });
}

/** Forgets one subscription, and says whether the gateway had it at all. */
export async function unsubscribePushDevice(endpoint: string): Promise<PushUnsubscribeResponse> {
  const request: PushUnsubscribeRequest = { endpoint };
  return fetchJson<PushUnsubscribeResponse>(`${PUSH_URL}/unsubscribe`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
  });
}

/** Publishes one test push to every subscribed device, and says how many push services accepted it. */
export async function sendPushTest(): Promise<PushTestResponse> {
  return fetchJson<PushTestResponse>(`${PUSH_URL}/test`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: "{}",
  });
}
