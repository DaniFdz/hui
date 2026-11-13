/** Start session on a repository preselects Branch with its default branch, and picking another branch or typing a commit switches the checkout before the session starts there (BOARD-027). */
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

test("a repository preselects Branch with its default branch and Start session enabled, and picking another branch or typing a commit switches the checkout before the session starts there", { tags: ["BOARD-027"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repo = await hui.repository();
  const main = repo.git("rev-parse", "main");
  await backlogTask(screen, hui, "Branch task");
  await backlogTask(screen, hui, "Commit task");

  const openStart = async (title: string) => {
    await hui.open("/kanban");
    await screen.getByLabel("Kanban board").getByRole("button", `${title}, local task. Start a session`).tap();
    await screen.getByPlaceholder("~/").fill(repo.path);
    await expect(screen.getByRole("button", { name: /^Branch: /u })).toBeVisible();
    // Blur on the dialog's subtitle above the folder; its completion covers the "Work on" legend below.
    await screen.getByText(new RegExp(`“${title}” →`, "u")).tap();
  };
  const branch = () => screen.getByRole("button", { name: /^Branch: /u });
  const start = () => screen.getByRole("button", "Start session", { visible: true });
  const pick = async (query: string, name: string) => {
    await branch().tap();
    await screen.getByRole("combobox", { name: "Search branches or enter a commit" }).fill(query);
    await screen.getByRole("option", { name }).tap();
  };

  await openStart("Branch task");
  await expect(screen.getByRole("radio", { name: /^Branch /u })).toBeChecked();
  await expect(branch()).toHaveAccessibleName("Branch: main");
  await expect(start()).toBeEnabled();

  await pick("release", "release/1.0");
  await expect(branch()).toHaveAccessibleName("Branch: release/1.0");
  await start().tap();
  await expect(screen.getByText("Started “Branch task” from the backlog in Investigation.")).toBeVisible();
  await expect.poll(() => repo.git("branch", "--show-current")).toBe("release/1.0");

  await openStart("Commit task");
  await expect(branch()).toHaveAccessibleName("Branch: main");
  await pick(main.slice(0, 7), main.slice(0, 7));
  await start().tap();
  await expect(screen.getByText("Started “Commit task” from the backlog in Investigation.")).toBeVisible();
  await expect.poll(() => repo.git("rev-parse", "HEAD")).toBe(main);
});
