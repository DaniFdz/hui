/** About names HUI's description and runtime, its Gateway reading "Unavailable" when health cannot be read, and Profile saves a display name and handle that redraw the card and survive a reload (PAGE-025, PAGE-024). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Health = { status: string; transport: string; access: string };

test("About shows HUI's description and runtime, and Gateway reads Unavailable when health cannot be read", { tags: ["PAGE-025"], platforms: ["web"] }, async ({ screen, hui }) => {
  const health = await hui.api<Health>("GET", "/__hui/health");
  const reading = await hui.intercept("GET", /\/__hui\/health$/u);

  await hui.open("/about");
  await reading.arrived();
  await expect(screen.getByTestId("page-title")).toHaveText("About");
  await reading.reject(500, "health is unavailable");
  await expect(screen.getByText("A local browser client that owns presentation and session registry while PI owns conversations and agent configuration.")).toBeVisible();
  await expect(screen.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(screen.getByText(health.status, { exact: true })).toBeHidden();

  await hui.reload();
  await expect(screen.getByText(health.status, { exact: true })).toBeVisible();
  await expect(screen.getByText(health.transport, { exact: true })).toBeVisible();
  await expect(screen.getByText("Full Access", { exact: true })).toBeVisible();
  await expect(screen.getByText("Config and transcripts", { exact: true })).toBeVisible();
  for (const title of ["Gateway", "Transport", "Access mode", "PI ownership"]) await expect(screen.getByText(title, { exact: true })).toBeVisible();
  await expect(screen.getByText("Unavailable", { exact: true })).toBeHidden();
});

test("Profile saves a display name and handle that redraw the card's initials, name and handle, and survive a reload", { tags: ["PAGE-024"], platforms: ["web"] }, async ({ screen, hui }) => {
  const displayName = screen.getByLabel("Display name");
  const handle = screen.getByLabel("Handle");
  const save = screen.getByRole("button", "Save profile");

  await hui.open("/profile");
  await displayName.fill("Ada Lovelace");
  await handle.fill("");
  await save.tap();
  await expect(screen.getByText("Ada Lovelace", { exact: true })).toBeVisible();
  await expect(screen.getByText("AL", { exact: true })).toBeVisible();
  await expect(screen.getByText("No handle set")).toBeVisible();

  await handle.fill("@ada");
  await save.tap();
  await expect(screen.getByText("@ada", { exact: true })).toBeVisible();
  await expect(screen.getByText("No handle set")).toBeHidden();

  await hui.reload();
  await expect(displayName).toHaveValue("Ada Lovelace");
  await expect(handle).toHaveValue("@ada");
  await expect(screen.getByText("Ada Lovelace", { exact: true })).toBeVisible();
  await expect(screen.getByText("AL", { exact: true })).toBeVisible();
  await expect(screen.getByText("@ada", { exact: true })).toBeVisible();
});