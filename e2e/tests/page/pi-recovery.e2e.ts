/** A PI page reads PI and HUI state, names a failed read, and keeps the last data when a later refresh fails (PAGE-027). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a PI page shows its loading and failed states and keeps the last data when a refresh fails", { tags: ["PAGE-027"], platforms: ["web"] }, async ({ screen, hui }) => {
  const loading = screen.getByText("Reading PI and HUI state…", { exact: true });

  const held = await hui.intercept("GET", /\/__hui\/pi$/u);
  await hui.open("/config");
  await held.arrived();
  await expect(loading).toBeVisible();
  await held.reject(503, "PI settings are unreadable");
  await expect(screen.getByText("PI settings are unreadable", { exact: true })).toBeVisible();

  await hui.open("/config");
  await expect(loading).toBeHidden();
  await expect(screen.getByText("HUI-owned", { exact: true })).toBeVisible();

  const failing = await hui.answerAll("GET", /\/__hui\/pi$/u, JSON.stringify({ error: "PI settings are unreadable." }), 503);
  await screen.getByRole("button", "Refresh").click();
  await expect(screen.getByText("PI settings are unreadable.", { exact: true })).toBeVisible();
  await expect(screen.getByText("HUI-owned", { exact: true })).toBeVisible();
  await failing.stop();
});
