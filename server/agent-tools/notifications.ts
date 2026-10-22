/** macOS notifications for one chat, delivered by the installed HUI app rather than Script Editor: the notify_user
 * tool's alerts for its authenticated caller, and HUI's own session notifications. The native app acknowledges
 * delivery, or that the chat is already in front; macOS controls whether its banner stays visible. */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Type, type Static } from "typebox";
import Value from "typebox/value";
import { readState } from "../../cli/state.ts";

const parameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  subtitle: Type.Optional(Type.String({ maxLength: 120 })),
  message: Type.Optional(Type.String({ maxLength: 1_000 })),
  priority: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("normal"), Type.Literal("high")])),
}, { additionalProperties: false });

export type DesktopNotification = Static<typeof parameters>;
export type NotificationChat = { id: string; bot?: string };

export async function deliverDesktopNotification(
  chat: NotificationChat,
  notification: DesktopNotification,
  signal?: AbortSignal,
): Promise<{ status: "queued" | "in-view"; url: string }> {
  if (platform() !== "darwin") throw new Error("HUI desktop notifications currently require a macOS gateway.");
  const state = await readState();
  if (!state || state.pid !== process.pid) throw new Error("Desktop notifications require the managed HUI gateway.");
  const bundle = join(homedir(), "Applications", "HUI.app");
  const resources = join(bundle, "Contents", "Resources");
  const owner = await readFile(join(resources, "hui-owner"), "utf8").catch(() => "");
  const capability = await readFile(join(resources, "hui-notifications"), "utf8").catch(() => "");
  if (owner !== "org.harnessui.desktop" || capability !== "3") {
    throw new Error("Install the current HUI desktop app with `hui install-app` to enable clickable chat notifications.");
  }
  const path = chat.bot ? `/bots/${encodeURIComponent(chat.bot)}` : `/sessions/${encodeURIComponent(chat.id)}`;
  const url = new URL(path, state.url).href;
  signal?.throwIfAborted();
  const token = randomBytes(32).toString("hex");
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  let resolveReceipt!: (status: "queued" | "in-view") => void;
  let rejectReceipt!: (error: Error) => void;
  const receipt = new Promise<"queued" | "in-view">((resolve, reject) => { resolveReceipt = resolve; rejectReceipt = reject; });
  const server = createServer((request, response) => {
    const status = request.url?.slice(`/${token}/`.length);
    if (request.method !== "POST" || !request.url?.startsWith(`/${token}/`)
      || !["queued", "in-view", "failed", "unsupported", "wrong-gateway"].includes(status ?? "")) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(204).end();
    if (status === "queued" || status === "in-view") resolveReceipt(status);
    else if (status === "failed") rejectReceipt(new Error("macOS did not accept the HUI notification. Allow notifications for HUI in System Settings → Notifications, then retry."));
    else rejectReceipt(new Error(`HUI desktop notification was refused (${status}).`));
  });
  const onAbort = () => rejectReceipt(new Error("HUI did not acknowledge the notification. Restart the HUI desktop app and retry."));
  deadline.addEventListener("abort", onAbort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Notification receipt has no loopback address.");
    const payload = { ...notification, url, replyTo: `http://127.0.0.1:${address.port}/${token}/` };
    const [status] = await Promise.all([
      receipt,
      promisify(execFile)("/usr/bin/open", ["-g", "-a", bundle, `hui-notification:${encodeURIComponent(JSON.stringify(payload))}`], { timeout: 10_000, signal: deadline }),
    ]);
    return { status, url };
  } finally {
    deadline.removeEventListener("abort", onAbort);
    server.close();
    server.closeAllConnections();
  }
}

export async function notifyUser(
  caller: NotificationChat,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ status: "queued" | "in-view"; url: string; message: string }> {
  if (!Value.Check(parameters, params) || !params.title.trim()) {
    throw new Error("notify_user requires a title (1–120 characters). Subtitle (up to 120), message (up to 1000) and priority (low, normal or high) are optional, and it takes no destination.");
  }
  const { status, url } = await deliverDesktopNotification(caller, {
    title: params.title.trim(),
    ...(params.subtitle?.trim() ? { subtitle: params.subtitle.trim() } : {}),
    ...(params.message?.trim() ? { message: params.message.trim() } : {}),
    priority: params.priority ?? "normal",
  }, signal);
  return status === "in-view"
    ? { status, url, message: "The operator has this chat in front in the HUI app, so HUI showed no banner." }
    : { status, url, message: "HUI queued a notification for this chat. macOS notification settings may suppress the banner." };
}
