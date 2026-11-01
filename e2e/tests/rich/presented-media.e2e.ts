/** Media the agent shows through present_media: an image lands inline in the Presented media row and opens in the
 * media viewer, and any other file is a named card with a Download action, both back after a reload (RICH-026, RICH-028). */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const SHOT = new URL("../../fixtures/files/wide-shot.png", import.meta.url);

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");

async function present(screen: Screen, hui: Hui, files: { name: string; bytes: Buffer }[], title: string) {
  const repository = await hui.repository();
  for (const file of files) await writeFile(join(repository.path, file.name), file.bytes);
  const session = await hui.createSession({ title, cwd: repository.path });
  const call = JSON.stringify({ name: "present_media", input: { paths: files.map((file) => file.name) } });
  await hui.prompt(session, `E2E_CALL:${Buffer.from(call).toString("base64url")}`);
  await hui.open(`/sessions/${session.id}`);
  const row = screen.getByLabel("Presented media");
  await expect(row).toBeVisible();
  return { row, session };
}

const edges = async (target: Locator) => {
  const { x, y, width, height } = (await target.boundingBox())!;
  return { left: x, right: x + width, top: y, bottom: y + height };
};

test("A presented image lands inline in the Presented media row with its name, type and size, opens in the viewer, survives a reload and fits a phone", { tags: ["RICH-026"], platforms: ["web"] }, async ({ screen, hui }) => {
  const phone = await hui.phoneScreen();
  const image = await readFile(SHOT);
  const { row } = await present(screen, hui, [{ name: "wide-shot.png", bytes: image }], "Presented image");

  await expect(row.getByText(/wide-shot\.png/u)).toBeVisible();
  await expect(row.getByText("image/png · 2 KB")).toBeVisible();
  const picture = row.getByLabel("Open wide-shot.png");
  await expect(picture).toBeVisible();
  const fits = await edges(row);
  expect(fits.right).toBeLessThanOrEqual(phone.width);
  expect((await edges(picture)).right).toBeLessThanOrEqual(fits.right);
  expect(await hui.overflowX()).toBe(0);

  await row.getByLabel("Open wide-shot.png").tap();
  const viewer = screen.getByLabel("Image viewer: wide-shot.png");
  await expect(viewer).toBeVisible();
  await screen.getByRole("button", "Close viewer").tap();
  await expect(viewer).toBeHidden();

  await hui.reload();
  await expect(row.getByLabel("Open wide-shot.png")).toBeVisible();
  await expect(row.getByText("image/png · 2 KB")).toBeVisible();
});

test("A presented file of another format is a named card with its type, size and a Download action, is not shown inline, and is back after a reload", { tags: ["RICH-028"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { row } = await present(screen, hui, [{ name: "flaky-test.pdf", bytes: PDF }], "Presented file");

  await expect(row.getByText("flaky-test.pdf")).toBeVisible();
  await expect(row.getByText("application/octet-stream · 77 B")).toBeVisible();
  await expect(row.getByLabel("Open flaky-test.pdf")).toBeHidden();

  const saved = await hui.download(row.getByLabel("Download flaky-test.pdf"));
  expect(saved.name).toBe("flaky-test.pdf");
  expect(saved.text).toBe(PDF.toString("utf8"));

  await hui.reload();
  await expect(row.getByText("flaky-test.pdf")).toBeVisible();
  await expect(row.getByLabel("Download flaky-test.pdf")).toBeVisible();
});