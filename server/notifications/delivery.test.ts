import assert from "node:assert/strict";
import { test } from "vitest";
import type { DesktopNotification, NotificationChat } from "../agent-tools/notifications.ts";
import { createNotificationDelivery, notificationPushMessage, partialPushRecord, NO_NOTIFICATION_CHANNEL, type NotificationChannel, type PushReach } from "./delivery.ts";
import { chatPath } from "../agent-tools/notifications.ts";
import type { NtfySettings } from "./ntfy.ts";
import type { PushSettings } from "../api/settings.ts";

const CHAT: NotificationChat = { id: "session-a" };
const NOTE: DesktopNotification = { title: "Fix the drawer", subtitle: "Finished", priority: "low" };
const TOPIC: NtfySettings = { server: "https://ntfy.sh", topic: "hui-abc", link: "web" };
const PUSH_ON: PushSettings = { enabled: true, subject: "" };

function delivery(options: {
  desktopAvailable?: boolean;
  desktop?: () => Promise<{ status: "queued" | "in-view"; url: string }>;
  ntfy?: NtfySettings | Error;
  publish?: (url: string | undefined) => Promise<void>;
  push?: PushReach | Error;
  pushPublish?: () => Promise<void>;
} = {}) {
  const published: (string | undefined)[] = [];
  const pushed: PushSettings[] = [];
  const skipped: { channel: NotificationChannel; message: string }[] = [];
  const composed = createNotificationDelivery({
    desktop: {
      available: () => options.desktopAvailable ?? false,
      deliver: options.desktop ?? (async () => ({ status: "queued", url: "http://127.0.0.1:4175/sessions/session-a" })),
    },
    ntfy: {
      settings: async () => {
        if (options.ntfy instanceof Error) throw options.ntfy;
        return options.ntfy ?? { server: "https://ntfy.sh", topic: "", link: "web" };
      },
      publish: async (_settings, _chat, _notification, url) => {
        published.push(url);
        await options.publish?.(url);
      },
    },
    push: {
      settings: async () => {
        if (options.push instanceof Error) throw options.push;
        return options.push ?? { settings: PUSH_ON, subscriptions: 0 };
      },
      publish: async (settings) => {
        pushed.push(settings);
        await options.pushPublish?.();
      },
    },
    skipped: (error, channel) => skipped.push({ channel, message: error instanceof Error ? error.message : String(error) }),
  });
  return { ...composed, published, pushed, skipped };
}

/** One subscribed device on an otherwise off relay: nothing but Web Push can carry this notification. */
const reach = (settings: PushSettings = PUSH_ON, subscriptions = 1): PushReach => ({ settings, subscriptions });

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

test("a subscribed device hears it through Web Push, alone or beside the relay", async () => {
  const pushOnly = delivery({ push: reach() });
  assert.deepEqual(await pushOnly.deliver(CHAT, NOTE), { status: "queued", channels: ["push"] });
  assert.deepEqual(pushOnly.pushed, [PUSH_ON], "the channel publishes with the settings it read");

  const withRelay = delivery({ ntfy: TOPIC, push: reach() });
  assert.deepEqual(await withRelay.deliver(CHAT, NOTE), { status: "queued", channels: ["ntfy", "push"] });
  assert.deepEqual(withRelay.skipped, []);
});

