/** The sidebar's Agents and Bots tabs move with ArrowLeft and ArrowRight (wrapping at both ends) and with Home and End, and the focus follows the choice (BOT-002). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("ArrowLeft and ArrowRight move between the Agents and Bots tabs, Home and End jump to the first and the last, and the focus follows", { tags: ["BOT-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/");
  const agents = screen.getByRole("tab", "Agents");
  const bots = screen.getByRole("tab", "Bots");
  await expect(agents).toHaveAttribute("aria-selected", "true");
  await expect(bots).toHaveAttribute("aria-selected", "false");
  const press = async (key: string) => {
    await hui.keyboard.down(key);
    await hui.keyboard.up(key);
  };

  await agents.focus();
  await press("ArrowRight");
  await expect(bots).toHaveAttribute("aria-selected", "true");
  await expect(bots).toBeFocused();
  await expect(agents).toHaveAttribute("aria-selected", "false");
  await press("ArrowRight");
  await expect(agents).toHaveAttribute("aria-selected", "true");
  await expect(agents).toBeFocused();
  await press("ArrowLeft");
  await expect(bots).toHaveAttribute("aria-selected", "true");
  await expect(bots).toBeFocused();
  await press("ArrowLeft");
  await expect(agents).toHaveAttribute("aria-selected", "true");
  await expect(agents).toBeFocused();
  await press("End");
  await expect(bots).toHaveAttribute("aria-selected", "true");
  await expect(bots).toBeFocused();
  await press("Home");
  await expect(agents).toHaveAttribute("aria-selected", "true");
  await expect(agents).toBeFocused();
});
