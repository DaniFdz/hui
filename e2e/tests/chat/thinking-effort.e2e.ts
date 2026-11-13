/** The thinking picker offers the current model's levels plus a Durable session's Ultra, applies a choice live, keeps it across a reload and shows the level a model without that level fits to (CHAT-054). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the effort slider offers the model's levels and Ultra, applies a choice live, keeps it across a reload and fits it to the next model", { tags: ["CHAT-054"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Thinking effort" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await expect(screen.getByLabel("Thinking: high")).toBeVisible();
  await screen.getByLabel("Thinking: high").tap();
  const slider = screen.getByLabel("Thinking effort");
  await expect(slider).toBeVisible();
  await expect(screen.getByText("Faster", { exact: true })).toBeVisible();
  await expect(screen.getByText("Smarter", { exact: true })).toBeVisible();
  // The fixture model's five PI levels, then Ultra, which only a Durable session offers.
  await expect(slider).toHaveAttribute("max", "5");

  await slider.fill("3");
  await expect(screen.getByLabel("Thinking: medium")).toBeVisible();
  await hui.reload();
  await expect(screen.getByLabel("Thinking: medium")).toBeVisible();

  // The highest level is Ultra, which a Durable session adds to the model's own.
  await screen.getByLabel("Thinking: medium").tap();
  await screen.getByLabel("Thinking effort").fill("5");
  await expect(screen.getByLabel("Thinking: ultra")).toBeVisible();
  // The picker holds the level it fitted to: its slider's value reads it, and the panel draws the same text beside its
  // Effort heading. A phone folds the chip's own label beside the gauge, so this value is what both layouts share.
  await expect(screen.getByLabel("Thinking effort")).toHaveAttribute("aria-valuetext", "Ultra");

  // The Opus fixture has no Minimal: a session left there shows the level it fits to.
  await screen.getByLabel("Thinking effort").fill("1");
  await expect(screen.getByLabel("Thinking: minimal")).toBeVisible();
  await screen.getByLabel("Thinking: minimal").tap();
  await expect(screen.getByLabel("Thinking effort")).toBeHidden();
  await screen.getByLabel("Model: HUI SDK Fixture").tap();
  await screen.getByRole("listbox", "Model").getByRole("option", { name: /Opus fixture/u }).tap();
  await expect(screen.getByLabel("Model: Opus fixture")).toBeVisible();
  await screen.getByLabel(/^Thinking: /u).tap();
  await expect(screen.getByLabel("Thinking effort")).toHaveAttribute("aria-valuetext", "Low");
});
