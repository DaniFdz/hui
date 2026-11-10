/** An agent creates an ordinary top-level session in a group, not a child (BOT-073). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

type ListedSession = { id: string; title: string; group: string; cwd: string; parentId?: string; status: string };

test("an agent creates an ordinary session in a group, not a child", { tags: ["BOT-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const source = await hui.createSession({ title: "Session creator" });
  const repo = await hui.repository();
  const group = "Created by an agent";
  await hui.prompt(source, call("create_session", {
    prompt: "Report that an agent created you.",
    cwd: repo.path,
    title: "Created by an agent",
    group,
    worktree: true,
    branchName: "e2e/created-by-agent",
  }));

  const find = async () => (await hui.api<{ groups: Array<{ sessions: ListedSession[] }> }>("GET", "/__hui/sessions"))
    .groups.flatMap((entry) => entry.sessions).filter((session) => session.title === "Created by an agent");
  await expect.poll(find, { timeout: 30_000 }).toHaveLength(1);
  const [created] = await find();
  expect(created?.group).toBe(group);
  expect(created?.parentId).toBeUndefined();
  expect(created?.id).not.toBe(source.id);
  expect(created?.cwd).not.toBe(repo.path);
  await hui.open("/");
  await hui.sessionList();
  await expect(screen.getByLabel(/^Created by an agent, status/)).toBeVisible();
});
