/** The Diff view follows the checkout: the changed-file list gains what the agent wrote at the turn's end, and a
 * hidden Diff view re-reads when it is shown again or on Refresh (WORK-070). */
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

/** Tool calls the fixture provider asks HUI to run in one answer, the way the model would. */
const calls = (list: { name: string; input: Record<string, unknown> }[]) => `E2E_CALL:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;

test("the changed-file list gains what changed at the turn's end, when a hidden Diff view is shown again and on Refresh", { tags: ["WORK-070"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "alpha.txt"), "alpha\n");
  const session = await hui.createSession({ title: "Diff follows the checkout", cwd: repository.path });
  const changed = screen.getByRole("tabpanel", "Diff").getByLabel("Changed files");
  const row = (name: string) => changed.getByRole("button").filter({ hasText: name });

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Diff");
  await expect(row("alpha.txt")).toBeVisible();

  // Nothing is re-read by itself: the new file waits for the view to be asked.
  await writeFile(join(repository.path, "beta.txt"), "beta\n");
  await expect(row("beta.txt")).toHaveCount(0);
  await screen.getByRole("tabpanel", "Diff").getByRole("button", "Refresh").tap();
  await expect(row("beta.txt")).toBeVisible();

  // The agent's turn ends on a rewritten file and a new one, and the list follows.
  await appendFile(join(repository.path, "alpha.txt"), "changed by the agent\n");
  await hui.prompt(session, calls([{ name: "write", input: { path: join(repository.path, "gamma.txt"), content: "gamma\n" } }]));
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(row("gamma.txt")).toBeVisible();

  // A hidden Diff view re-reads when its rail button shows it again.
  await screen.getByRole("button", "Hide Work pane").tap();
  await writeFile(join(repository.path, "delta.txt"), "delta\n");
  await expect(row("delta.txt")).toHaveCount(0);
  await screen.getByRole("button", "Show Diff").tap();
  await expect(row("delta.txt")).toBeVisible();
});
