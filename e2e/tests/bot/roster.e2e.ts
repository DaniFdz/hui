/** The roster lists bots by latest activity, each with its face or emoji, name, latest message or role and a short time, and Search bots matches name, handle and title or says "No matching bots." (BOT-008). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const makeBot = async (hui: Hui, body: Record<string, unknown>) =>
  (await hui.api<{ bot: { id: string; handle: string } }>("POST", "/__hui/bots", { soul: "# Who I am\nA terse fixture bot.\n", ...body })).bot;

test("the roster lists bots by latest activity with a face or an emoji, a preview and a time, and Search bots matches name, handle and title", { tags: ["BOT-008"], platforms: ["web"] }, async ({ screen, hui }) => {
  await makeBot(hui, { name: "Alpha", title: "Research helper" });
  const zeta = await makeBot(hui, { name: "Zeta", avatar: { emoji: "🦊" } });
  await hui.api("PATCH", `/__hui/bots/${zeta.id}`, { title: "Night owl" });

  await hui.open("/");
  await screen.getByRole("tab", "Bots").tap();
  const alphaRow = screen.getByLabel(/^Alpha,/u);
  const zetaRow = screen.getByLabel(/^Zeta,/u);
  await expect(alphaRow).toBeVisible();
  await expect(zetaRow).toBeVisible();
  await expect.poll(async () => (await zetaRow.boundingBox())!.y < (await alphaRow.boundingBox())!.y).toBe(true);

  await expect(alphaRow.getByText("Research helper")).toBeVisible();
  await expect(zetaRow.getByText("Night owl")).toBeVisible();
  await expect(alphaRow.getByText("now", { exact: true })).toBeVisible();
  await expect(zetaRow.getByText("now", { exact: true })).toBeVisible();
  const faces = await hui.faces();
  expect(faces.find((face) => face.size === "sm" && face.emoji === "🦊")).toBeDefined();
  expect(faces.find((face) => face.size === "sm" && face.emoji === "")?.shape).toBeTruthy();

  const delta = await makeBot(hui, { name: "Delta" });
  await hui.api("POST", `/__hui/bots/${delta.id}/messages`, { text: "E2E_REPLY:UmVhZHkgd2hlbiB5b3UgYXJlLg" });
  const deltaRow = screen.getByLabel(/^Delta,/u);
  await expect(deltaRow.getByText("Ready when you are.")).toBeVisible();
  await expect.poll(async () => (await deltaRow.boundingBox())!.y < (await zetaRow.boundingBox())!.y).toBe(true);

  const search = screen.getByPlaceholder("Search bots");
  await search.fill("zeta");
  await expect(alphaRow).toBeHidden();
  await expect(zetaRow).toBeVisible();
  await search.fill("@alpha");
  await expect(alphaRow).toBeVisible();
  await expect(zetaRow).toBeHidden();
  await search.fill("RESEARCH");
  await expect(alphaRow).toBeVisible();
  await expect(zetaRow).toBeHidden();
  await search.fill("nothing here");
  await expect(screen.getByText("No matching bots.")).toBeVisible();
  await search.fill("");
  await expect(zetaRow).toBeVisible();
  await expect(alphaRow).toBeVisible();
});