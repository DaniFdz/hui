/** A model with a fast mode offers Speed in the thinking picker, which reads fast, and the choice stays with the session (CHAT-055). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the thinking picker offers Speed only for a model with a fast mode, names itself fast and keeps the choice with the session", { tags: ["CHAT-055"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Fast mode" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  // The fixture model has no fast mode, so its picker holds effort alone.
  await screen.getByLabel("Thinking: high").tap();
  await expect(screen.getByLabel("Thinking effort")).toBeVisible();
  await expect(screen.getByRole("radio", { name: "Fast" })).toHaveCount(0);
  await screen.getByLabel("Thinking: high").tap();

  await screen.getByLabel("Model: HUI SDK Fixture").tap();
  await screen.getByRole("listbox", "Model").getByRole("option", { name: /Opus fixture/u }).tap();
  await expect(screen.getByLabel("Model: Opus fixture")).toBeVisible();

  // Speed is the model's own choice: Standard until the operator picks Fast.
  await screen.getByLabel("Thinking: high").tap();
  const speed = screen.getByRole("radiogroup", "Speed");
  await expect(speed).toBeVisible();
  await expect(speed.getByRole("radio", { name: "Standard" })).toHaveAttribute("aria-checked", "true");
  await expect(speed.getByRole("radio", { name: "Fast" })).toHaveAttribute("aria-checked", "false");
  await speed.getByRole("radio", { name: "Fast" }).tap();
  const picker = screen.getByLabel("Thinking: high, fast");
  await expect(picker).toBeVisible();
  await picker.tap();
  await expect(screen.getByLabel("Thinking effort")).toBeHidden();

  await hui.reload();
  await expect(screen.getByLabel("Thinking: high, fast")).toBeVisible();
  await screen.getByLabel("Thinking: high, fast").tap();
  await expect(screen.getByRole("radiogroup", "Speed").getByRole("radio", { name: "Fast" })).toHaveAttribute("aria-checked", "true");
  // Standard takes the mark and the name back.
  await screen.getByRole("radiogroup", "Speed").getByRole("radio", { name: "Standard" }).tap();
  await expect(screen.getByLabel("Thinking: high")).toBeVisible();
});
