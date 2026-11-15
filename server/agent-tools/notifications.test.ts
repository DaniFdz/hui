import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";

const host = vi.hoisted(() => {
  const state: {
    home: string;
    platform: string;
    gateway: { pid: number; url: string } | undefined;
    launches: { command: string; args: string[] }[];
    failure: Error | null;
    reply: string;
  } = { home: "", platform: "darwin", gateway: undefined, launches: [], failure: null, reply: "queued" };
  return state;
});
vi.mock("node:os", async (original) => ({
  ...await original<typeof import("node:os")>(),
  homedir: () => host.home,
  platform: () => host.platform,
}));
vi.mock("../../cli/state.ts", () => ({ readState: async () => host.gateway }));
vi.mock("node:child_process", () => ({
  execFile: (command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    host.launches.push({ command, args });
    callback(host.failure, "", "");
    if (!host.failure && host.reply !== "none") {
      const { replyTo } = JSON.parse(decodeURIComponent(new URL(args.at(-1) ?? "").pathname));
      void fetch(new URL(host.reply, replyTo), { method: "POST" });
    }
  },
}));
import { appChatLink, notificationChatLink, notifyUser } from "./notifications.ts";

beforeEach(async () => {
  host.home = await mkdtemp(join(tmpdir(), "hui-notifications-"));
  host.platform = "darwin";
  host.gateway = { pid: process.pid, url: "http://127.0.0.1:4173/" };
  host.launches = [];
  host.failure = null;
  host.reply = "queued";
  const resources = join(host.home, "Applications/HUI.app/Contents/Resources");
  await mkdir(resources, { recursive: true });
  await writeFile(join(resources, "hui-owner"), "org.harnessui.desktop");
  await writeFile(join(resources, "hui-notifications"), "3");
});
afterEach(() => rm(host.home, { recursive: true, force: true }));

test("an app link opens the chat on the gateway the app is connected to, and never carries an address", async () => {
  // The phone shell's deep link (`mobile/android` DeepLink, `mobile/ios` SceneDelegate) and the desktop app's.
  const chat = { id: "4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f" };
  assert.equal(appChatLink("phone", chat), "hui://open?path=/sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f");
  assert.equal(appChatLink("desktop", chat), "hui://sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f");
  assert.equal(appChatLink("phone", { id: "bot-session", bot: "stable-bot" }), "hui://open?path=/bots/stable-bot", "a bot chat opens where its own name does");
  assert.equal(appChatLink("desktop", { id: "bot-session", bot: "stable-bot" }), "hui://bots/stable-bot");
  // A shell refuses a path that hides a scheme or a character a URL cannot carry, so an id stays encoded as an address
  // encodes it and cannot smuggle anything of its own into the path.
  assert.equal(appChatLink("phone", { id: "http://evil.example/" }), "hui://open?path=/sessions/http%3A%2F%2Fevil.example%2F");
  assert.equal(appChatLink("phone", { id: "a b" }), "hui://open?path=/sessions/a%20b");

  // The browser link is the gateway's own address, which needs the managed gateway; an app link needs no address at all.
  assert.equal(await notificationChatLink(chat, "web"), "http://127.0.0.1:4173/sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f");
  assert.equal(await notificationChatLink(chat, "phone"), "hui://open?path=/sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f");
  host.gateway = undefined;
  assert.equal(await notificationChatLink(chat, "web"), undefined, "no gateway address, no browser link");
  assert.equal(await notificationChatLink(chat, "desktop"), "hui://sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f");
});

