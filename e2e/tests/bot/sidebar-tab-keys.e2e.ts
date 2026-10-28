/** The sidebar tabs (Agents, Bots, Files) move with the arrow keys, and Home and End jump to the ends (BOT-002). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("ArrowLeft and ArrowRight move between the sidebar tabs, and Home and End jump to the ends", { tags: ["BOT-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/");
  const tab = (name: string) => screen.getByRole("tab", name);
  const press = async (from: string, key: string, to: string) => {
    await tab(from).press(key);
    await expect(tab(to)).toHaveAttribute("aria-selected", "true");
    await expect(tab(to)).toBeFocused();
  };

  await expect(tab("Agents")).toHaveAttribute("aria-selected", "true");
  await press("Agents", "ArrowRight", "Bots");
  await press("Bots", "ArrowRight", "Files");
  await press("Files", "ArrowRight", "Agents");
  await press("Agents", "ArrowLeft", "Files");
  await press("Files", "Home", "Agents");
  await press("Agents", "End", "Files");
});
