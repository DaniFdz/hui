/** The sidebar's work destinations, and the Settings footer both of its lists end with (SHELL-001, SHELL-002). */
import assert from "node:assert/strict";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** Each destination, and text only its own page shows: the label alone also exists in the sidebar. */
const DESTINATIONS = [
  ["Contributions", "Commits and pull requests of the GitHub accounts signed in to"],
  ["Kanban", "Backlog items and where each session is in development."],
  ["Sessions", "Active sessions and defaults."],
  ["Usage", "Recorded tokens and PI cost estimates."],
] as const;

test("the sidebar lists its work destinations above a Settings footer", { tags: ["SHELL-001", "smoke"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/");
  const navigation = screen.getByTestId("primary-navigation");

  await expect(navigation).toBeVisible();
  await expect(navigation.getByText("Home")).toHaveCount(0);
  // Destinations in reading order: each row starts below the one before it.
  let previous = -Infinity;
  for (const [label] of DESTINATIONS) {
    const row = navigation.getByText(label);
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    assert(box);
    expect(box.y).toBeGreaterThan(previous);
    previous = box.y;
  }

  // Settings closes the sidebar instead of sitting among the destinations, so the tab panel cannot scroll it away.
  await expect(navigation.getByText("Settings")).toHaveCount(0);
  const settings = screen.getByTestId("nav-settings");
  await expect(settings).toBeVisible();
  const settingsBox = await settings.boundingBox();
  assert(settingsBox);
  expect(settingsBox.y).toBeGreaterThan(previous);
  await expect(screen.getByLabel("Collapse sidebar")).toBeVisible();

  // The Bots list shows no destinations, and keeps Settings.
  await screen.getByRole("tab", "Bots").tap();
  await expect(navigation).toBeHidden();
  await expect(settings).toBeVisible();

  await screen.getByRole("tab", "Agents").tap();
  await expect(navigation).toBeVisible();
  await expect(settings).toBeVisible();
});

test("a destination opens its page and keeps it across a reload", { tags: ["SHELL-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/");

  for (const [label, page] of DESTINATIONS) {
    await screen.getByTestId("primary-navigation").getByText(label).tap();
    await expect(screen.getByText(page, { exact: false }).first()).toBeVisible();
    await hui.reload();
    await expect(screen.getByText(page, { exact: false }).first()).toBeVisible();
  }

  await screen.getByTestId("nav-settings").tap();
  await expect(screen.getByText("HUI and PI preferences for this workspace.").first()).toBeVisible();
  await hui.reload();
  await expect(screen.getByText("HUI and PI preferences for this workspace.").first()).toBeVisible();
});