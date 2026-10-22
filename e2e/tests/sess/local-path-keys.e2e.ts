/** With New Session's Local paths list open, ArrowDown moves the active option, Enter inserts it, and Tab completes one without submitting the form (SESS-008). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Listed = { groups: { sessions: unknown[] }[] };

test("ArrowDown, Enter and Tab complete local paths in the New Session message without starting it", { tags: ["SESS-008"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "sub", "notes.md"), "notes\n");
  const count = async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions).length;
  const before = await count();
  const message = screen.getByPlaceholder("What should this session work on?");
  const active = (name: RegExp) => screen.getByLabel("Local paths").getByRole("option", { name, selected: true });

  await hui.open("/");
  await screen.getByPlaceholder("~/").fill(repository.path);
  await expect(screen.getByLabel("Checkout: main")).toBeVisible();
  await message.fill("Review @sub/");
  await expect(active(/^sub\/keep\.txt/u)).toBeVisible();
  await message.press("ArrowDown");
  await expect(active(/^sub\/notes\.md/u)).toBeVisible();
  await message.press("Enter");
  await expect(message).toHaveValue("Review @sub/notes.md");
  await expect(screen.getByLabel("Local paths")).toBeHidden();

  await message.pressSequentially(" and @sub/k");
  await expect(active(/^sub\/keep\.txt/u)).toBeVisible();
  await message.press("Tab");
  await expect(message).toHaveValue("Review @sub/notes.md and @sub/keep.txt");
  await expect(message).toBeFocused();
  await expect(screen.getByRole("button", "Start session")).toBeEnabled();
  expect(await count()).toBe(before);
});
