/**
 * One notification, three possible channels: the installed HUI desktop app on macOS, the ntfy relay a phone subscribes
 * to, and Web Push to a device that subscribed through this gateway. A channel that is unavailable is a fallback, not a
 * failure, and the result says which channels accepted the notification so the caller can tell the operator the truth.
 * A channel that rejects a notification is handed to `skipped`, which records it in diagnostics; the notification is
 * only an error when every channel that could have carried it failed. Only the desktop app can have a chat already in
 * front: a phone's banner is never suppressed by it. HUI's own events ask `canDeliver` first: on a gateway nobody
 * listens to, a settled run is not an error worth recording.
 */
import type { DesktopNotification, NotificationChat } from "../agent-tools/notifications.ts";
import { chatPath } from "../agent-tools/notifications.ts";
import { ntfyConfigured, type NtfySettings } from "./ntfy.ts";
import type { PushMessage } from "./push.ts";
import type { PushSettings } from "../api/settings.ts";

export type NotificationChannel = "desktop" | "ntfy" | "push";

export type NotificationDeliveryResult = {
  /** `queued` means at least one channel accepted it; `in-view` means the desktop app is showing that chat. */
  status: "queued" | "in-view";
  /** The chat the notification opens, when the gateway knows the address a device should use. */
  url?: string;
  channels: NotificationChannel[];
};

export type NotificationDispatch = (
  chat: NotificationChat,
  notification: DesktopNotification,
  signal?: AbortSignal,
) => Promise<NotificationDeliveryResult>;

type DesktopDeliver = (
  chat: NotificationChat,
  notification: DesktopNotification,
  signal?: AbortSignal,
) => Promise<{ status: "queued" | "in-view"; url: string }>;

/** The push settings, and how many subscribed devices would receive a message: one with nobody subscribed carries
 * nothing even when it is switched on. */
export type PushReach = { settings: PushSettings; subscriptions: number };

export const NO_NOTIFICATION_CHANNEL =
  "HUI cannot notify you yet: install the HUI desktop app on macOS, set a topic in Settings → Notifications → Phone (ntfy), or turn on Web Push in Settings → Notifications → This device.";

/**
 * One notification as a push message. The tap opens `chatPath`, the same in-app path the desktop app's window and the
 * ntfy link open, so every channel lands in the same chat; the tag is per chat, so a device replaces its own banner
 * instead of stacking one per event.
 */
export function notificationPushMessage(chat: NotificationChat, notification: DesktopNotification): PushMessage {
  const body = [notification.subtitle, notification.message].filter(Boolean).join(" · ");
  return {
    title: notification.title,
    ...(body ? { body } : {}),
    path: chatPath(chat),
    tag: `hui-${chat.id}`,
    ...(notification.priority ? { priority: notification.priority } : {}),
  };
}

/**
 * What diagnostics records when a push batch reached some of its devices and a push service refused the rest: the
 * channel carried the notification, so this names who heard it instead of letting the refusal pass as a success.
 */
export function partialPushRecord(sent: number, devices: number, failure: unknown): {
  action: "notification_push_partial";
  summary: string;
  detail: string;
} {
  return {
    action: "notification_push_partial",
    summary: `HUI pushed a notification to ${sent} of ${devices} devices`,
    detail: failure instanceof Error ? failure.message : String(failure),
  };
}

export function createNotificationDelivery(deps: {
  desktop: { available: () => boolean; deliver: DesktopDeliver };
  ntfy: {
    settings: () => Promise<NtfySettings>;
    publish: (settings: NtfySettings, chat: NotificationChat, notification: DesktopNotification, url: string | undefined) => Promise<void>;
  };
  /** Web Push: the settings that are on with a subscribed device, and the publish that seals one message per device. */
  push: {
    settings: () => Promise<PushReach>;
    publish: (settings: PushSettings, chat: NotificationChat, notification: DesktopNotification) => Promise<void>;
  };
  /** Records a channel that could not carry this notification. Never receives the ntfy topic or a push endpoint. */
  skipped?: (error: unknown, channel: NotificationChannel, chat: NotificationChat) => void;
}): { deliver: NotificationDispatch; canDeliver: () => Promise<boolean> } {
  /** The relay settings, or nothing when they could not be read. */
  const relay = async (chat?: NotificationChat): Promise<NtfySettings | undefined> => {
    try {
      const settings = await deps.ntfy.settings();
      return ntfyConfigured(settings) ? settings : undefined;
    } catch (error) {
      if (chat) deps.skipped?.(error, "ntfy", chat);
      return undefined;
    }
  };

  /** The push settings, or nothing when Web Push is off, has no subscribed device, or could not be read. */
  const reach = async (chat?: NotificationChat): Promise<PushSettings | undefined> => {
    try {
      const state = await deps.push.settings();
      return state.settings.enabled && state.subscriptions > 0 ? state.settings : undefined;
    } catch (error) {
      if (chat) deps.skipped?.(error, "push", chat);
      return undefined;
    }
  };

  const deliver: NotificationDispatch = async (chat, notification, signal) => {
    const ntfy = await relay(chat);
    const push = await reach(chat);
    const desktop = deps.desktop.available();
    if (!desktop && !ntfy && !push) throw new Error(NO_NOTIFICATION_CHANNEL);

    signal?.throwIfAborted();
    const channels: NotificationChannel[] = [];
    let url: string | undefined;
    let desktopStatus: "queued" | "in-view" | undefined;
    let desktopError: unknown;
    if (desktop) {
      try {
        const result = await deps.desktop.deliver(chat, notification, signal);
        url = result.url;
        desktopStatus = result.status;
        channels.push("desktop");
      } catch (error) {
        desktopError = error;
        deps.skipped?.(error, "desktop", chat);
      }
    }

    let ntfyError: unknown;
    if (ntfy) {
      try {
        await deps.ntfy.publish(ntfy, chat, notification, url);
        channels.push("ntfy");
      } catch (error) {
        ntfyError = error;
        deps.skipped?.(error, "ntfy", chat);
      }
    }

    let pushError: unknown;
    if (push) {
      try {
        await deps.push.publish(push, chat, notification);
        channels.push("push");
      } catch (error) {
        pushError = error;
        deps.skipped?.(error, "push", chat);
      }
    }

    if (channels.length === 0) {
      // The desktop app has the more actionable failure (install it, allow notifications), so it wins the report.
      throw desktopError instanceof Error ? desktopError
        : ntfyError instanceof Error ? ntfyError
          : pushError instanceof Error ? pushError : new Error(NO_NOTIFICATION_CHANNEL);
    }
    // Only the desktop app can show a chat in front; a phone's banner is never suppressed by it.
    if (desktopStatus === "in-view" && channels.length === 1) return { status: "in-view", ...(url ? { url } : {}), channels };
    return { status: "queued", ...(url ? { url } : {}), channels };
  };

  return {
    deliver,
    // A failed read is not a channel: HUI's own events stay out of diagnostics rather than failing a settled run.
    canDeliver: async () => deps.desktop.available() || (await relay()) !== undefined || (await reach()) !== undefined,
  };
}
