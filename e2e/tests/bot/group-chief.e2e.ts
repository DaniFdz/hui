/** A custom project group's menu creates its own Chief of Staff, in that project, with the pack's skills (BOT-072). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a custom group's menu creates one Chief of Staff working in its project", { tags: ["BOT-072"] }, async ({ screen, hui }) => {
  const group = "Chief Group E2E";
  await hui.createSession({ title: "Group seed", group, cwd: hui.workspace });
  await hui.open("/");
  const navigation = screen.getByRole("button", "Open navigation");
  if (await navigation.count()) await navigation.tap();
  await screen.getByRole("button", `Group options for ${group}`).tap();
  await screen.getByText("Create Chief of Staff", { exact: true, visible: true }).first().tap();

  // Creating the bot also creates its conversation and writes its skills: wait for it instead of racing the request.
  await expect.poll(async () => (await hui.api<{ bots: Array<{ group?: string }> }>("GET", "/__hui/bots")).bots.some((bot) => bot.group === group), { timeout: 60_000 }).toBe(true);
  const bots = (await hui.api<{ bots: Array<{ id: string; group?: string; name: string; cwd: string }> }>("GET", "/__hui/bots")).bots;
  const chief = bots.find((bot) => bot.group === group)!;
  expect(chief).toBeTruthy();
  expect(chief.name).toBe(`Chief of Staff · ${group}`);
  expect(chief.cwd).toBe(hui.workspace);
  await expect.poll(() => hui.url()).toContain(`/bots/${chief.id}`);

  // Its own pack skills are installed and editable, and asking again opens the same chief.
  await expect(screen.getByRole("button", /^Tools & skills/u)).toBeVisible();
  await hui.api("POST", "/__hui/staff/chiefs", { group, cwd: hui.workspace });
  const after = (await hui.api<{ bots: Array<{ id: string; group?: string }> }>("GET", "/__hui/bots")).bots.filter((bot) => bot.group === group);
  expect(after.map((bot) => bot.id)).toEqual([chief.id]);
});
