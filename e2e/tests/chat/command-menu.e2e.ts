/** The composer's `/` menu groups commands by source, narrows as you type, inserts references without sending and stays inside a phone's screen while it scrolls (CHAT-045). */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const skill = (name: string) => `---\nname: ${name}\ndescription: Skill offered by the command menu.\n---\nUse only for command menu checks.\n`;
const TEMPLATE = "---\ndescription: Template offered by the command menu.\n---\nSay hello.\n";
const EXTENSION = `export default function (pi) {
  pi.registerCommand("menu-check", { description: "Extension command in the command menu", handler: async () => undefined });
}
`;

test("the / menu groups commands, narrows as you type, inserts a reference without sending and scrolls inside a phone's screen", { tags: ["CHAT-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const pi = join(repository.path, ".pi");
  for (const name of ["menu-skill", ...Array.from({ length: 12 }, (_, index) => `menu-skill-${String(index + 1).padStart(2, "0")}`)]) {
    await mkdir(join(pi, "skills", name), { recursive: true });
    await writeFile(join(pi, "skills", name, "SKILL.md"), skill(name));
  }
  await mkdir(join(pi, "prompts"), { recursive: true });
  await mkdir(join(pi, "extensions"), { recursive: true });
  await writeFile(join(pi, "prompts", "menu-template.md"), TEMPLATE);
  await writeFile(join(pi, "extensions", "menu-check.js"), EXTENSION);
  const session = await hui.createSession({ title: "Command menu", cwd: repository.path });
  await hui.open(`/sessions/${session.id}`);
  const message = screen.getByLabel("Message");
  const menu = screen.getByLabel("Commands and paths");
  const transcript = screen.getByTestId("transcript");
  const before = await hui.providerRequests();

  await message.fill("/");
  for (const group of ["HUI", "Plugin actions", "Skills", "Prompt templates", "Files and folders"]) await expect(menu.getByText(group, { exact: true })).toBeVisible();
  await expect(menu.getByText("/clear", { exact: true })).toBeVisible();

  await message.fill("/menu");
  await expect(menu.getByText("$menu-check", { exact: true })).toBeVisible();
  await expect(menu.getByText("$menu-skill", { exact: true })).toBeVisible();
  await expect(menu.getByText("/menu-template", { exact: true })).toBeVisible();
  await expect(menu.getByText("/clear", { exact: true })).toBeHidden();

  await message.fill("$zzz");
  await expect(screen.getByText("No matching commands or paths.")).toBeVisible();

  await message.fill("/menu");
  await menu.getByText("$menu-skill", { exact: true }).tap();
  await expect(message).toHaveValue("$menu-skill ");
  await message.fill("/menu");
  await menu.getByText("$menu-check", { exact: true }).tap();
  await expect(message).toHaveValue("$menu-check ");
  await message.fill("/menu");
  await menu.getByText("/menu-template", { exact: true }).tap();
  await expect(message).toHaveValue("/menu-template ");
  await expect(transcript.getByText("Start a conversation")).toBeVisible();
  expect(await hui.providerRequests()).toBe(before);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await message.fill("$");
  await expect(menu.getByText("$menu-skill", { exact: true })).toBeVisible();
  await expect(menu.getByText("$menu-check", { exact: true })).toBeVisible();
  await expect(menu.getByText("/menu-template", { exact: true })).toBeHidden();
  await expect(menu.getByText("/clear", { exact: true })).toBeHidden();

  const phone = await hui.phoneScreen();
  await message.fill("/menu-skill-");
  const first = menu.getByText("$menu-skill-01", { exact: true });
  const last = menu.getByText("$menu-skill-12", { exact: true });
  const composer = (await message.boundingBox())!.y;
  const top = (await first.boundingBox())!;
  expect(top.y).toBeGreaterThanOrEqual(0);
  expect(top.x).toBeGreaterThanOrEqual(0);
  expect(top.x + top.width).toBeLessThanOrEqual(phone.width);
  expect(top.y + top.height).toBeLessThanOrEqual(phone.height);
  expect((await last.boundingBox())!.y).toBeGreaterThan(phone.height);
  await hui.scrollTo(menu, last);
  const scrolled = (await last.boundingBox())!;
  expect(scrolled.y).toBeGreaterThanOrEqual(0);
  expect(scrolled.y + scrolled.height).toBeLessThanOrEqual(phone.height);
  expect((await first.boundingBox())!.y).toBeLessThan(top.y);
  expect((await message.boundingBox())!.y).toBeCloseTo(composer, 0);
});