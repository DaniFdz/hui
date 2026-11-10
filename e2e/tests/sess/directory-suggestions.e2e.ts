/** Typing in Project directory lists the folders under the typed prefix, choosing one fills the field and inspects its Git checkout, and a session that will run on a worker suggests that worker's folders instead of this machine's (SESS-003). */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("typing in Project directory suggests the folders under the prefix, choosing one fills the field and inspects its checkout, and a chosen worker suggests its own folders", { tags: ["SESS-003"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const folder = join(repository.path, "suggested folder");
  await mkdir(folder);
  const directory = screen.getByLabel("Project directory");
  const options = screen.getByRole("listbox", "Project directory").getByRole("option");

  await hui.open("/");
  await directory.fill(`${repository.path}/sugg`);
  await expect(options).toHaveCount(1);
  await expect(options.first()).toHaveText(`${folder}/`);
  await options.first().tap();
  await expect(directory).toHaveValue(`${folder}/`);
  // Choosing the folder inspects its Git checkout, naming the branch it is on.
  await expect(screen.getByLabel(/^Checkout: /u)).toBeVisible();
  await expect(screen.getByLabel("Checkout: feature/current")).toBeVisible();

  // A worker keeps its own home, so its folder list is the worker's, not this machine's.
  const worker = await hui.addWorker("Suggestions box");
  const onlyThere = join(worker.home, "worker-only-folder");
  await mkdir(onlyThere);
  await hui.reload();
  // This machine has no such folder: only the worker that owns it can suggest it.
  await directory.fill("~/worker-only");
  await expect(options).toHaveCount(0);
  await screen.getByLabel("Choose where the session runs").tap();
  await screen.getByRole("menu", "Run on").getByRole("menuitemradio", { name: /^Suggestions box/u }).tap();
  await expect(screen.getByLabel("Choose where the session runs")).toContainText("Suggestions box");
  await directory.fill("~/worker-only");
  await expect(options).toHaveCount(1);
  // Its home reads as ~, and that is the worker's home, not this machine's.
  await expect(options.first()).toHaveText("~/worker-only-folder/");
  await options.first().tap();
  await expect(directory).toHaveValue("~/worker-only-folder/");
});
