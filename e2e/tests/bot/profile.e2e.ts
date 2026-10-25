/** Settings → Profile saves a bot's name and title on its own, the @handle follows the name, and a refusal stays under the field with the text typed (BOT-027). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a bot's name and title save on Enter or on leaving the field, the @handle follows the name and a refusal keeps the text", { tags: ["BOT-027"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Renamable", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  await screen.getByRole("button", "Edit Renamable").tap();
  const name = screen.getByRole("textbox", "Name");
  const title = screen.getByRole("textbox", "Title");
  await expect(name).toHaveValue("Renamable");
  await expect(screen.getByText("@renamable")).toBeVisible();
  await expect(screen.getByRole("button", "Save")).toBeHidden();

  const titleSave = await hui.intercept("PATCH", new RegExp(`/__hui/bots/${bot.id}$`, "u"));
  await title.fill("Fixture tester");
  await title.press("Tab");
  await titleSave.arrived();
  await expect(screen.getByText("Saving…")).toBeVisible();
  await titleSave.deliver();
  await expect(screen.getByText("Saving…")).toBeHidden();
  await expect.poll(async () => (await hui.api<{ bot: { title: string } }>("GET", `/__hui/bots/${bot.id}`)).bot.title).toBe("Fixture tester");
  await expect(screen.getByText("Fixture tester · Idle")).toBeVisible();

  const save = await hui.intercept("PATCH", new RegExp(`/__hui/bots/${bot.id}$`, "u"));
  await name.fill("Scout");
  await name.press("Enter");
  await save.arrived();
  await expect(screen.getByText("Saving…")).toBeVisible();
  await save.deliver();
  await expect(screen.getByText("Saving…")).toBeHidden();
  await expect(screen.getByText("@scout")).toBeVisible();
  await expect.poll(() => screen.getByText("Scout", { exact: true }).count()).toBe(2);
  await expect(screen.getByLabel(/^Scout,/u)).toBeVisible();

  await name.fill("Pathfinder");
  await name.press("Enter");
  await expect(screen.getByText("@pathfinder")).toBeVisible();
  await expect(screen.getByLabel(/^Pathfinder,/u)).toBeVisible();

  const refusal = await hui.intercept("PATCH", new RegExp(`/__hui/bots/${bot.id}$`, "u"));
  await name.fill("Taken name");
  await name.press("Enter");
  await refusal.reject(409, "That handle is taken.");
  await expect(screen.getByText("That handle is taken.")).toBeVisible();
  await expect(name).toHaveValue("Taken name");
  expect((await hui.api<{ bot: { name: string; handle: string } }>("GET", `/__hui/bots/${bot.id}`)).bot).toEqual(expect.objectContaining({ name: "Pathfinder", handle: "pathfinder" }));
});