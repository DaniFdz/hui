/** Turning GitHub or Datadog link previews off persists and leaves the other switch alone (SET-015, SET-016). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Chat = { chat: { githubEmbeds: boolean; datadogEmbeds: boolean } };

test("GitHub link previews can be turned off and the choice persists", { tags: ["SET-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  const toggle = screen.getByRole("switch", "GitHub link previews");

  await hui.open("/settings/appearance");
  await expect(toggle).toBeChecked();
  await toggle.press("Space");
  await expect(toggle).not.toBeChecked();
  const settings = await hui.api<Chat>("GET", "/__hui/settings");
  expect(settings.chat.githubEmbeds).toBe(false);
  expect(settings.chat.datadogEmbeds).toBe(true);

  await hui.reload();
  await expect(toggle).not.toBeChecked();
});

test("Datadog link previews can be turned off and the choice persists", { tags: ["SET-016"], platforms: ["web"] }, async ({ screen, hui }) => {
  const toggle = screen.getByRole("switch", "Datadog link previews");

  await hui.open("/settings/appearance");
  await expect(toggle).toBeChecked();
  await toggle.press("Space");
  await expect(toggle).not.toBeChecked();
  const settings = await hui.api<Chat>("GET", "/__hui/settings");
  expect(settings.chat.datadogEmbeds).toBe(false);
  expect(settings.chat.githubEmbeds).toBe(true);

  await hui.reload();
  await expect(toggle).not.toBeChecked();
});
