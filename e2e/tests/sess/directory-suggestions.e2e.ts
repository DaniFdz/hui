/** New Session's Project directory completes folders under the typed prefix from the machine the session runs on, fills the field with the choice and inspects its Git checkout (SESS-003). */
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("typing a folder prefix offers the matching folders, choosing one fills the field and inspects its checkout, and a chosen worker suggests its own folders instead of this machine's", { tags: ["SESS-003"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const worker = await hui.addWorker("suggest-box");
  const workerFolder = "worker-only-folder";
  await mkdir(join(worker.home, workerFolder), { recursive: true });

  const directory = screen.getByRole("combobox", "Project directory");
  const suggestions = screen.getByRole("listbox", "Project directory");

  await hui.open("/");
  await expect(screen.getByRole("button", "Start session")).toBeVisible();

  // A prefix of one folder: the list holds that folder and nothing else, under the field it completes.
  await directory.fill(join(dirname(repository.path), basename(repository.path).slice(0, -3)));
  await expect(suggestions.getByRole("option")).toHaveText([`${repository.path}/`]);
  await expect(directory).toHaveAttribute("aria-expanded", "true");

  await suggestions.getByRole("option", { name: `${repository.path}/` }).tap();
  await expect(directory).toHaveValue(`${repository.path}/`);
  await expect(directory).toHaveAttribute("aria-expanded", "false");
  // The choice is inspected: the Checkout trigger reads the branch this checkout is on.
  await expect(screen.getByLabel("Checkout: feature/current")).toBeVisible();

  // This machine has no folder by that name, so the same prefix offers nothing until the session runs on the worker.
  await directory.fill(`~/${workerFolder}`);
  await expect(suggestions).toHaveCount(0);

  await screen.getByLabel("Choose where the session runs").tap();
  await screen.getByRole("menuitemradio", { name: /suggest-box/u }).tap();
  await expect(screen.getByLabel("Choose where the session runs")).toContainText("suggest-box");

  await directory.fill(`~/${workerFolder}`);
  await expect(suggestions.getByRole("option")).toHaveText([`~/${workerFolder}/`]);
  await suggestions.getByRole("option", { name: `~/${workerFolder}/` }).tap();
  await expect(directory).toHaveValue(`~/${workerFolder}/`);
  await expect(directory).toHaveAttribute("aria-expanded", "false");
});
