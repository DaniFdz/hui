/** An export's setup document is a bot's own BOOTSTRAP.md on import, so it can be no longer than one: a bot whose
 * onboarding body fills it has that body left out of the setup, and the export dialog says so before Download (BOT-061). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { roster } from "./bot-panel.ts";

/** Long enough that the fixed part of a setup document plus this body passes what a bot's BOOTSTRAP.md holds (6,000). */
const BODY = Array.from({ length: 60 }, (_, index) => `- Step ${index + 1}: E2E_SETUP read what the operator asked, check the page, and say what changed.`).join("\n");

test("an export's setup stays within a bot's BOOTSTRAP.md and names what it left out", { tags: ["BOT-061"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.api("POST", "/__hui/bots", { name: "Quill", soul: "# Who I am\nE2E_SOUL: a fixture bot.\n", bootstrap: BODY });

  await hui.open("/");
  await roster(screen, hui);
  const actions = screen.getByRole("button", "Actions for Quill");
  await actions.focus();
  await actions.tap();
  await screen.getByText("Export…", { exact: true, visible: true }).first().tap();

  await expect(screen.getByText("Left out of its setup")).toBeVisible();
  await expect(screen.getByText(`The previous owner's onboarding body (${BODY.length.toLocaleString("en-US")} characters)`)).toBeVisible();
  await expect(screen.getByText("Its setup (BOOTSTRAP.md) is full at 6,000 characters", { exact: false })).toBeVisible();
});
