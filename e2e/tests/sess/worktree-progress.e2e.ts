/** A worktree session opens at once, shows its naming and Git's checkout percentage while another session starts, sends its prompt once ready, and on a Git failure stays listed in error until deleting it returns its prompt (SESS-012). */
import { dirname, join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Listed = { groups: { sessions: { title: string; cwd: string }[] }[] };

test("a worktree session follows Git's progress while another session starts, then sends its prompt", { tags: ["SESS-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository({ holdCheckout: true });
  const message = screen.getByPlaceholder("What should this session work on?");
  const transcript = screen.getByTestId("transcript");
  const row = screen.getByTestId("session-row").filter({ hasText: "Improve session naming" });

  const settings = await hui.api<{ models: Record<string, unknown> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });

  await hui.open("/");
  await screen.getByLabel("Project directory").fill(repository.path);
  await message.fill("Work in a worktree E2E_HOLD_NAMING");
  await screen.getByLabel("Checkout: main").tap();
  await screen.getByText("New worktree", { exact: true }).tap();
  await screen.getByText("Pick where this session works, then say what to do.").tap();
  await expect(screen.getByLabel("Checkout: New worktree from main")).toBeVisible();
  await screen.getByRole("button", "Start session").tap();

  await hui.provider.held();
  await expect(transcript).toContainText("Naming worktree");
  await expect(screen.getByLabel(/^Work in a worktree E2E_HOLD_NAMING, Naming worktree, tool durable/u)).toHaveCount(1);
  await hui.provider.release();
  await hui.api("PUT", "/__hui/settings", settings);

  await expect(transcript).toContainText(/Checking out files\s*\d+%/u);
  const percent = /Checking out files\s*(\d+)%/u.exec((await transcript.textContent()) ?? "")![1]!;
  expect(percent).toMatch(/^[1-9]\d?$/u);
  await expect(screen.getByLabel("Git worktree creation progress")).toHaveAttribute("aria-valuenow", percent);
  await expect(screen.getByLabel(/^Improve session naming, Checking out files, tool durable/u)).toHaveCount(1);
  await expect(row).toContainText(`${percent}%`);
  await expect(transcript.getByText("Fixture response.", { visible: true })).toBeHidden();

  await hui.peek(screen.getByText("OTHER", { exact: true, visible: true }));
  await screen.getByRole("button", "New session in OTHER").tap();
  await screen.getByPlaceholder("~/").fill(hui.workspace);
  await message.fill("Meanwhile in the workspace");
  await screen.getByRole("button", "Start session").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(row).toContainText(`${percent}%`);

  await repository.releaseCheckout("succeed");
  await row.tap();
  await expect(transcript.getByText("Work in a worktree E2E_HOLD_NAMING")).toBeVisible();
  await expect(transcript.getByText("Fixture response.", { visible: true })).toBeVisible();
  await expect(screen.getByLabel(/^Improve session naming, status idle, tool durable/u)).toHaveCount(1);
  const worktree = (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap(({ sessions }) => sessions).find(({ title }) => title === "Improve session naming")?.cwd;
  expect(worktree!.startsWith(join(dirname(hui.workspace), "config", "hui", "worktrees") + "/")).toBe(true);
  expect(repository.git("-C", worktree!, "branch", "--show-current")).toBe("feature/improve-session-naming");
});

test("a worktree Git can't create stays listed in error, and deleting it returns its prompt to New Session", { tags: ["SESS-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository({ holdCheckout: true });
  const message = screen.getByPlaceholder("What should this session work on?");
  const transcript = screen.getByTestId("transcript");

  await hui.open("/");
  await screen.getByLabel("Project directory").fill(repository.path);
  await message.fill("Fail in a worktree");
  await screen.getByLabel("Checkout: main").tap();
  await screen.getByText("New worktree", { exact: true }).tap();
  await screen.getByText("Pick where this session works, then say what to do.").tap();
  await screen.getByRole("button", "Start session").tap();
  await expect(transcript).toContainText(/Checking out files\s*\d+%/u);

  await repository.releaseCheckout("fail");
  await expect(transcript.getByText("Could not create the Git worktree")).toBeVisible();
  await expect(screen.getByText(/^Could not create Git workspace: error: external filter '.*hold-checkout' failed/u)).toBeVisible();
  await expect(screen.getByLabel(/^Fail in a worktree, status error, tool durable/u)).toHaveCount(1);

  await hui.sessionMenu("Fail in a worktree");
  await screen.getByText("Delete…", { visible: true }).tap();
  await screen.getByRole("button", "Remove from HUI").tap();
  await expect(message).toHaveValue("Fail in a worktree");
  await expect(screen.getByTestId("session-row").filter({ hasText: "Fail in a worktree" })).toHaveCount(0);
});
