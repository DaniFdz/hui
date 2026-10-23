/** A run cut off by a gateway restart carries on by itself, and a chat left running gets an accent unread dot when it settles that outlives a restart (CHAT-018, CHAT-017). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a run cut off by a gateway restart carries on without manual action, on Pi Durable and on PI's worker", { tags: ["CHAT-018"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript", { visible: true });
  const status = (value: string) => screen.getByLabel(`Session status: ${value}`, { visible: true });
  const recovery = transcript.getByText(/^The previous run was interrupted while handling this request:\s+E2E_REPLAY\s+Review the latest transcript and workspace state/u);
  const cutOff = async (session: { id: string }) => {
    await hui.open(`/sessions/${session.id}`);
    await expect(status("Idle")).toBeVisible();
    await screen.getByLabel("Message").fill("E2E_REPLAY");
    await screen.getByRole("button", "Send message").tap();
    await hui.provider.held();
    await expect(transcript.getByText("Replay prefix —", { exact: false })).toBeVisible();
    const reconnect = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/connect$/u);
    await hui.restartGateway();
    await reconnect.arrived();
    await expect(screen.getByText("Reconnecting — draft preserved.")).toBeVisible();
    await reconnect.deliver();
    await hui.provider.held();
    await expect(screen.getByText("Reconnecting — draft preserved.")).toBeHidden();
    await expect(status("Running")).toBeVisible();
  };

  await cutOff(await hui.createSession({ title: "Durable restart" }));
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(status("Idle")).toBeVisible();
  await expect(recovery).toBeHidden();

  await cutOff(await hui.createSession({ title: "Worker restart", tool: "pi" }));
  await expect(recovery).toBeVisible();
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(status("Idle")).toBeVisible();
});

test("a chat left running keeps running, and the accent unread dot it gets on settling outlives a gateway restart until the chat is opened", { tags: ["CHAT-017"], platforms: ["web"] }, async ({ screen, hui }) => {
  const row = (state: string) => screen.getByLabel(`Left running, status ${state}, tool durable, stage investigation`);
  const unread = screen.getByLabel("Left running, status idle, tool durable, stage investigation, unread");

  const left = await hui.createSession({ title: "Left running" });
  await hui.createSession({ title: "Somewhere else" });
  await hui.open(`/sessions/${left.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await screen.getByLabel("Somewhere else, status idle, tool durable, stage investigation").tap();
  await expect(row("running")).toBeVisible();
  await screen.getByRole("button", "New session in OTHER").tap();
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  await expect(row("running")).toBeVisible();

  await hui.provider.release();
  await expect(unread).toBeVisible();
  expect(await hui.accentDot("Left running")).toBe(true);
  await hui.restartGateway();
  await hui.reload();
  await expect(unread).toBeVisible();
  expect(await hui.accentDot("Left running")).toBe(true);

  await unread.tap();
  await expect(screen.getByTestId("transcript", { visible: true }).getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(row("idle")).toBeVisible();
  expect(await hui.accentDot("Left running")).toBe(false);
});
