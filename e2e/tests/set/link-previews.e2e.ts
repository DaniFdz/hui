/** Turning GitHub or Datadog link previews off persists on this device and leaves the other switch alone (SET-015, SET-016). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Chat = { githubEmbeds: boolean; datadogEmbeds: boolean };

const chat = async (hui: { storedAppearance(): Promise<Record<string, unknown> | null> }) => (await hui.storedAppearance())?.chat as Chat;

test("GitHub link previews can be turned off and the choice persists", { tags: ["SET-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  const toggle = screen.getByRole("switch", "GitHub link previews");

  await hui.open("/settings/appearance");
  await expect(toggle).toBeChecked();
  await toggle.press("Space");
  await expect(toggle).not.toBeChecked();
  expect(await chat(hui)).toEqual({ githubEmbeds: false, collapseTaskProgress: false, datadogEmbeds: true, messageWidth: "comfortable", sendShortcut: "enter" });
  // The gateway keeps no preview switch: it belongs to the device that draws the cards.
  expect(((await hui.api<{ chat: Record<string, unknown> }>("GET", "/__hui/settings")).chat as Record<string, unknown>).githubEmbeds).toBeUndefined();

  await hui.reload();
  await expect(toggle).not.toBeChecked();
});

test("Datadog link previews can be turned off and the choice persists", { tags: ["SET-016"], platforms: ["web"] }, async ({ screen, hui }) => {
  const toggle = screen.getByRole("switch", "Datadog link previews");

  await hui.open("/settings/appearance");
  await expect(toggle).toBeChecked();
  await toggle.press("Space");
  await expect(toggle).not.toBeChecked();
  expect(await chat(hui)).toEqual({ githubEmbeds: true, collapseTaskProgress: false, datadogEmbeds: false, messageWidth: "comfortable", sendShortcut: "enter" });
  expect(((await hui.api<{ chat: Record<string, unknown> }>("GET", "/__hui/settings")).chat as Record<string, unknown>).datadogEmbeds).toBeUndefined();

  await hui.reload();
  await expect(toggle).not.toBeChecked();
});
