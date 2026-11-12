/** The sidebar's work destinations, ending with Settings, and this page's gateway in its footer for both lists
 * (SHELL-001, SHELL-002, SHELL-049). */
import assert from "node:assert/strict";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** Each destination, and text only its own page shows: the label alone also exists in the sidebar. */
const DESTINATIONS = [
  ["Dashboard", "The sessions in flight and the resource use of the machines that run them."],
  ["Contributions", "Commits and pull requests of the GitHub accounts signed in to"],
  ["Kanban", "Backlog items and where each session is in development."],
  ["Sessions", "Active sessions and defaults."],
  ["Usage", "Recorded tokens and PI cost estimates."],
] as const;

test("the sidebar lists its work destinations, ending with Settings, above this page's gateway", { tags: ["SHELL-001", "SHELL-049", "smoke"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/");
  await hui.sessionList();
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

  // Settings is the last destination in the same list, so the list scrolls as one piece.
  const settings = navigation.getByTestId("nav-settings");
  await expect(settings).toBeVisible();
  await expect(settings).toHaveText("Settings");
  const settingsBox = await settings.boundingBox();
  assert(settingsBox);
  expect(settingsBox.y).toBeGreaterThan(previous);

  // The footer below both lists is the gateway serving this page, not a Settings link.
  const gateway = screen.getByTestId("sidebar-gateway");
  await expect(gateway).toBeVisible();
  const gatewayBox = await gateway.boundingBox();
  assert(gatewayBox);
  expect(gatewayBox.y).toBeGreaterThan(settingsBox.y);
  await expect(screen.getByLabel("Collapse sidebar")).toBeVisible();

  // The Bots list keeps the same destinations, Settings included, and the gateway.
  await screen.getByRole("tab", "Bots").tap();
  await expect(navigation).toBeVisible();
  for (const [label] of DESTINATIONS) {
    await expect(navigation.getByText(label)).toBeVisible();
  }
  await expect(settings).toBeVisible();
  await expect(gateway).toBeVisible();

  await screen.getByRole("tab", "Agents").tap();
  await expect(navigation).toBeVisible();
  await expect(settings).toBeVisible();
});

test("a destination opens its page and keeps it across a reload", { tags: ["SHELL-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/");

  for (const [label, page] of DESTINATIONS) {
    await hui.sessionList();
    await screen.getByTestId("primary-navigation").getByText(label).tap();
    await expect(screen.getByText(page, { exact: false }).first()).toBeVisible();
    await hui.reload();
    await expect(screen.getByText(page, { exact: false }).first()).toBeVisible();
  }

  await hui.sessionList();
  await screen.getByTestId("nav-settings").tap();
  await expect(screen.getByText("HUI and PI preferences for this workspace.").first()).toBeVisible();
  await hui.reload();
  await expect(screen.getByText("HUI and PI preferences for this workspace.").first()).toBeVisible();
});
