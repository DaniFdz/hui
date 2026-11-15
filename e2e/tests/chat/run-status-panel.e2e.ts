/** The chat header's Run status panel: one state word, a wide window's automatic open, and the X and the trigger as its
 * one toggle (CHAT-090). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { Settings } from "../../../src/api/schema/settings.ts";

const heldEcho = `E2E_HOLD:${Buffer.from(JSON.stringify({ name: "fixture_echo", input: { text: "held" } })).toString("base64url")}`;

test("Run status opens by itself while a run works, and its X and trigger are one toggle", { tags: ["CHAT-090"], platforms: ["web"] }, async ({ screen, hui }) => {
  // HUI writes the plan with the utility model; this instance points it at the fixture.
  const settings = await hui.api<Settings>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });

  const session = await hui.createSession({ title: "Run status panel" });
  await hui.open(`/sessions/${session.id}`);
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const trigger = screen.getByTestId("run-status-trigger");
  const popover = screen.getByLabel("Run status");

  // The first turn writes the plan that keeps the trigger alive. Wait for it to settle before reading the panel: a wide
  // window has that panel open while a run streams, so a closed panel is only provable once the run is over.
  await message.fill("E2E_PROGRESS");
  await send.tap();
  await expect(transcript.getByText("Working through the fixture.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(trigger).toHaveAccessibleName(/^Run status:/u);
  await expect(popover).toBeHidden();

  // The next turn holds the provider. A wide window opens the panel by itself, and the trigger says the state once,
  // with its count; the head names Run status and marks the tone without repeating the word.
  // Sent from the keyboard, so the composer keeps the focus the automatic open must not steal.
  await message.fill(heldEcho);
  await message.press("Enter");
  await hui.provider.held();
  await expect(popover).toBeVisible();
  await expect(message).toBeFocused();
  await expect(trigger).toHaveAccessibleName(/^Run status: Working, 1 of 2 steps done$/u);
  await expect(trigger).toHaveText("Working 1/2");
  await expect(popover).not.toContainText("Working");

  // Escape closes it and gives the trigger focus.
  await trigger.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();

  // The trigger is one toggle: it opens the closed panel.
  await trigger.tap();
  await expect(popover).toBeVisible();

  // Close run status closes it and gives focus back; a second press of the trigger opens it again.
  await screen.getByLabel("Close run status").tap();
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.tap();
  await expect(popover).toBeVisible();

  await hui.provider.release();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
