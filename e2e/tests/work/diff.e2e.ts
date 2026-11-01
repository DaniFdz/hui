/** The Diff view: filtering the changed files, and the layout switch with a rename (WORK-068, WORK-066). */
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("typing in Filter changed files narrows the list to the matching paths", { tags: ["WORK-068"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await appendFile(join(repository.path, "alpha.txt"), "alpha\n");
  await appendFile(join(repository.path, "beta.txt"), "beta\n");
  const session = await hui.createSession({ title: "Filter the changed files", cwd: repository.path });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Diff");
  const changed = screen.getByLabel("Changed files");
  const filter = screen.getByLabel("Filter changed files");
  const row = (name: string) => changed.getByRole("button").filter({ hasText: name });

  await expect(row("alpha.txt")).toBeVisible();
  await expect(row("beta.txt")).toBeVisible();

  await filter.fill("alpha");
  await expect(row("alpha.txt")).toBeVisible();
  await expect(row("beta.txt")).toHaveCount(0);

  await filter.fill("gamma");
  await expect(changed.getByText(/No changed file matches/u)).toBeVisible();

  await filter.fill("");
  await expect(row("alpha.txt")).toBeVisible();
  await expect(row("beta.txt")).toBeVisible();
});

test("Unified and Side by side switch the layout, a narrow pane disables Side by side, and a rename reads old to new", { tags: ["WORK-066"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const lines = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  await writeFile(join(repository.path, "sub", "notes.txt"), `${lines.join("\n")}\n`);
  repository.git("add", "-A");
  repository.git("commit", "-m", "notes");
  repository.git("mv", "sub/notes.txt", "sub/renamed.txt");
  await writeFile(join(repository.path, "sub", "renamed.txt"), `${lines.map((line) => line === "five" ? "changed" : line).join("\n")}\n`);
  const session = await hui.createSession({ title: "Read a diff", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Diff");
  await screen.getByRole("button", "Maximize Work pane").tap();

  const unified = screen.getByRole("button", "Unified");
  const sideBySide = screen.getByRole("button", "Side by side");
  await expect(unified).toHaveAttribute("aria-pressed", "true");
  await expect(sideBySide).toHaveAttribute("aria-pressed", "false");
  await sideBySide.tap();
  await expect(sideBySide).toHaveAttribute("aria-pressed", "true");
  await expect(unified).toHaveAttribute("aria-pressed", "false");
  await unified.tap();
  await expect(unified).toHaveAttribute("aria-pressed", "true");

  const changed = screen.getByLabel("Changed files");
  await changed.getByRole("button").filter({ hasText: "renamed.txt" }).tap();
  const main = screen.getByLabel(/^Changes in /u);
  await expect(main.getByLabel("renamed to")).toBeVisible();
  const diff = await hui.textOf(main);
  expect(diff).toContain("−five");
  expect(diff).toContain("+changed");

  await screen.getByRole("button", "Restore Work pane").tap();
  const resizer = screen.getByLabel("Resize Work pane");
  await resizer.tap();
  await expect(resizer).toBeFocused();
  for (let press = 0; press < 3; press += 1) {
    await hui.keyboard.down("Shift");
    await hui.keyboard.down("ArrowLeft");
    await hui.keyboard.up("ArrowLeft");
    await hui.keyboard.up("Shift");
  }
  await expect.poll(async () => Number(await resizer.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(640);
  await expect(pane.getByRole("button", "Side by side")).toBeDisabled();
  await expect(screen.getByText("Side by side needs a wider pane")).toBeVisible();
  await expect(pane.getByRole("button", "Unified")).toHaveAttribute("aria-pressed", "true");
});