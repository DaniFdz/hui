/** The Diff view lists an uncommitted file in the session's checkout (WORK-063). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("the Diff view lists an uncommitted file", { tags: ["WORK-063"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "change.txt"), "changed\n");
  const session = await hui.createSession({ title: "Diff review", cwd: repository.path });

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Diff");
  await expect(screen.getByText("change.txt", { exact: true })).toBeVisible();
});
