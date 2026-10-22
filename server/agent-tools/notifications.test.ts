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
      const { replyTo } = JSON.parse(args.at(-1)?.slice("--hui-notification=".length) ?? "");
      void fetch(new URL(host.reply, replyTo), { method: "POST" });
    }
  },
}));
import { notifyUser } from "./notifications.ts";

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
  await writeFile(join(resources, "hui-notifications"), "1");
});
afterEach(() => rm(host.home, { recursive: true, force: true }));

test("notifications carry the caller's regular or stable bot chat, not a model-supplied destination", async () => {
  for (const [caller, expected] of [
    [{ id: "session-a" }, "http://127.0.0.1:4173/sessions/session-a"],
    [{ id: "bot-session", bot: "stable-bot" }, "http://127.0.0.1:4173/bots/stable-bot"],
  ] satisfies [{ id: string; bot?: string }, string][]) {
    const result = await notifyUser(caller, { title: " Ready ", message: " Open this chat. " });
    assert.equal(result.status, "queued");
    assert.equal(result.url, expected);
    const launch = host.launches.at(-1);
    assert.ok(launch);
    assert.equal(launch.command, "/usr/bin/open");
    assert.deepEqual(launch.args.slice(0, -1), ["-g", "-n", join(host.home, "Applications/HUI.app"), "--args"]);
    const [, notification] = /^--hui-notification=(.+)$/u.exec(launch.args.at(-1) ?? "") ?? [];
    const { replyTo, ...payload } = JSON.parse(notification ?? "");
    assert.deepEqual(payload, { title: "Ready", message: "Open this chat.", url: expected });
    assert.match(replyTo, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/$/);
  }
  for (const params of [
    { title: "Ready", message: "Open", url: "https://example.com" },
    { title: "Ready", message: "Open", sessionId: "someone-else" },
    { title: " ", message: "Open" },
    { title: "Ready", message: " " },
    { title: "x".repeat(121), message: "Open" },
    { title: "Ready", message: "x".repeat(1_001) },
  ]) {
    await assert.rejects(notifyUser({ id: "caller" }, params), /requires a title/);
  }
  assert.equal(host.launches.length, 2, "invalid requests never launch an app");
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
  await writeFile(join(resources, "hui-notifications"), "1");
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
