/** Skills lists PI's installed skills and the reader shows the chosen one (SET-061). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Pi = { skills: { id: string; name: string }[] };

test("Skills lists the installed skills and reads one", { tags: ["SET-061"], platforms: ["web"] }, async ({ screen, hui }) => {
  const pi = await hui.api<Pi>("GET", "/__hui/pi");
  await hui.open("/skills");
  for (const skill of pi.skills) await expect(screen.getByText(new RegExp(`^${skill.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:\\s|$)`, "u")).first()).toBeVisible();

  const first = pi.skills[0]!;
  const document = await hui.api<{ fileName: string }>("GET", `/__hui/pi/resources/skill/${encodeURIComponent(first.id)}`);
  await screen.getByRole("button", `Read ${first.name}`).tap();
  await expect(screen.getByText(document.fileName, { exact: true }).first()).toBeVisible();
  await screen.getByRole("button", "Close reader").tap();
  await expect(screen.getByRole("button", "Close reader")).toBeHidden();
});
