/** Start session on a backlog item reports a failed start in the open dialog and leaves the item in the backlog, and Cancel closes it without changing anything (BOARD-029). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

const backlogTask = async (screen: Screen, hui: Hui, title: string) => {
  const source = await hui.createSession({ title: `${title} source` });
  await hui.prompt(source, call("suggest_task", { title, problem: `${title} needs a look.` }));
  await hui.open(`/sessions/${source.id}`);
  await screen.getByRole("button", "Add to backlog").tap();
  await expect(screen.getByText(`Added “${title}” to the Kanban backlog.`)).toBeVisible();
};

const sessionCount = async (hui: Hui) => (await hui.api<{ groups: { sessions: unknown[] }[] }>("GET", "/__hui/sessions"))
  .groups.flatMap((group) => group.sessions).length;

test("a failed start keeps the dialog open with the error and the item in the backlog, and Cancel then closes it without starting anything", { tags: ["BOARD-029"], platforms: ["web"] }, async ({ screen, hui }) => {
  await backlogTask(screen, hui, "Failed start task");
  await hui.open("/kanban");
  const before = await sessionCount(hui);
  const backlog = screen.getByLabel("Kanban board").getByRole("button", "Failed start task, local task. Start a session");
  await expect(backlog).toBeVisible();

  await backlog.tap();
  const subtitle = screen.getByText(/Failed start task” →/u);
  await expect(subtitle).toBeVisible();
  await expect(screen.getByText("Not a Git repository; the session works in this folder as it is.")).toBeVisible();
  const start = await hui.intercept("POST", /\/__hui\/backlog\/items\/[^/]+\/start$/u);
  await subtitle.tap();
  await screen.getByRole("button", "Start session", { visible: true }).tap();
  await start.arrived();
  await expect(screen.getByText("Starting the session…")).toBeVisible();
  await expect(backlog).toBeVisible();

  await start.reject(503, "The worktree could not be created.");
  await expect(screen.getByText("The worktree could not be created.")).toBeVisible();
  await expect(screen.getByRole("button", "Start session", { visible: true })).toBeEnabled();
  await expect(backlog).toBeVisible();

  await screen.getByRole("button", "Cancel", { visible: true }).tap();
  await expect(screen.getByRole("button", "Start session", { visible: true })).toBeHidden();
  await expect(backlog).toBeVisible();
  expect(await sessionCount(hui)).toBe(before);
});
