/** Disabling a skill hides it from HUI sessions without touching PI's installation, and the choice persists (SET-060). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Pi = { skills: { id: string; name: string }[] };

test("a skill can be disabled for HUI and stays disabled after a reload", { tags: ["SET-060"], platforms: ["web"] }, async ({ screen, hui }) => {
  const pi = await hui.api<Pi>("GET", "/__hui/pi");
  const skill = pi.skills[0]!;
  const toggle = screen.getByRole("switch", `Enable ${skill.name} in HUI`);

  await hui.open("/skills");
  await expect(toggle).toBeChecked();
  await toggle.press("Space");
  await expect(toggle).not.toBeChecked();
  const settings = await hui.api<{ disabledSkills: { name: string }[] }>("GET", "/__hui/settings");
  expect(settings.disabledSkills.map((entry) => entry.name)).toContain(skill.name);

  await hui.reload();
  await expect(toggle).not.toBeChecked();
});
