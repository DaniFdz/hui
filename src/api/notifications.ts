/**
 * `POST /__hui/notifications/test`: publishes one message to the ntfy topic the gateway saved, so the operator can
 * prove the phone's subscription before trusting a real run. The request has no body: the topic is the gateway's.
 */
import { fetchJson } from "./request.ts";

export async function sendTestNotification(): Promise<void> {
  await fetchJson<{ sent: true }>("/__hui/notifications/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}
