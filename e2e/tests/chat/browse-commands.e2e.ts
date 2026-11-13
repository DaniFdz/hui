/** New Session lists the skills its session will have, and Start session & browse commands opens the started session on the project's full command menu without a model call (CHAT-044). */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const skill = (name: string) => `---\nname: ${name}\ndescription: Skill offered before the first prompt.\n---\nUse only for browse-commands checks.\n`;
const TEMPLATE = "---\ndescription: Template offered by the browse-commands menu.\n---\nSay hello.\n";
const EXTENSION = `export default function (pi) {
  pi.registerCommand("browse-check", { description: "Extension command in the browse-commands menu", handler: async () => undefined });
}
`;

test("New Session lists the skills its session starts with, and Start session & browse commands opens the project's full menu", { tags: ["CHAT-044"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const pi = join(repository.path, ".pi");
  await mkdir(join(pi, "skills", "browse-skill"), { recursive: true });
  await writeFile(join(pi, "skills", "browse-skill", "SKILL.md"), skill("browse-skill"));
  await mkdir(join(pi, "prompts"), { recursive: true });
  await mkdir(join(pi, "extensions"), { recursive: true });
  await writeFile(join(pi, "prompts", "browse-template.md"), TEMPLATE);
  await writeFile(join(pi, "extensions", "browse-check.js"), EXTENSION);

  const launchMessage = screen.getByPlaceholder("What should this session work on?");
  const menu = screen.getByLabel("Commands and paths");
  const message = screen.getByLabel("Message");
  const before = await hui.providerRequests();

  await hui.open("/");
  await screen.getByLabel("Project directory").fill(repository.path);
  await launchMessage.fill("/");
  // Before the session exists, the menu already lists the skills it will start with, and offers the way to browse.
  await expect(menu.getByText("Skills", { exact: true })).toBeVisible();
  await expect(menu.getByText("$sdk-fixture", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Start session & browse commands").tap();

  await expect(message).toHaveValue("/");
  await expect(message).toBeFocused();
  await expect(menu).toBeVisible();
  for (const group of ["HUI", "Plugin actions", "Skills", "Prompt templates"]) await expect(menu.getByText(group, { exact: true })).toBeVisible();
  await expect(menu.getByText("$browse-skill", { exact: true })).toBeVisible();
  await expect(menu.getByText("/browse-template", { exact: true })).toBeVisible();
  await expect(menu.getByText("$browse-check", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(screen.getByTestId("transcript").getByText("Start a conversation")).toBeVisible();
  // Starting to browse is not a turn.
  expect(await hui.providerRequests()).toBe(before);
});
