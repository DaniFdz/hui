/** Settings → Tools lists the shipped tools with their source and default, filters them, and shows HUI's default prompt (SET-059). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Tools = {
  tools: { name: string; source: string; defaultEnabled: boolean }[];
  prompt: { revision: string; text: string };
};

test("Tools lists the shipped tools, filters them and shows HUI's default prompt", { tags: ["SET-059"], platforms: ["web"] }, async ({ screen, hui }) => {
  const catalog = await hui.api<Tools>("GET", "/__hui/tools");
  const first = catalog.tools[0]!;

  await hui.open("/settings/tools");
  await expect(screen.getByText(`Shipped tools · ${catalog.tools.length}`, { exact: true })).toBeVisible();
  await expect(screen.getByText(first.name, { exact: true })).toBeVisible();
  await expect(screen.getByText(`${first.source} · ${first.defaultEnabled ? "Default" : "Optional"}`, { exact: true }).first()).toBeVisible();

  const filter = screen.getByLabel("Search tools");
  await filter.fill(first.name);
  await expect(screen.getByText(first.name, { exact: true })).toBeVisible();

  const prompt = screen.getByText(`HUI default prompt · ${catalog.prompt.revision}`, { exact: true });
  await prompt.tap();
  await expect(screen.getByText(catalog.prompt.text.slice(0, 40), { exact: false }).first()).toBeVisible();
});
