/**
 * One notification, two possible channels: the installed HUI desktop app on macOS, and the ntfy relay a phone
 * subscribes to. A channel that is unavailable is a fallback, not a failure, and the result says which channels
 * accepted the notification so the caller can tell the operator the truth. A channel that rejects a notification is
 * handed to `skipped`, which records it in diagnostics; the notification is only an error when every channel that
 * could have carried it failed. HUI's own events ask `canDeliver` first: on a gateway nobody listens to, a settled
 * run is not an error worth recording.
 */
import type { DesktopNotification, NotificationChat } from "../agent-tools/notifications.ts";
import { ntfyConfigured, type NtfySettings } from "./ntfy.ts";

export type NotificationChannel = "desktop" | "ntfy";

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

export const NO_NOTIFICATION_CHANNEL =
  "HUI cannot notify you yet: install the HUI desktop app on macOS, or set a topic in Settings → Notifications → Phone (ntfy).";

export function createNotificationDelivery(deps: {
  desktop: { available: () => boolean; deliver: DesktopDeliver };
  ntfy: {
    settings: () => Promise<NtfySettings>;
    publish: (settings: NtfySettings, chat: NotificationChat, notification: DesktopNotification, url: string | undefined) => Promise<void>;
  };
  /** Records a channel that could not carry this notification. Never receives the ntfy topic. */
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

  const deliver: NotificationDispatch = async (chat, notification, signal) => {
    const ntfy = await relay(chat);
    const desktop = deps.desktop.available();
    if (!desktop && !ntfy) throw new Error(NO_NOTIFICATION_CHANNEL);

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

    if (channels.length === 0) {
      // The desktop app has the more actionable failure (install it, allow notifications), so it wins the report.
      throw desktopError instanceof Error ? desktopError : ntfyError instanceof Error ? ntfyError : new Error(NO_NOTIFICATION_CHANNEL);
    }
    if (desktopStatus === "in-view" && !channels.includes("ntfy")) return { status: "in-view", ...(url ? { url } : {}), channels };
    return { status: "queued", ...(url ? { url } : {}), channels };
  };

  return {
    deliver,
    canDeliver: async () => deps.desktop.available() || (await relay()) !== undefined,
  };
}
