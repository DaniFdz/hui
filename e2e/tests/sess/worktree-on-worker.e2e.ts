/** New Session makes its worktree on the machine the session runs on, worker included (SESS-064). */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a worktree session on a worker is made there, from that machine's branches", { tags: ["SESS-064"], platforms: ["web"] }, async ({ screen, hui }) => {
  const worker = await hui.addWorker("remote-box");
  const repo = join(worker.home, "project");
  await mkdir(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.email=e2e@example.test", "-c", "user.name=E2E", ...args]);
  git("init", "-b", "main");
  await writeFile(join(repo, "notes.txt"), "Remote repository\n");
  git("add", ".");
  git("commit", "-m", "Fixture commit");

  await hui.open("/");
  // The machine first: the folder, its branches and the worktree all come from it.
  await screen.getByLabel("Choose where the session runs").tap();
  await screen.getByText("remote-box").tap();
  await screen.getByLabel("Project directory").fill(repo);
  const checkout = screen.getByRole("button", /^Checkout: /u);
  await expect(checkout).toHaveText("main");
  await checkout.tap();
  await screen.getByText("New worktree", { exact: true }).tap();
  await expect(checkout).toHaveText("New worktree from main");

  // Its popover stays open for a second choice; Escape leaves it so Start is reachable.
  await screen.getByPlaceholder("What should this session work on?").fill("Work in a worktree on the worker");
  await screen.getByPlaceholder("What should this session work on?").press("Escape");
  await screen.getByRole("button", "Start session").tap();
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible({ timeout: 180_000 });

  const sessions = (await hui.api<{ groups: { sessions: { cwd: string; worker?: { name: string } }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap((group) => group.sessions);
  const session = sessions.find((each) => each.cwd !== repo);
  expect(session?.worker?.name).toBe("remote-box");
  expect(session?.cwd.startsWith(worker.home)).toBe(true);
});
