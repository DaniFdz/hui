/** The PI resource reader: the skill's own name while it loads, and the error it was answered with when the skill left
 * PI's inventory or its file cannot be read (RICH-050). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const RESOURCE = /\/__hui\/pi\/resources\/skill\/[a-f0-9]{24}$/u;

test("While loading the reader says Reading <name>…, a skill that left PI's inventory shows Skill not found. and one that cannot be read shows its own error", { tags: ["RICH-050"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/skills");
  const read = screen.getByRole("button", "Read automate-me");
  await expect(read).toBeVisible();

  // Held open, the reader says what it is reading; a skill the gateway no longer has says why.
  const gone = await hui.intercept("GET", RESOURCE);
  await read.tap();
  await expect(screen.getByText("Reading automate-me…")).toBeVisible();
  await gone.reject(404, "Skill not found.");
  const reader = screen.getByRole("dialog", "automate-me");
  await expect(reader.getByRole("alert")).toHaveText("Skill not found.");
  await screen.getByRole("button", "Close reader").tap();
  await expect(reader).toBeHidden();

  // A file the gateway cannot read reports the reason it gave, in the reader, and leaves Settings in place.
  const unreadable = await hui.intercept("GET", RESOURCE);
  await read.tap();
  await expect(screen.getByText("Reading automate-me…")).toBeVisible();
  await unreadable.reject(500, "The skill file could not be read.");
  await expect(screen.getByRole("dialog", "automate-me").getByRole("alert")).toHaveText("The skill file could not be read.");
  await screen.getByRole("button", "Close reader").tap();
  await expect(screen.getByRole("heading", "Installed skills")).toBeVisible();
});