test("a visible desktop chat does not suppress the phone's notification", async () => {
  const both = delivery({ desktopAvailable: true, desktop: async () => ({ status: "in-view", url: "http://127.0.0.1:4175/sessions/session-a" }), ntfy: TOPIC });
  assert.deepEqual(await both.deliver(CHAT, NOTE), {
    status: "queued", url: "http://127.0.0.1:4175/sessions/session-a", channels: ["desktop", "ntfy"],
  });
  // Web Push cannot make a chat in view either: a device's banner is never suppressed by the desktop app's screen.
  const withPush = delivery({ desktopAvailable: true, desktop: async () => ({ status: "in-view", url: "http://127.0.0.1:4175/sessions/session-a" }), push: reach() });
  assert.deepEqual(await withPush.deliver(CHAT, NOTE), {
    status: "queued", url: "http://127.0.0.1:4175/sessions/session-a", channels: ["desktop", "push"],
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

test("a failing push keeps the notification queued while the relay carries it, and the failure is recorded", async () => {
  const relayTookIt = delivery({ ntfy: TOPIC, push: reach(), pushPublish: async () => { throw new Error("The push service answered HTTP 500."); } });
  assert.deepEqual(await relayTookIt.deliver(CHAT, NOTE), { status: "queued", channels: ["ntfy"] });
  assert.deepEqual(relayTookIt.skipped, [{ channel: "push", message: "The push service answered HTTP 500." }]);

  // With nothing else on, a failing push is the reason the caller is told: the channel was there, it just refused.
  const alone = delivery({ push: reach(), pushPublish: async () => { throw new Error("The push service answered HTTP 500."); } });
  await assert.rejects(alone.deliver(CHAT, NOTE), /The push service answered HTTP 500/u);
  assert.deepEqual(alone.skipped, [{ channel: "push", message: "The push service answered HTTP 500." }]);
});

test("push alone queues the notification, and an unreadable push state is recorded like the relay's", async () => {
  const pushOnly = delivery({ push: reach() });
  assert.deepEqual(await pushOnly.deliver(CHAT, NOTE), { status: "queued", channels: ["push"] });
  assert.deepEqual(pushOnly.skipped, []);

  const unreadable = delivery({ push: new Error("The push subscription store could not be read") });
  await assert.rejects(unreadable.deliver(CHAT, NOTE), new RegExp(NO_NOTIFICATION_CHANNEL.slice(0, 20), "u"));
  assert.deepEqual(unreadable.skipped, [{ channel: "push", message: "The push subscription store could not be read" }]);
  assert.equal(await unreadable.canDeliver(), false);
});

test("with no channel at all the caller is told how to set one, and both failing reports the desktop reason", async () => {
  await assert.rejects(delivery().deliver(CHAT, NOTE), new RegExp(NO_NOTIFICATION_CHANNEL.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  const broken = delivery({
    desktopAvailable: true,
    desktop: async () => { throw new Error("macOS did not accept the HUI notification."); },
    ntfy: TOPIC,
    publish: async () => { throw new Error("Could not reach the ntfy server."); },
    push: reach(),
    pushPublish: async () => { throw new Error("Could not reach the push service."); },
  });
  await assert.rejects(broken.deliver(CHAT, NOTE), /macOS did not accept/u);
  assert.deepEqual(broken.skipped.map(({ channel }) => channel), ["desktop", "ntfy", "push"]);
});

test("unreadable relay settings read as no relay, and are recorded when a notification needed them", async () => {
  const state = delivery({ ntfy: new Error("settings.json could not be read") });
  await assert.rejects(state.deliver(CHAT, NOTE), new RegExp(NO_NOTIFICATION_CHANNEL.slice(0, 20), "u"));
  assert.deepEqual(state.skipped, [{ channel: "ntfy", message: "settings.json could not be read" }]);
  assert.equal(await state.canDeliver(), false);
});

test("a partially refused push is recorded with who was reached, in the shape the skipped channels use", () => {
  assert.deepEqual(partialPushRecord(2, 3, new Error("The push service answered HTTP 500.")), {
    action: "notification_push_partial",
    summary: "HUI pushed a notification to 2 of 3 devices",
    detail: "The push service answered HTTP 500.",
  });
  // A thrown value that is not an Error still becomes a sentence rather than a diagnostic that cannot be built.
  assert.equal(partialPushRecord(1, 2, "HTTP 410").detail, "HTTP 410");
  assert.equal(partialPushRecord(1, 2, "HTTP 410").summary, "HUI pushed a notification to 1 of 2 devices");
});

test("a push carries the same in-app path the other channels open", () => {
  const message = notificationPushMessage(CHAT, NOTE);
  assert.equal(message.path, chatPath(CHAT));
  assert.equal(message.path, "/sessions/session-a");
  assert.deepEqual(message, { title: "Fix the drawer", body: "Finished", path: "/sessions/session-a", tag: "hui-session-a", priority: "low" });
  // A bot's chat opens where its own name does, exactly as the ntfy link and the desktop app open it.
  const bot = notificationPushMessage({ id: "bot-session", bot: "stable-bot" }, { title: "HUI", priority: "high" });
  assert.equal(bot.path, chatPath({ id: "bot-session", bot: "stable-bot" }));
  assert.deepEqual(bot, { title: "HUI", path: "/bots/stable-bot", tag: "hui-bot-session", priority: "high" }, "no subtitle and no message means no body");
});

test("canDeliver answers whether anybody would hear HUI's own events", async () => {
  assert.equal(await delivery().canDeliver(), false);
  assert.equal(await delivery({ desktopAvailable: true }).canDeliver(), true);
  assert.equal(await delivery({ ntfy: TOPIC }).canDeliver(), true);
  assert.equal(await delivery({ ntfy: { server: "https://ntfy.sh", topic: "", link: "web" } }).canDeliver(), false);
  // Web Push needs both switches: on, and at least one device that subscribed.
  assert.equal(await delivery({ push: reach() }).canDeliver(), true);
  assert.equal(await delivery({ push: reach(PUSH_ON, 0) }).canDeliver(), false, "on with no subscribed device carries nothing");
  assert.equal(await delivery({ push: reach({ enabled: false, subject: "" }, 3) }).canDeliver(), false, "devices without the switch stay quiet");
});
