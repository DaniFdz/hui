/** The model picker lists the session's models, searches them word by word, switches without losing the transcript, is remembered, is disabled during a run, reports a refused switch and needs a catalog (CHAT-053). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const REFUSED = "The fixture refused this model switch.";

test("the model picker searches, switches, is remembered, waits during a run, reports a refusal and needs a catalog", { tags: ["CHAT-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const message = screen.getByLabel("Message");
  const idle = screen.getByLabel("Session status: Idle");
  const picker = (name: string) => screen.getByLabel(`Model: ${name}`);
  const list = () => screen.getByRole("listbox", "Model");
  const search = () => screen.getByLabel("Search models");
  const option = (name: string) => list().getByRole("option", { name: new RegExp(name, "u") });

  const session = await hui.createSession({ title: "Model picker" });
  await hui.open(`/sessions/${session.id}`);
  await expect(picker("HUI SDK Fixture")).toBeVisible();
  await message.fill("A turn to keep");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();

  await picker("HUI SDK Fixture").tap();
  await expect(search()).toBeVisible();
  await expect(list().getByRole("option")).toHaveCount(3);
  // Every typed word must match the name, provider or id.
  await search().fill("opus anthropic");
  await expect(option("Opus fixture")).toBeVisible();
  await expect(option("HUI SDK Fixture")).toBeHidden();
  await expect(option("HUI Route Fixture")).toBeHidden();
  await search().fill("route hui-e2e");
  await expect(option("HUI Route Fixture")).toBeVisible();
  await expect(option("Opus fixture")).toBeHidden();
  await search().fill("");
  await option("HUI Route Fixture").tap();

  await expect(picker("HUI Route Fixture")).toBeVisible();
  await expect(transcript.getByText("A turn to keep")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await hui.reload();
  await expect(picker("HUI Route Fixture")).toBeVisible();

  // A busy run leaves the choice alone.
  await message.fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await picker("HUI Route Fixture").tap();
  await expect(option("Opus fixture")).toBeDisabled();
  await expect(option("HUI Route Fixture")).toBeDisabled();
  await picker("HUI Route Fixture").tap();
  await hui.provider.release();
  await expect(idle).toBeVisible();

  // A switch the gateway refuses says why, and keeps the session on its model.
  const held = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/model$/u);
  await picker("HUI Route Fixture").tap();
  await option("Opus fixture").tap();
  await held.reject(500, REFUSED);
  await expect(screen.getByText(REFUSED, { exact: true })).toBeVisible();
  await expect(picker("HUI Route Fixture")).toBeVisible();
  await screen.getByRole("button", "Dismiss notification").tap();

  // Without a catalog the picker names the model and refuses to open.
  const stub = await hui.answerAll("GET", /\/__hui\/sessions\/[^/]+\/models$/u, JSON.stringify({ models: [] }));
  await hui.reload();
  const bare = screen.getByLabel("Model: HUI Route Fixture. No model catalog available");
  await expect(bare).toBeVisible();
  await expect(bare).toHaveAttribute("aria-disabled", "true");
  await stub.stop();
});
