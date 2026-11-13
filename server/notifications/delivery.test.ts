import assert from "node:assert/strict";
import { test } from "vitest";
import type { DesktopNotification, NotificationChat } from "../agent-tools/notifications.ts";
import { createNotificationDelivery, NO_NOTIFICATION_CHANNEL, type NotificationChannel } from "./delivery.ts";
import type { NtfySettings } from "./ntfy.ts";

const CHAT: NotificationChat = { id: "session-a" };
const NOTE: DesktopNotification = { title: "Fix the drawer", subtitle: "Finished", priority: "low" };
const TOPIC: NtfySettings = { server: "https://ntfy.sh", topic: "hui-abc" };

function delivery(options: {
  desktopAvailable?: boolean;
  desktop?: () => Promise<{ status: "queued" | "in-view"; url: string }>;
  ntfy?: NtfySettings | Error;
  publish?: (url: string | undefined) => Promise<void>;
} = {}) {
  const published: (string | undefined)[] = [];
  const skipped: { channel: NotificationChannel; message: string }[] = [];
  const composed = createNotificationDelivery({
    desktop: {
      available: () => options.desktopAvailable ?? false,
      deliver: options.desktop ?? (async () => ({ status: "queued", url: "http://127.0.0.1:4175/sessions/session-a" })),
    },
    ntfy: {
      settings: async () => {
        if (options.ntfy instanceof Error) throw options.ntfy;
        return options.ntfy ?? { server: "https://ntfy.sh", topic: "" };
      },
      publish: async (_settings, _chat, _notification, url) => {
        published.push(url);
        await options.publish?.(url);
      },
    },
    skipped: (error, channel) => skipped.push({ channel, message: error instanceof Error ? error.message : String(error) }),
  });
  return { ...composed, published, skipped };
}

test("the desktop app alone answers as it did, including when the chat is already in front", async () => {
  const state = delivery({ desktopAvailable: true });
  assert.deepEqual(await state.deliver(CHAT, NOTE), {
    status: "queued", url: "http://127.0.0.1:4175/sessions/session-a", channels: ["desktop"],
  });
  const inView = delivery({ desktopAvailable: true, desktop: async () => ({ status: "in-view", url: "http://127.0.0.1:4175/sessions/session-a" }) });
  assert.deepEqual(await inView.deliver(CHAT, NOTE), {
    status: "in-view", url: "http://127.0.0.1:4175/sessions/session-a", channels: ["desktop"],
  });
});

test("a phone hears it through ntfy, with the desktop's own chat link when it has one", async () => {
  const phone = delivery({ ntfy: TOPIC });
  assert.deepEqual(await phone.deliver(CHAT, NOTE), { status: "queued", channels: ["ntfy"] });
  assert.deepEqual(phone.published, [undefined], "no desktop run means no link to reuse");

  const both = delivery({ desktopAvailable: true, ntfy: TOPIC });
  assert.deepEqual(await both.deliver(CHAT, NOTE), {
    status: "queued", url: "http://127.0.0.1:4175/sessions/session-a", channels: ["desktop", "ntfy"],
  });
  assert.deepEqual(both.published, ["http://127.0.0.1:4175/sessions/session-a"]);
});

test("a visible desktop chat does not suppress the phone's notification", async () => {
  const both = delivery({ desktopAvailable: true, desktop: async () => ({ status: "in-view", url: "http://127.0.0.1:4175/sessions/session-a" }), ntfy: TOPIC });
  assert.deepEqual(await both.deliver(CHAT, NOTE), {
    status: "queued", url: "http://127.0.0.1:4175/sessions/session-a", channels: ["desktop", "ntfy"],
  });
});

test("one channel falling over leaves the other to deliver, and the failure is recorded", async () => {
  const desktopFailed = delivery({
    desktopAvailable: true,
    desktop: async () => { throw new Error("Install the current HUI desktop app with `hui install-app`."); },
    ntfy: TOPIC,
  });
  assert.deepEqual(await desktopFailed.deliver(CHAT, NOTE), { status: "queued", channels: ["ntfy"] });
  assert.deepEqual(desktopFailed.skipped, [{ channel: "desktop", message: "Install the current HUI desktop app with `hui install-app`." }]);

  const relayFailed = delivery({ desktopAvailable: true, ntfy: TOPIC, publish: async () => { throw new Error("ntfy answered HTTP 503 for the configured topic."); } });
  assert.deepEqual(await relayFailed.deliver(CHAT, NOTE), {
    status: "queued", url: "http://127.0.0.1:4175/sessions/session-a", channels: ["desktop"],
  });
  assert.deepEqual(relayFailed.skipped, [{ channel: "ntfy", message: "ntfy answered HTTP 503 for the configured topic." }]);
});

test("with no channel at all the caller is told how to set one, and both failing reports the desktop reason", async () => {
  await assert.rejects(delivery().deliver(CHAT, NOTE), new RegExp(NO_NOTIFICATION_CHANNEL.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  const broken = delivery({
    desktopAvailable: true,
    desktop: async () => { throw new Error("macOS did not accept the HUI notification."); },
    ntfy: TOPIC,
    publish: async () => { throw new Error("Could not reach the ntfy server."); },
  });
  await assert.rejects(broken.deliver(CHAT, NOTE), /macOS did not accept/u);
  assert.deepEqual(broken.skipped.map(({ channel }) => channel), ["desktop", "ntfy"]);
});

test("unreadable relay settings read as no relay, and are recorded when a notification needed them", async () => {
  const state = delivery({ ntfy: new Error("settings.json could not be read") });
  await assert.rejects(state.deliver(CHAT, NOTE), new RegExp(NO_NOTIFICATION_CHANNEL.slice(0, 20), "u"));
  assert.deepEqual(state.skipped, [{ channel: "ntfy", message: "settings.json could not be read" }]);
  assert.equal(await state.canDeliver(), false);
});

test("canDeliver answers whether anybody would hear HUI's own events", async () => {
  assert.equal(await delivery().canDeliver(), false);
  assert.equal(await delivery({ desktopAvailable: true }).canDeliver(), true);
  assert.equal(await delivery({ ntfy: TOPIC }).canDeliver(), true);
  assert.equal(await delivery({ ntfy: { server: "https://ntfy.sh", topic: "" } }).canDeliver(), false);
});
