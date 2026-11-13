/** The PI resource reader's loading and error states: the reader says *Reading <name>…* while the gateway answers, and a
 * skill that can no longer be read (its file replaced) or that has left PI's inventory (its directory gone) shows the
 * gateway's error in the reader instead of a document (RICH-050). The skill is one this test writes into the fixture's
 * own skills root, so nothing another test reads is touched. */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const PROBE = ["---", "name: e2e-reader-probe", "description: A skill the reader fails to show.", "---", "", "# Probe heading", "", "Written by the shared suite.", ""].join("\n");

test("The resource reader says Reading <name>… while it loads, and shows the error when its file cannot be read or the skill has left PI's inventory", { tags: ["RICH-050"], platforms: ["web"] }, async ({ screen, hui }) => {
  const pi = await hui.api<{ skills: { name: string; root: string }[] }>("GET", "/__hui/pi");
  const root = pi.skills.find(({ name }) => name === "sdk-fixture")!.root;
  const skill = { name: "e2e-reader-probe", dir: join(root, "e2e-reader-probe") };
  const file = join(skill.dir, "SKILL.md");
  await mkdir(skill.dir, { recursive: true });
  await writeFile(file, PROBE);

  await hui.open("/skills");
  const read = screen.getByRole("button", `Read ${skill.name}`);
  await expect(read).toBeVisible();
  const close = screen.getByRole("button", "Close reader");

  // Held while the gateway answers, the reader says what it is reading.
  const held = await hui.intercept("GET", /\/__hui\/pi\/resources\/skill\//u);
  await read.tap();
  await held.arrived();
  await expect(screen.getByText(`Reading ${skill.name}…`, { exact: true })).toBeVisible();
  await held.deliver();
  await expect(screen.getByRole("heading", { name: "Probe heading" })).toBeVisible();
  await expect(screen.getByText(`Reading ${skill.name}…`, { exact: true })).toBeHidden();
  await close.tap();
  await expect(close).toBeHidden();

  // A skill still listed by PI whose file cannot be read: its own document is a directory, not a file.
  await rm(file);
  await mkdir(file);
  await read.tap();
  await expect(screen.getByText("The resource file is not available.", { exact: true })).toBeVisible();
  await close.tap();
  await expect(close).toBeHidden();

  // A skill that has left PI's inventory: its directory is gone, and the reader says so rather than reading nothing.
  await rm(skill.dir, { recursive: true, force: true });
  await read.tap();
  await expect(screen.getByText("Skill not found.", { exact: true })).toBeVisible();
  await expect(close).toBeVisible();
  // The row the page still draws is behind the reader, which is where the failure stays.
  await expect(screen.getByRole("heading", { name: "Probe heading" })).toBeHidden();
  await close.tap();
  await expect(close).toBeHidden();
});