test("notifications carry the caller's regular or stable bot chat, not a model-supplied destination", async () => {
  for (const [caller, expected] of [
    [{ id: "session-a" }, "http://127.0.0.1:4173/sessions/session-a"],
    [{ id: "bot-session", bot: "stable-bot" }, "http://127.0.0.1:4173/bots/stable-bot"],
  ] satisfies [{ id: string; bot?: string }, string][]) {
    const result = await notifyUser(caller, { title: " Ready ", subtitle: " Tests ", message: " Open this chat. ", priority: "high" });
    assert.equal(result.status, "queued");
    assert.equal(result.url, expected);
    const launch = host.launches.at(-1);
    assert.ok(launch);
    assert.equal(launch.command, "/usr/bin/open");
    assert.deepEqual(launch.args.slice(0, -1), ["-g", "-a", join(host.home, "Applications/HUI.app")]);
    const link = new URL(launch.args.at(-1) ?? "");
    assert.equal(link.protocol, "hui-notification:");
    const { replyTo, ...payload } = JSON.parse(decodeURIComponent(link.pathname));
    assert.deepEqual(payload, { title: "Ready", subtitle: "Tests", message: "Open this chat.", priority: "high", url: expected });
    assert.match(replyTo, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/$/);
  }
  await notifyUser({ id: "session-a" }, { title: "Ready", subtitle: " ", message: "" });
  const link = new URL(host.launches.at(-1)?.args.at(-1) ?? "");
  const { replyTo: _replyTo, ...defaults } = JSON.parse(decodeURIComponent(link.pathname));
  assert.deepEqual(defaults, { title: "Ready", priority: "normal", url: "http://127.0.0.1:4173/sessions/session-a" });
  for (const params of [
    { title: "Ready", message: "Open", url: "https://example.com" },
    { title: "Ready", message: "Open", sessionId: "someone-else" },
    { title: " ", message: "Open" },
    { title: "x".repeat(121), message: "Open" },
    { title: "Ready", subtitle: "x".repeat(121) },
    { title: "Ready", message: "x".repeat(1_001) },
    { title: "Ready", priority: "urgent" },
  ]) {
    await assert.rejects(notifyUser({ id: "caller" }, params), /requires a title/);
  }
  assert.equal(host.launches.length, 3, "invalid requests never launch an app");
});

test("an alert for the chat the operator has in front reports in-view instead of queued", async () => {
  host.reply = "in-view";
  const result = await notifyUser({ id: "session-a" }, { title: "Ready" });
  assert.equal(result.status, "in-view");
  assert.match(result.message, /in front/);
});

test("unsupported, stale and failed delivery never falls back to Script Editor or reports sent", async () => {
  const params = { title: "Ready", message: "Open this chat." };
  host.platform = "linux";
  await assert.rejects(notifyUser({ id: "caller" }, params), /macOS gateway/);
  host.platform = "darwin";
  host.gateway = { pid: process.pid + 1, url: "http://127.0.0.1:4173/" };
  await assert.rejects(notifyUser({ id: "caller" }, params), /managed HUI gateway/);
  host.gateway = { pid: process.pid, url: "http://127.0.0.1:4173/" };
  const resources = join(host.home, "Applications/HUI.app/Contents/Resources");
  await unlink(join(resources, "hui-notifications"));
  await assert.rejects(notifyUser({ id: "caller" }, params), /hui install-app/);
  await writeFile(join(resources, "hui-notifications"), "2");
  await assert.rejects(notifyUser({ id: "caller" }, params), /hui install-app/);
  await writeFile(join(resources, "hui-notifications"), "3");
  await writeFile(join(resources, "hui-owner"), "someone-else");
  await assert.rejects(notifyUser({ id: "caller" }, params), /hui install-app/);
  assert.equal(host.launches.length, 0);
  await writeFile(join(resources, "hui-owner"), "org.harnessui.desktop");
  host.failure = new Error("app launch failed");
  await assert.rejects(notifyUser({ id: "caller" }, params), /app launch failed/);
  assert.equal(host.launches.length, 1);
  host.failure = null;
  host.reply = "failed";
  await assert.rejects(notifyUser({ id: "caller" }, params), /Allow notifications for HUI in System Settings/);
  for (const status of ["unsupported", "wrong-gateway"]) {
    host.reply = status;
    await assert.rejects(notifyUser({ id: "caller" }, params), { message: `HUI desktop notification was refused (${status}).` });
  }
  host.reply = "none";
  await assert.rejects(notifyUser({ id: "caller" }, params, AbortSignal.timeout(100)), /did not acknowledge/);
});
