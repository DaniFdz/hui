/** Settings → Notifications → This device subscribes a device through the gateway's own routes, and what HUI pushes to it
 * is sealed the way a browser's push service carries it: this test stands a push service up on this machine, decrypts
 * every record it receives with that device's own private key, and proves both the test push and a real `notify_user`
 * call land in the right chat (SET-100). */
import { createDecipheriv, createECDH, hkdfSync, randomBytes, type ECDH } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Received = { headers: IncomingHttpHeaders; body: Buffer };

/** One decrypted push message: the notification's JSON envelope, as the notification channel builds it. */
type Message = { title?: string; body?: string; path?: string; tag?: string; priority?: string };

/** One browser's subscription as this test holds it: its P-256 pair (whose private half never leaves the test) and its
 * 16-byte auth secret. */
type Subscriber = { ecdh: ECDH; publicKey: Buffer; auth: Buffer };

/** The settings document the page saves: the notification tool, and Web Push's switch and optional contact. */
type GatewaySettings = {
  notifications: { tool: boolean; push: { enabled: boolean; subject: string } };
  [key: string]: unknown;
};

/**
 * Opens one `aes128gcm` record (RFC 8188/8291) the way a browser's push service hands it over: `salt(16) | rs(4) |
 * idlen(1) | the sender's public key | ciphertext`, whose plaintext is the message JSON and the 0x02 padding delimiter.
 */
function open(record: Buffer, subscriber: Subscriber): Message {
  const salt = record.subarray(0, 16);
  const recordSize = record.readUInt32BE(16);
  const keyLength = record.readUInt8(20);
  expect(recordSize, "one record, of the largest size a push service must accept").toBe(4096);
  const senderKey = record.subarray(21, 21 + keyLength);
  expect(senderKey.length, "the sender's uncompressed P-256 point").toBe(65);
  const shared = subscriber.ecdh.computeSecret(senderKey);
  const ikm = Buffer.from(hkdfSync("sha256", shared, subscriber.auth,
    Buffer.concat([Buffer.from("WebPush: info\u0000"), subscriber.publicKey, senderKey]), 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\u0000"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\u0000"), 12));
  const ciphertext = record.subarray(21 + keyLength);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  let end = plaintext.length;
  while (end > 0 && plaintext[end - 1] === 0) end -= 1;
  expect(plaintext[end - 1], "the AES128GCM padding delimiter closes the record").toBe(2);
  return JSON.parse(plaintext.subarray(0, end - 1).toString("utf8")) as Message;
}

/** The VAPID authorization one push carried, and the claims its ES256 token signs. */
function vapid(headers: IncomingHttpHeaders): { key: string; claims: { aud?: string; sub?: string; exp?: number } } {
  const [, token = "", key = ""] = /^vapid t=([^,]+),k=(.+)$/u.exec(String(headers["authorization"])) ?? [];
  expect(token, "the push carried a VAPID token").not.toBe("");
  const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { aud?: string; sub?: string; exp?: number };
  return { key, claims };
}

