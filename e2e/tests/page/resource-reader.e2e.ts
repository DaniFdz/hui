/** Escape closes the resource reader and returns focus to the Read button that opened it (PAGE-037). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Escape closes the resource reader and returns focus to the Read button that opened it", { tags: ["PAGE-037"], platforms: ["web"] }, async ({ screen, hui }) => {
  const skill = (await hui.api<{ skills: { name: string; id: string }[] }>("GET", "/__hui/pi")).skills[0]!;
  const document = await hui.api<{ fileName: string }>("GET", `/__hui/pi/resources/skill/${encodeURIComponent(skill.id)}`);
  const read = screen.getByRole("button", `Read ${skill.name}`);

  await hui.open("/skills");
  await read.tap();
  await expect(screen.getByText(document.fileName, { exact: true }).first()).toBeVisible();
  await screen.getByRole("button", "Close reader").press("Escape");
  await expect(screen.getByText(document.fileName, { exact: true })).toBeHidden();
  await expect(screen.getByRole("button", "Close reader")).toBeHidden();
  await expect(read).toBeFocused();
});