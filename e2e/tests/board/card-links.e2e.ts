/** A session card opens its session from anywhere but its chips, and its pull request and Jira chips open the work item in a new tab while the board stays (BOARD-003). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("clicking a card outside its links and menu opens that session, and the pull request and Jira chips open their work item in a new tab leaving the board in place", { tags: ["BOARD-003"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Linked card" });
  const other = await hui.createSession({ title: "Bystander card" });
  await hui.prompt(session, call("bash", { command: "gh pr create --fill; echo https://github.com/acme/widgets/pull/42" }));
  await hui.prompt(other, call("bash", { command: "jira issue create -s'Jira card' || echo https://acme.atlassian.net/browse/CI-123" }));
  type Row = { id: string; pullRequests?: unknown[]; jiraIssues?: unknown[] };
  const row = async (id: string) => (await hui.api<{ groups: { sessions: Row[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap((group) => group.sessions).find((candidate) => candidate.id === id);
  await expect.poll(async () => (await row(session.id))?.pullRequests?.length).toBe(1);
  await expect.poll(async () => (await row(other.id))?.jiraIssues?.length).toBe(1);

  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  const card = (title: string) => board.getByRole("listitem").filter({ hasText: title });
  const pullRequest = card("Linked card").getByRole("link", "Pull request acme/widgets#42, status unavailable");
  const jira = card("Bystander card").getByRole("link", "Jira CI-123, status unavailable");
  await expect(pullRequest).toHaveAttribute("href", "https://github.com/acme/widgets/pull/42");
  await expect(pullRequest).toHaveAttribute("target", "_blank");
  await expect(jira).toHaveAttribute("href", "https://acme.atlassian.net/browse/CI-123");
  await expect(jira).toHaveAttribute("target", "_blank");

  await card("Linked card").getByText("Done", { exact: true }).last().tap();
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${session.id}$`, "u"));

  await hui.open("/kanban");
  await expect(board.getByText("Bystander card")).toBeVisible();
  await jira.tap();
  await expect(board.getByText("Bystander card")).toBeVisible();
  await expect(board.getByText("Linked card")).toBeVisible();
  expect(new URL(await hui.url()).pathname).toBe("/kanban");

  await card("Bystander card").getByText("Done", { exact: true }).last().tap();
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${other.id}$`, "u"));
});
