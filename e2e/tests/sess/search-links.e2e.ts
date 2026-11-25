/** Search sessions also matches a session's linked pull requests and Jira work items: the `github` fixture world names the
 * pull request's repository, number and title, and the `jira` world the work item's key and summary, while sessions that
 * carry neither stay out of the results (SESS-074). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("Search sessions matches a linked pull request's repository, number and title and a linked Jira item's key and summary, and keeps the sessions that carry neither out of the results", { tags: ["SESS-074"], platforms: ["web"] }, async ({ screen, hui }) => {
  const search = screen.getByPlaceholder("Search sessions");
  const row = (title: string) => screen.getByLabel(new RegExp(`^${title}, status `, "u"));
  const only = async (query: string, found: string, missing: string) => {
    await search.fill(query);
    await expect(row(found)).toBeVisible();
    await expect(row(missing)).toBeHidden();
  };

  // A pull request the session created: its repository and number, and the title GitHub answers with.
  const github = await hui.world("github");
  await writeFile(join(github.runDir, "gh", "previews.json"), JSON.stringify({
    "acme/web#12": { __typename: "PullRequest", number: 12, title: "Ship the checkout redesign", state: "OPEN", isDraft: false,
      author: { login: "hui-e2e" }, additions: 4, deletions: 1, changedFiles: 1, comments: { totalCount: 0 },
      reviewThreads: { totalCount: 0 }, body: "The description." },
  }));
  const shipped = await github.createSession({ title: "Release the checkout" });
  await github.prompt(shipped, call("bash", { command: "gh pr create --fill; echo https://github.com/acme/web/pull/12" }));
  await github.prompt(shipped, call("bash", { command: "echo done" }));
  await github.createSession({ title: "Unrelated spreadsheet" });

  await hui.open(`${github.url}/sessions/${shipped.id}`);
  await hui.sessionList();
  await expect(screen.getByRole("link", "Pull request acme/web#12, open: Ship the checkout redesign")).toBeVisible();
  await only("acme/web#12", "Release the checkout", "Unrelated spreadsheet");
  await only("ship the checkout redesign", "Release the checkout", "Unrelated spreadsheet");

  // A linked Jira work item: its key and the summary the connected site answers with.
  const jira = await hui.world("jira");
  const keyed = await jira.createSession({ title: "Fix the pipeline" });
  await jira.api("POST", `/__hui/sessions/${keyed.id}/jira/link`, { key: "CI-1" });
  await jira.createSession({ title: "Unrelated notes" });

  await hui.open(`${jira.url}/sessions/${keyed.id}`);
  await hui.sessionList();
  await expect(screen.getByLabel(/^Fix the pipeline, status .*CI-1/u)).toBeVisible();
  await only("ci-1", "Fix the pipeline", "Unrelated notes");
  await only("pipeline reliability", "Fix the pipeline", "Unrelated notes");
});