test("a subscribed device receives HUI's own push, sealed for it", { tags: ["SET-100"], platforms: ["web"] }, async ({ screen, hui }) => {
  const received: Received[] = [];
  const service = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    request.on("end", () => {
      received.push({ headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(201).end();
    });
  });
  await new Promise<void>((resolve) => { service.listen(0, "127.0.0.1", resolve); });
  const address = service.address();
  if (!address || typeof address === "string") throw new Error("The stub push service has no address.");
  const origin = `http://127.0.0.1:${address.port}`;
  const endpoint = `${origin}/push/e2e-capability-token`;
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const subscriber: Subscriber = { ecdh, publicKey: ecdh.getPublicKey(), auth: randomBytes(16) };
  const saved = () => hui.api<GatewaySettings>("GET", "/__hui/settings");

  try {
    // A real subscription through the route the page uses: only the stub stands in for a push service.
    const { publicKey } = await hui.api<{ publicKey: string }>("GET", "/__hui/notifications/push");
    expect(Buffer.from(publicKey, "base64url").length, "the uncompressed P-256 point a browser subscribes with").toBe(65);
    await hui.api("POST", "/__hui/notifications/push/subscribe", {
      endpoint,
      keys: { p256dh: subscriber.publicKey.toString("base64url"), auth: subscriber.auth.toString("base64url") },
    });

    const page = screen.getByTestId("settings-page");
    await hui.open("/settings/notifications");
    await expect(screen.getByText("1 device is subscribed.")).toBeVisible();
    const toggle = page.getByRole("switch", "Send notifications to this device");
    await expect(toggle).toBeChecked({ checked: false });

    // The optional contact address is VAPID's sub claim, saved with the section's own form.
    await page.getByLabel("Push contact").fill("mailto:e2e@example.com");
    await page.getByLabel("Push contact").press("Enter");
    await expect.poll(async () => (await saved()).notifications.push.subject).toBe("mailto:e2e@example.com");

    await toggle.tap({ position: { x: 8, y: 8 } });
    await expect.poll(async () => (await saved()).notifications.push.enabled).toBe(true);

    // This page has two "Send test" buttons, and This device's leads, above Phone (ntfy).
    await expect(page.getByRole("button", "Send test", { exact: true })).toHaveCount(2);
    await page.getByRole("button", "Send test", { exact: true }).first().tap();
    await expect.poll(() => received.length).toBe(1);
    await expect(screen.getByText("The test push went to 1 device.")).toBeVisible();
    const sent = received[0]!;
    expect(sent.headers["content-encoding"], "one aes128gcm record, never a plain body").toBe("aes128gcm");
    const authorization = vapid(sent.headers);
    expect(authorization.key, "the gateway signs with the key it publishes").toBe(publicKey);
    expect(authorization.claims.aud, "VAPID's audience is the endpoint's own origin").toBe(origin);
    expect(authorization.claims.sub, "the saved contact is the sub claim").toBe("mailto:e2e@example.com");
    expect(typeof authorization.claims.exp).toBe("number");
    const pushed = open(sent.body, subscriber);
    expect(pushed.title).toBe("HUI");
    expect(pushed.path).toBe("/settings/notifications");
    expect(pushed.body).toContain("test notification");

    // The real path, not the test one: a session's notify_user call goes through the same sender and store.
    await hui.open("/settings/tools");
    await screen.getByRole("switch", "Notification tool").tap({ position: { x: 8, y: 8 } });
    await expect.poll(async () => (await saved()).notifications.tool).toBe(true);
    const session = await hui.createSession({ title: "Push proof chat" });
    await hui.open(`/sessions/${session.id}`);
    await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
    await screen.getByLabel("Message").fill(`E2E_CALL:${Buffer.from(JSON.stringify({
      name: "notify_user", input: { title: "Ready", message: "Open this chat." },
    })).toString("base64url")}`);
    await screen.getByRole("button", "Send message").tap();
    await expect.poll(() => received.length).toBe(2);
    const notification = open(received[1]!.body, subscriber);
    expect(notification.path, "a tap opens the chat that asked for it").toBe(`/sessions/${session.id}`);
    expect(notification.tag, "the chat's own tag, so a device replaces its banner instead of stacking one").toBe(`hui-${session.id}`);
    expect(notification.title, "notify_user's banner title is the title its caller gave").toBe("Ready");
    expect(notification.body).toBe("Open this chat.");
    await expect(screen.getByTestId("transcript").getByText(/HUI pushed the notification to the devices subscribed/u)).toBeVisible();
  } finally {
    // Nothing later may push to this test's stub, or inherit a dead loopback subscription.
    await hui.api("POST", "/__hui/notifications/push/unsubscribe", { endpoint }).catch(() => undefined);
    const settings = await saved().catch(() => undefined);
    if (settings) {
      await hui.api("PUT", "/__hui/settings", {
        ...settings,
        notifications: { ...settings.notifications, push: { ...settings.notifications.push, enabled: false } },
      }).catch(() => undefined);
    }
    await new Promise<void>((resolve) => { service.close(() => resolve()); });
  }
});
