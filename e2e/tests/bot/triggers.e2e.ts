/** A trigger steers a bot's running turn by default, and two events join it together (BOT-069). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a trigger steers a bot's running turn by default, and two events join it together", { tags: ["BOT-069"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { bot } = await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Ada", soul: "# Who I am\nA fixture bot that reviews pull requests." });
  const { hook } = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it.", cooldownSeconds: 0 });
  const transcript = screen.getByTestId("transcript");
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");

  await hui.open(`/bots/${bot.id}`);
  await message.fill("E2E_REPLAY the operator's own turn");
  await send.tap();
  await hui.provider.held();

  // Two listener events arrive while the bot's turn is held at the model. Each delivery is accepted by the bot's
  // session before its trigger records the run, so both are waiting in the turn when it is released.
  for (const id of ["one", "two"]) {
    const event = { id, summary: `review ${id}`, details: `RAW ${id}`, at: new Date().toISOString() };
    await hui.api("POST", hook.path, { events: [event] });
  }
  await expect.poll(async () => (await hui.api<{ runs: unknown[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).runs.length).toBe(2);
  await hui.provider.release();

  await expect(transcript.getByText("review one").first()).toBeVisible();
  await expect(transcript.getByText("review two").first()).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  // The add form steers unless the operator clears the box.
  await screen.getByRole("button", "Add trigger").tap();
  await expect(screen.getByLabel("Steer the current turn with summaries and PR links only")).toBeChecked();
});
