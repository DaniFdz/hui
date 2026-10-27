/** Filter cards… narrows the board to the cards whose title, path, group, pull request or Jira key matches, keeps every card of a lane whose name matches, and says so when nothing is left (BOARD-015). */
import { basename } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

type Row = { id: string; pullRequests?: unknown[]; jiraIssues?: unknown[] };

test("Filter cards… keeps cards matching a title, path, group, pull request or Jira key, keeps a lane whose name matches, and says No matching cards when nothing is left", { tags: ["BOARD-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repo = await hui.repository();
  await hui.createSession({ title: "Alpha card" });
  await hui.createSession({ title: "Grouped card", group: "Beta squad" });
  await hui.createSession({ title: "Repo card", cwd: repo.path });
  const pulled = await hui.createSession({ title: "Pulled request card" });
  await hui.prompt(pulled, call("bash", { command: "gh pr create --fill; echo https://github.com/acme/widgets/pull/42" }));
  const keyed = await hui.createSession({ title: "Keyed card" });
  await hui.prompt(keyed, call("bash", { command: "jira issue create -s'Keyed card' || echo https://acme.atlassian.net/browse/CI-123" }));

  const row = async (id: string) => (await hui.api<{ groups: { sessions: Row[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap((group) => group.sessions).find((session) => session.id === id);
  await expect.poll(async () => (await row(pulled.id))?.pullRequests?.length).toBe(1);
  await expect.poll(async () => (await row(keyed.id))?.jiraIssues?.length).toBe(1);

  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  const card = (title: string) => board.getByRole("listitem").filter({ hasText: title });
  const filter = screen.getByPlaceholder("Filter cards…");
  const only = async (query: string, visible: string, hidden: string[]) => {
    await filter.fill(query);
    await expect(card(visible)).toBeVisible();
    for (const title of hidden) await expect(board.getByText(title)).toBeHidden();
  };

  await expect(card("Pulled request card").getByText("1 PR")).toBeVisible();
  await only("alpha", "Alpha card", ["Grouped card", "Repo card", "Pulled request card", "Keyed card"]);
  await only("beta squad", "Grouped card", ["Alpha card", "Repo card"]);
  await only(basename(repo.path), "Repo card", ["Alpha card", "Grouped card", "Pulled request card"]);
  await only("acme/widgets#42", "Pulled request card", ["Alpha card", "Keyed card"]);
  await only("ci-123", "Keyed card", ["Alpha card", "Pulled request card"]);

  await filter.fill(basename(hui.workspace));
  for (const title of ["Alpha card", "Grouped card", "Pulled request card", "Keyed card"]) await expect(card(title)).toBeVisible();
  await expect(board.getByText("Repo card")).toBeHidden();

  await filter.fill("nothing of this name");
  await expect(screen.getByText("No matching cards. Try another search or view.")).toBeVisible();
  await filter.fill("");
  await expect(card("Alpha card")).toBeVisible();
});
