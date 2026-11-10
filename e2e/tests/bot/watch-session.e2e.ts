/** A session watches another in its group, sees it in the session tools, and keeps it going (BOT-075). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

type Listed = { id: string; title: string; status: string };

test("a watcher sees the session it started and can continue it", { tags: ["BOT-075"], platforms: ["web"] }, async ({ hui }) => {
  const chief = (await hui.api<{ bots: Array<{ name: string; sessionId: string }> }>("GET", "/__hui/bots")).bots.find((bot) => bot.name === "Chief of Staff")!;
  const source = { id: chief.sessionId };
  try {
  await hui.prompt(source, call("create_session", {
    prompt: "Say ready.",
    cwd: hui.workspace,
    title: "Watched session",
    worktree: false,
  }));
  const find = async () => (await hui.api<{ groups: Array<{ sessions: Listed[] }> }>("GET", "/__hui/sessions"))
    .groups.flatMap((entry) => entry.sessions).find((session) => session.title === "Watched session");
  await expect.poll(find, { timeout: 30_000 }).toBeTruthy();
  await expect.poll(async () => (await find())?.status, { timeout: 30_000 }).toBe("idle");
  const watched = await find();

  await hui.prompt(source, call("watch_session", { action: "list" }));
  await expect.poll(async () => (await hui.api<{ groups: Array<{ sessions: Listed[] }> }>("GET", "/__hui/sessions"))
    .groups.flatMap((entry) => entry.sessions).find((session) => session.id === chief.sessionId)?.status, { timeout: 30_000 }).toBe("idle");
  await expect.poll(async () => (await hui.stored("Watching 1 session: Watched session")).length, { timeout: 30_000 }).toBeGreaterThan(0);

  await hui.prompt(source, call("sessions_send", { sessionKey: watched!.id, message: "Continue the task.", timeoutSeconds: 10 }));
  await expect.poll(async () => (await find())?.status, { timeout: 30_000 }).toBe("idle");
  await expect.poll(async () => (await hui.stored("Continue the task.")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await hui.api<{ groups: Array<{ sessions: Listed[] }> }>("GET", "/__hui/sessions"))
    .groups.flatMap((entry) => entry.sessions).find((session) => session.id === chief.sessionId)?.status, { timeout: 30_000 }).toBe("idle");
  } finally {
    await hui.api("PATCH", `/__hui/sessions/${chief.sessionId}`, { unread: false });
  }
});
