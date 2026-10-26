/** Remove from HUI deletes only the tree's registry rows: the PI transcripts and the session's Git worktree stay on disk (SESS-065). */
import { stat } from "node:fs/promises";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Session = { id: string; title: string; cwd: string; creating?: unknown };
type Listed = { groups: { sessions: Session[] }[] };

test("Remove from HUI deletes only the tree's registry rows, leaving the PI transcripts and the Git worktree on disk", { tags: ["SESS-065"], platforms: ["web"] }, async ({ screen, hui }) => {
  const listed = async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  const remove = async (title: string) => {
    await hui.sessionMenu(title);
    await screen.getByText("Delete…", { visible: true }).tap();
    await expect(screen.getByText(`Remove ${title} from HUI?`)).toBeVisible();
    await expect(screen.getByText(/Their PI transcripts remain on disk and are not deleted/u)).toBeVisible();
    await screen.getByRole("button", "Remove from HUI").tap();
  };
  const repo = await hui.repository();
  const parent = await hui.createSession({ title: "Zulu removal" });
  await hui.createSubagent(parent);
  await hui.prompt(parent, "keep this transcript");
  const worktree = (await hui.api<{ session: Session }>("POST", "/__hui/sessions", { cwd: repo.path, title: "Bravo worktree", worktree: true })).session;
  await expect.poll(async () => (await listed()).find(({ id }) => id === worktree.id)?.creating, { timeout: 120_000 }).toBeUndefined();
  const planted = (await listed()).find(({ id }) => id === worktree.id)!;
  const transcripts = await hui.stored("keep this transcript");
  expect(transcripts.length).toBeGreaterThan(0);

  await hui.open(`/sessions/${parent.id}`);
  await remove("Zulu removal");
  await expect.poll(async () => (await listed()).map(({ id }) => id)).toEqual([worktree.id]);
  await expect.poll(() => hui.stored("keep this transcript")).toEqual(transcripts);

  await hui.open(`/sessions/${planted.id}`);
  await remove(planted.title);
  await expect.poll(listed).toEqual([]);
  await expect.poll(async () => (await stat(planted.cwd).catch(() => undefined))?.isDirectory()).toBe(true);
});