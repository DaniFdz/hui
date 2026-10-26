/** Deleting several sessions at once: the row checkboxes, Select all shown sessions and Select archived (N) check sessions, Delete… confirms them with their subagents while their transcripts stay, "Also remove their worktrees" removes the clean HUI-created worktrees and names the ones it kept, and the toast reports the counts and any failure (SESS-061). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Session = { id: string; title: string; cwd: string; creating?: unknown };
type Listed = { groups: { sessions: Session[] }[] };

test("the row checkboxes, Select all shown sessions and Select archived (N) check sessions, and Delete… deletes them with their subagents while their transcripts stay", { tags: ["SESS-061"], platforms: ["web"] }, async ({ screen, hui }) => {
  const parent = await hui.createSession({ title: "Zulu tree" });
  await hui.createSubagent(parent);
  await hui.prompt(parent, "keep this transcript");
  const archived = await hui.createSession({ title: "Delta archived" });
  await hui.api("PATCH", `/__hui/sessions/${archived.id}`, { archived: true });
  await hui.createSession({ title: "Echo kept" });
  const transcripts = await hui.stored("keep this transcript");
  expect(transcripts.length).toBeGreaterThan(0);

  await hui.open("/sessions");
  await screen.getByRole("button", "Select archived (1)").tap();
  await expect(screen.getByText("1 selected")).toBeVisible();
  await expect(screen.getByLabel("Select Delta archived")).toBeChecked();
  await screen.getByRole("button", "Clear selection").tap();
  await expect(screen.getByText("1 selected")).toBeHidden();
  await screen.getByRole("button", "All").tap();
  await screen.getByLabel("Select Zulu tree").tap();
  await expect(screen.getByText("1 selected")).toBeVisible();
  await screen.getByRole("button", "Clear selection").tap();
  await screen.getByLabel("Select all shown sessions").tap();
  await expect(screen.getByText("4 selected")).toBeVisible();

  await screen.getByRole("button", "Delete…").tap();
  await expect(screen.getByText("Delete 4 sessions from HUI?")).toBeVisible();
  await expect(screen.getByText(/Their PI transcripts remain on disk and are not deleted/u)).toBeVisible();
  await screen.getByRole("button", "Cancel").tap();
  await expect(screen.getByText("Delete 4 sessions from HUI?")).toBeHidden();

  await screen.getByRole("button", "Delete…").tap();
  await screen.getByRole("button", "Delete 4 sessions").tap();
  await expect(screen.getByText("Deleted 4 sessions.")).toBeVisible();
  await expect(screen.getByText("No sessions yet", { visible: true }).last()).toBeVisible();
  await expect.poll(() => hui.stored("keep this transcript")).toEqual(transcripts);
});

test("a failed delete is named in the toast and leaves the session in place", { tags: ["SESS-061"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Foxtrot refused" });
  await hui.open("/sessions");
  await screen.getByLabel("Select Foxtrot refused").tap();
  const refused = await hui.intercept("DELETE", new RegExp(`/__hui/sessions/${session.id}$`, "u"));
  await screen.getByRole("button", "Delete…").tap();
  await screen.getByRole("button", "Delete 1 session").tap();
  await refused.arrived();
  await refused.reject(500, "The registry refused the delete.");
  await expect(screen.getByText("Deleted 0 sessions. Failed: The registry refused the delete.")).toBeVisible();
  await expect(screen.getByTestId("session-data-row").filter({ hasText: "Foxtrot refused" })).toBeVisible();
});

test("Also remove their worktrees removes the clean HUI-created worktrees and names the one it kept", { tags: ["SESS-061"], platforms: ["web"] }, async ({ screen, hui }) => {
  const listed = async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  const repo = await hui.repository();
  const created = await Promise.all(["Bravo worktree", "Charlie worktree"].map(async (title) =>
    (await hui.api<{ session: Session }>("POST", "/__hui/sessions", { cwd: repo.path, title, worktree: true })).session));
  await expect.poll(async () => (await listed()).filter((session) => created.some(({ id }) => id === session.id) && !session.creating).length, { timeout: 120_000 }).toBe(2);
  const dirty = (await listed()).find(({ id }) => id === created[1]!.id)!;
  await writeFile(join(dirty.cwd, "local-change.txt"), "local change\n");
  const branch = repo.git("worktree", "list", "--porcelain").split("\n\n")
    .find((block) => block.includes(dirty.cwd))!.split("\n").find((line) => line.startsWith("branch "))!.replace("branch refs/heads/", "");

  await hui.open("/sessions");
  await screen.getByLabel("Select all shown sessions").tap();
  await expect(screen.getByText("2 selected")).toBeVisible();
  await screen.getByRole("button", "Delete…").tap();
  await screen.getByLabel(/Also remove their worktrees/u).tap();
  await screen.getByRole("button", "Delete 2 sessions").tap();
  await expect(screen.getByText("Deleted 2 sessions. Removing 2 worktrees…")).toBeVisible();
  await expect(screen.getByText(`Deleted 2 sessions. Removed 1 worktree. Kept ${branch} (local changes or not created by HUI); review it in Settings → Worktrees.`)).toBeVisible();
});