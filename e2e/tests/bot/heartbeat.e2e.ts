/** The gateway heartbeat continues an idle watched session without a bot turn (BOT-077). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

type Listed = { id: string; title: string; status: string };

test("the gateway heartbeat continues an idle watched session", { tags: ["BOT-077"], platforms: ["web"] }, async ({ hui }) => {
  const target = await hui.createSession({ title: "Heartbeat target" });
  const watcher = await hui.createSession({ title: "Heartbeat watcher" });
  const sessions = async () => (await hui.api<{ groups: Array<{ sessions: Listed[] }> }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  await expect.poll(async () => (await sessions()).find((session) => session.id === target.id)?.status, { timeout: 30_000 }).toBe("idle");

  await hui.prompt(watcher, call("watch_session", { action: "add", session: target.id }));
  await expect.poll(async () => (await sessions()).find((session) => session.id === watcher.id)?.status, { timeout: 30_000 }).toBe("idle");

  const run = await hui.api<{ continued: string[] }>("POST", "/__hui/heartbeat");
  expect(run.continued).toContain(target.id);
  await expect.poll(async () => (await hui.stored("Continue the task and report progress; do not start new work.")).length, { timeout: 30_000 }).toBeGreaterThan(0);
});
