/** The gateway heartbeat continues an idle watched session without a bot turn (BOT-077). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

type Listed = { id: string; title: string; status: string };
type Found = { hits: Array<{ id: string; matches: number }> };

test("the gateway heartbeat continues an idle watched session", { tags: ["BOT-077"], platforms: ["web"] }, async ({ hui }) => {
  const target = await hui.createSession({ title: "Heartbeat target" });
  const watcher = await hui.createSession({ title: "Heartbeat watcher" });
  const sessions = async () => (await hui.api<{ groups: Array<{ sessions: Listed[] }> }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  await expect.poll(async () => (await sessions()).find((session) => session.id === target.id)?.status, { timeout: 30_000 }).toBe("idle");

  await hui.prompt(watcher, call("watch_session", { action: "add", session: target.id }));
  await expect.poll(async () => (await sessions()).find((session) => session.id === watcher.id)?.status, { timeout: 30_000 }).toBe("idle");

  const run = await hui.api<{ notified: string[] }>("POST", "/__hui/heartbeat");
  expect(run.notified).toContain(target.id);
  await expect.poll(async () => (await hui.stored("is idle; decide the next step")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await hui.stored("Continue the task and report progress")).toHaveLength(0);
});

test("the heartbeat does not report the same facts twice", { tags: ["BOT-077"], platforms: ["web"] }, async ({ hui }) => {
  const target = await hui.createSession({ title: "Heartbeat repeat target" });
  const watcher = await hui.createSession({ title: "Heartbeat repeat watcher" });
  const sessions = async () => (await hui.api<{ groups: Array<{ sessions: Listed[] }> }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  await expect.poll(async () => (await sessions()).find((session) => session.id === target.id)?.status, { timeout: 30_000 }).toBe("idle");

  await hui.prompt(watcher, call("watch_session", { action: "add", session: target.id }));
  await expect.poll(async () => (await sessions()).find((session) => session.id === watcher.id)?.status, { timeout: 30_000 }).toBe("idle");

  const first = await hui.api<{ notified: string[] }>("POST", "/__hui/heartbeat");
  expect(first.notified).toContain(target.id);
  await expect.poll(async () => (await hui.stored("is idle; decide the next step")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  // The report's turn settles before its transcript is counted, so the count that follows is the first report's alone.
  await expect.poll(async () => (await sessions()).find((session) => session.id === watcher.id)?.status, { timeout: 30_000 }).toBe("idle");

  const reports = async () => (await hui.api<Found>("GET", `/__hui/sessions/search?q=${encodeURIComponent("is idle; decide the next step")}`))
    .hits.find((hit) => hit.id === watcher.id)?.matches ?? 0;
  // The first report is in the watcher's transcript, so the count that follows is a report's to raise.
  await expect.poll(reports, { timeout: 30_000 }).toBeGreaterThan(0);
  const before = await reports();

  const second = await hui.api<{ notified: string[] }>("POST", "/__hui/heartbeat");
  expect(second.notified).not.toContain(target.id);
  expect(await reports()).toBe(before);
});

test("an idle decision is sent to the watcher, not continued", { tags: ["BOT-077"], platforms: ["web"] }, async ({ hui }) => {
  const target = await hui.createSession({ title: "Decision target" });
  await hui.prompt(target, `E2E_REPLY:${Buffer.from("The migration is ready. Should I deploy it?", "utf8").toString("base64url")}`);
  const sessions = async () => (await hui.api<{ groups: Array<{ sessions: Listed[] }> }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  await expect.poll(async () => (await sessions()).find((session) => session.id === target.id)?.status, { timeout: 30_000 }).toBe("idle");

  const watcher = await hui.createSession({ title: "Decision watcher" });
  await hui.prompt(watcher, call("watch_session", { action: "add", session: target.id }));
  await expect.poll(async () => (await sessions()).find((session) => session.id === watcher.id)?.status, { timeout: 30_000 }).toBe("idle");

  const run = await hui.api<{ notified: string[] }>("POST", "/__hui/heartbeat");
  expect(run.notified).toContain(target.id);
  await expect.poll(async () => (await hui.stored("is idle and waiting for a decision")).length, { timeout: 30_000 }).toBeGreaterThan(0);
});
