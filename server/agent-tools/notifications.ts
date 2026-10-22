/** Explicit macOS notifications for the authenticated caller's chat, delivered by the installed HUI app rather
 * than Script Editor. The native app acknowledges delivery; macOS controls whether its banner stays visible. */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";
import Value from "typebox/value";
import { readState } from "../../cli/state.ts";

const parameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  message: Type.String({ minLength: 1, maxLength: 1_000 }),
}, { additionalProperties: false });

export async function notifyUser(
  caller: { id: string; bot?: string },
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ status: "queued"; url: string; message: string }> {
  if (!Value.Check(parameters, params) || !params.title.trim() || !params.message.trim()) {
    throw new Error("notify_user requires a title (1–120 characters) and message (1–1000 characters), with no destination argument.");
  }
  if (platform() !== "darwin") throw new Error("HUI desktop notifications currently require a macOS gateway.");
  const state = await readState();
  if (!state || state.pid !== process.pid) throw new Error("Desktop notifications require the managed HUI gateway.");
  const bundle = join(homedir(), "Applications", "HUI.app");
  const resources = join(bundle, "Contents", "Resources");
  const owner = await readFile(join(resources, "hui-owner"), "utf8").catch(() => "");
  const capability = await readFile(join(resources, "hui-notifications"), "utf8").catch(() => "");
  if (owner !== "org.harnessui.desktop" || capability !== "1") {
    throw new Error("Install the current HUI desktop app with `hui install-app` to enable clickable chat notifications.");
  }
  const path = caller.bot ? `/bots/${encodeURIComponent(caller.bot)}` : `/sessions/${encodeURIComponent(caller.id)}`;
  const url = new URL(path, state.url).href;
  signal?.throwIfAborted();
  const token = randomBytes(32).toString("hex");
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  let resolveReceipt!: () => void;
  let rejectReceipt!: (error: Error) => void;
  const receipt = new Promise<void>((resolve, reject) => { resolveReceipt = resolve; rejectReceipt = reject; });
  const server = createServer((request, response) => {
    const status = request.url?.slice(`/${token}/`.length);
    if (request.method !== "POST" || !request.url?.startsWith(`/${token}/`)
      || !["queued", "failed", "unsupported", "wrong-gateway"].includes(status ?? "")) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(204).end();
    if (status === "queued") resolveReceipt();
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
    await Promise.all([
      receipt,
      promisify(execFile)("/usr/bin/open", [
        "-g", "-n", bundle, "--args", "--hui-notification",
        JSON.stringify({ title: params.title.trim(), message: params.message.trim(), url, replyTo: `http://127.0.0.1:${address.port}/${token}/` }),
      ], { timeout: 10_000, signal: deadline }),
    ]);
  } finally {
    deadline.removeEventListener("abort", onAbort);
    server.close();
    server.closeAllConnections();
  }
  return { status: "queued", url, message: "HUI queued a notification for this chat. macOS notification settings may suppress the banner." };
}
