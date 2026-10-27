/** ArrowDown and ArrowUp walk the composer's command menu across its groups and wrap, the highlight follows, Enter and Tab complete the entry without sending, and Escape closes the menu leaving the draft as typed (CHAT-046). */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const EXTENSION = `export default function (pi) {
  pi.registerCommand("key-check", { description: "Extension command the keys reach", handler: async () => undefined });
}
`;

test("ArrowDown and ArrowUp walk the menu across groups and wrap, Enter and Tab complete, and Escape keeps the draft", { tags: ["CHAT-046"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const pi = join(repository.path, ".pi");
  await mkdir(join(pi, "skills", "key-skill"), { recursive: true });
  await mkdir(join(pi, "prompts"), { recursive: true });
  await mkdir(join(pi, "extensions"), { recursive: true });
  await writeFile(join(pi, "skills", "key-skill", "SKILL.md"), "---\nname: key-skill\ndescription: Skill the keys reach.\n---\nUse only for command menu checks.\n");
  await writeFile(join(pi, "prompts", "key-template.md"), "---\ndescription: Template the keys reach.\n---\nSay hello.\n");
  await writeFile(join(pi, "extensions", "key-check.js"), EXTENSION);
  const session = await hui.createSession({ title: "Menu keys", cwd: repository.path });
  await hui.open(`/sessions/${session.id}`);
  const message = screen.getByLabel("Message");
  const menu = screen.getByLabel("Commands and paths");
  const active = (name: RegExp) => menu.getByRole("option", { name, selected: true });
  const before = await hui.providerRequests();

  await message.fill("/key");
  await expect(active(/^\$key-check/u)).toBeVisible();
  await expect(menu.getByRole("option", { selected: true })).toHaveCount(1);

  await message.press("ArrowDown");
  await expect(active(/^\$key-skill/u)).toBeVisible();
  await message.press("ArrowDown");
  await expect(active(/^\/key-template/u)).toBeVisible();
  await message.press("ArrowDown");
  await expect(active(/^\$key-check/u)).toBeVisible();
  await message.press("ArrowUp");
  await expect(active(/^\/key-template/u)).toBeVisible();
  await message.press("ArrowUp");
  await expect(active(/^\$key-skill/u)).toBeVisible();

  await message.press("Enter");
  await expect(message).toHaveValue("$key-skill ");
  await expect(menu).toBeHidden();
  await message.fill("/key");
  await message.press("Tab");
  await expect(message).toHaveValue("$key-check ");
  await expect(menu).toBeHidden();
  await message.fill("/key");
  await message.press("Escape");
  await expect(menu).toBeHidden();
  await expect(message).toHaveValue("/key");
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  expect(await hui.providerRequests()).toBe(before);
});