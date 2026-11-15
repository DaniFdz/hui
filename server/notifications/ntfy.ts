/**
 * The ntfy relay: how a notification reaches a phone or another device that keeps no stream of its own open. HUI
 * publishes one JSON message to `{server}/{topic}`; the operator's ntfy app subscribes to that topic. The topic is a
 * capability and a secret, so it never appears in an error, a log or a diagnostic, and only `HUI_NTFY_TOKEN` in the
 * gateway's environment authenticates a protected server. Reaching ntfy is never on the path of a session: a failed
 * publish rejects this call and the delivery around it decides what the operator is told.
 */
import { NOTIFICATION_SUBTITLES, type DesktopNotification } from "../agent-tools/notifications.ts";

export type NtfySettings = { server: string; topic: string };

/** What one ntfy message says. `priority` is ntfy's own 1–5 scale. */
export type NtfyMessage = {
  title: string;
  message?: string;
  priority: 2 | 3 | 4;
  tags?: string[];
  /** The chat to open when the notification is tapped. */
  click?: string;
};

export type NtfyPublishOptions = {
  /** `HUI_NTFY_TOKEN`: sent as a bearer token, never read from settings or a payload. */
  token?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
};

const PUBLISH_TIMEOUT_MS = 10_000;
/** HUI's own event subtitles, which are what make a notification's tag recognizable at a glance. */
const TAGS: Record<string, string[]> = {
  [NOTIFICATION_SUBTITLES.finished]: ["white_check_mark"],
  [NOTIFICATION_SUBTITLES.failed]: ["x"],
  [NOTIFICATION_SUBTITLES.needsInput]: ["question"],
};

/** Whether these settings name a topic HUI can publish to. An empty or malformed topic keeps the relay off. */
export function ntfyConfigured(settings: NtfySettings | undefined): settings is NtfySettings {
  return settings !== undefined && /^[A-Za-z0-9_-]{1,64}$/u.test(settings.topic);
}

/** The ntfy message for one notification: the chat's name as the title, its subtitle and body as the text. */
export function ntfyMessage(notification: DesktopNotification, click?: string): NtfyMessage {
  const text = [notification.subtitle, notification.message].filter((part): part is string => Boolean(part?.trim()));
  const tags = notification.subtitle ? TAGS[notification.subtitle] : undefined;
  return {
    title: notification.title,
    ...(text.length ? { message: text.join("\n") } : {}),
    priority: notification.priority === "high" ? 4 : notification.priority === "low" ? 2 : 3,
    ...(tags ? { tags } : {}),
    ...(click ? { click } : {}),
  };
}

/** Publishes one message. Resolves once ntfy accepted it, and rejects with a sentence that never names the topic. */
export async function publishNtfy(
  settings: NtfySettings,
  message: NtfyMessage,
  options: NtfyPublishOptions = {},
): Promise<void> {
  if (!ntfyConfigured(settings)) throw new Error("HUI has no ntfy topic to publish to.");
  const base = ntfyBase(settings.server);
  const token = options.token?.trim();
  const deadline = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(PUBLISH_TIMEOUT_MS)])
    : AbortSignal.timeout(PUBLISH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${base}/${encodeURIComponent(settings.topic)}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(message),
      signal: deadline,
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach ${new URL(base).origin} to publish the ntfy notification: ${reason}`);
  }
  // The answer's body is never read: it can echo the request, and nothing here needs it.
  void response.body?.cancel().catch(() => undefined);
  if (!response.ok) throw new Error(`ntfy answered HTTP ${response.status} for the configured topic.`);
}

/** A base address HUI can append a topic to: `http(s)`, a host, and nothing that would carry a secret. */
function ntfyBase(server: string): string {
  const base = server.trim().replace(/\/+$/u, "");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error("The ntfy server is not a valid http(s) address.");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("The ntfy server is not a valid http(s) address.");
  }
  return base;
}
