/** New task asks for a session first, keeping the Session picker and Create task disabled, when the only chat there is belongs to a bot (PAGE-008). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("New task asks for a session first while only a bot chat exists, with the Session picker and Create task disabled", { tags: ["PAGE-008"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.api("POST", "/__hui/bots", { name: "Solo", title: "Fixture helper", soul: "# Who I am\nA fixture bot.\n" });
  await hui.open("/cron");
  await expect(screen.getByText("Start a session first: automation runs inside a session HUI already owns.")).toBeVisible();
  await expect(screen.getByLabel("Session", { exact: true }).first()).toBeDisabled();
  await expect(screen.getByRole("button", "Create task")).toBeDisabled();
});
