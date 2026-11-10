/** Create Jira work item… from a session menu drafts a work item with the utility model, keeps what the operator edited when the project changes, and creates it on the session; without a Jira connection it says what to do first (BOARD-035). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Create Jira work item… drafts a work item from the session and creates it, keeping the edited fields across a project change, and without a Jira connection it points at Integrations instead", { tags: ["BOARD-035"], platforms: ["web"] }, async ({ screen, hui }) => {
  // Without a Jira connection the dialog cannot create anything and says what to connect.
  await hui.createSession({ title: "No Jira yet" });
  await hui.open("/kanban");
  await hui.sessionList();
  await (await hui.sessionMenu("No Jira yet")).getByText("Create Jira work item…", { visible: true }).tap();
  const unconnected = screen.getByRole("dialog", { name: "Create Jira work item" });
  await expect(unconnected.getByText("Connect Jira with an API token before creating work items.")).toBeVisible();
  await expect(unconnected.getByRole("button", "Open Integrations")).toBeVisible();
  await unconnected.getByRole("button", "Cancel").tap();
  await expect(unconnected).toBeHidden();

  // A connected world drafts it: the default project, a suggested parent and the model's words.
  const world = await hui.world("jira");
  await hui.open(`${world.url}/`);
  await hui.sessionList();
  await (await hui.sessionMenu("Flaky CI retries")).getByText("Create Jira work item…", { visible: true }).tap();
  const dialog = screen.getByRole("dialog", { name: "Create Jira work item" });
  await expect(dialog.getByText("Linked to “Flaky CI retries”.")).toBeVisible();
  const project = dialog.getByRole("button", { name: /^Project: /u });
  const parent = dialog.getByRole("button", { name: /^Parent/u });
  const summary = dialog.getByRole("textbox", { name: "Summary" });
  await expect(project).toHaveAccessibleName("Project: CI Platform (CI)");
  await expect(parent).toHaveAccessibleName("Parent: CI-1 · Pipeline reliability");
  await expect(dialog.getByText("suggested", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Drafted by .+\. Review before creating\.$/u)).toBeVisible();
  await expect(summary).toHaveValue(/^Surface flaky CI failures/u);
  await expect(dialog.getByRole("textbox", { name: /^Description/u })).toHaveValue(/## Acceptance criteria/u);
  await expect(dialog.getByRole("checkbox", { name: /^Assign to me/u })).toBeChecked();

  // A project change asks for that project's parents and keeps the operator's own words.
  await summary.fill("Surface flaky CI failures first");
  await project.tap();
  await dialog.getByRole("combobox", { name: "Search projects by name or key" }).fill("OPS");
  await dialog.getByRole("option", { name: "Operations (OPS)" }).tap();
  await expect(project).toHaveAccessibleName("Project: Operations (OPS)");
  await expect(parent).toHaveAccessibleName("Parent: No parent");
  await expect(dialog.getByText("No open parent matches this work.")).toBeVisible();
  await expect(summary).toHaveValue("Surface flaky CI failures first");

  await project.tap();
  await dialog.getByRole("combobox", { name: "Search projects by name or key" }).fill("CI Platform");
  await dialog.getByRole("option", { name: "CI Platform (CI)" }).tap();
  await expect(parent).toHaveAccessibleName("Parent: CI-1 · Pipeline reliability");
  await expect(summary).toHaveValue("Surface flaky CI failures first");

  await dialog.getByRole("button", "Create", { exact: true }).tap();
  await expect(dialog).toBeHidden();
  await expect(screen.getByText("Created Jira work item CI-41.")).toBeVisible();
  // The session now carries the work item it created.
  await expect(screen.getByRole("link", { name: /Jira CI-41, to do: Surface flaky CI failures first$/u })).toBeVisible();
});
