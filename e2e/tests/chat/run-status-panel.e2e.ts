/** The chat header's Run status panel: the pill morphs into it and back, the head reads the same state as the pill, and
 * a wide window's automatic open, the X and the trigger are one toggle (CHAT-090). */
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
  const idle = screen.getByLabel("Session status: Idle");
  // A wide window opens the panel by itself while a turn streams; sent from the keyboard, so the composer keeps the
  // focus that automatic open must not steal.
  const hold = async () => {
    await message.fill(heldEcho);
    await message.press("Enter");
    await hui.provider.held();
  };

  // The first turn writes the plan that keeps the trigger alive. Wait for it to settle before reading the panel: a wide
  // window has that panel open while a run streams, so a closed panel is only provable once the run is over.
  await message.fill("E2E_PROGRESS");
  await send.tap();
  await expect(transcript.getByText("Working through the fixture.")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(trigger).toHaveAccessibleName(/^Run status:/u);
  await expect(popover).toBeHidden();
  await expect(trigger).not.toBeExpanded();

  // The next turn holds the provider, and the pill morphs into the panel it opens: the head reads the same state as the
  // trigger — mark, word and count — so one control visibly becomes the other. The trigger keeps its box, its mark and
  // its chevron and only its copy steps aside, so the screen reads the word once while the accessible name, and that
  // hidden copy, keep the whole summary.
  await hold();
  await expect(popover).toBeVisible();
  await expect(message).toBeFocused();
  await expect(trigger).toBeExpanded();
  await expect(trigger).toHaveAccessibleName(/^Run status: Working, 1 of 2 steps done$/u);
  await expect(trigger).toHaveText("Working 1/2");
  await expect(popover.getByText("Working", { exact: true })).toBeVisible();
  await expect(popover.getByText("1/2", { exact: true })).toBeVisible();

  // Escape closes it and gives the trigger focus.
  await trigger.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).not.toBeExpanded();
  await expect(trigger).toBeFocused();

  // That press closed the panel and stopped nothing: the provider is still holding the turn, so Escape never reached
  // the pane's Stop. The status word alone cannot say so, because a stopped run whose provider is still held keeps
  // reading Running; the Stop control is what shows the press asked for a stop, and stays disabled while it waits.
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeEnabled();

  // The operator's close holds for the run it was made in, and the next run starts from the default again.
  await hui.provider.release();
  await expect(idle).toBeVisible();
  await expect(popover).toBeHidden();

  // The next run opens the panel by itself and closes it when it settles, with no press from the operator. That close is
  // HUI's own, so the run after it opens the panel again instead of finding the panel shut by a choice nobody made.
  await hold();
  await expect(popover).toBeVisible();
  await hui.provider.release();
  await expect(idle).toBeVisible();
  await expect(popover).toBeHidden();

  await hold();
  await expect(popover).toBeVisible();

  // The trigger is one toggle: it closes the open panel and opens the closed one, and the chevron points up while the
  // panel is out. Close run status closes it too and gives focus back.
  await trigger.tap();
  await expect(popover).toBeHidden();
  await expect(trigger).not.toBeExpanded();
  await trigger.tap();
  await expect(popover).toBeVisible();
  await expect(trigger).toBeExpanded();
  await screen.getByLabel("Close run status").tap();
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();

  await hui.provider.release();
  await expect(idle).toBeVisible();
});
