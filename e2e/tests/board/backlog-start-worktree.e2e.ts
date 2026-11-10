/** New worktree keeps the selected base branch, adds a Branch suffix the utility model fills, never replaces a name you typed with a late suggestion, and starts the session on that branch in a new checkout (BOARD-028). */
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

test("New worktree keeps the base branch, fills the suffix the utility model suggests, keeps a typed name when a late suggestion arrives, and starts the session on that branch in a new checkout", { tags: ["BOARD-028"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repo = await hui.repository();
  const settings = await hui.api<{ models: Record<string, unknown> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });
  await backlogTask(screen, hui, "Rate limit proxy");
  await backlogTask(screen, hui, "E2E_HOLD_BRANCH rate limit proxy");

  const openStart = async (title: string) => {
    await hui.open("/kanban");
    await screen.getByLabel("Kanban board").getByRole("button", `${title}, local task. Start a session`).tap();
    await screen.getByPlaceholder("~/").fill(repo.path);
    await expect(screen.getByRole("button", { name: /^Branch: /u })).toBeVisible();
    // The folder's suggestions are open after typing; a tap elsewhere closes them so the next tap reaches the dialog's controls.
    await screen.getByText("Work on", { exact: true }).tap();
  };
  const branch = screen.getByRole("button", { name: /^Branch: /u });
  const choice = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name} `, "u") });
  const suffix = screen.getByRole("textbox", { name: /^Branch suffix/u });
  const hint = (name: string) => screen.getByText(`Creates branch feature/${name} in a separate checkout.`);
  const start = screen.getByRole("button", "Start session", { visible: true });
  const pick = async (query: string, name: string) => {
    await branch.tap();
    await screen.getByRole("combobox", { name: "Search branches or enter a commit" }).fill(query);
    await screen.getByRole("option", { name }).tap();
  };

  await openStart("Rate limit proxy");
  await pick("release", "release/1.0");
  await expect(branch).toHaveAccessibleName("Branch: release/1.0");
  await choice("New worktree").tap();
  await expect(suffix).toBeVisible();
  await expect.poll(() => suffix.inputValue()).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/u);
  const suggested = await suffix.inputValue();
  await expect(hint(suggested)).toBeVisible();
  await expect(branch).toHaveAccessibleName("Branch: release/1.0");
  await choice("Branch").tap();
  await expect(suffix).toBeHidden();
  await expect(branch).toHaveAccessibleName("Branch: release/1.0");
  await choice("New worktree").tap();
  await expect(suffix).toHaveValue(suggested);
  await screen.getByRole("button", "Cancel").tap();
  await expect(screen.getByRole("dialog", { name: "Start session" })).toBeHidden();

  await openStart("E2E_HOLD_BRANCH rate limit proxy");
  await hui.provider.held();
  await pick("release", "release/1.0");
  await choice("New worktree").tap();
  await expect(suffix).toHaveAttribute("placeholder", "Suggesting a name…");
  const typed = "typed-name";
  await suffix.fill(typed);
  await expect(suffix).toHaveAttribute("placeholder", "short-description");
  await hui.provider.release();
  await expect.poll(() => suffix.getAttribute("placeholder")).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/u);
  await expect(suffix).toHaveValue(typed);
  await expect(hint(typed)).toBeVisible();
  await expect(branch).toHaveAccessibleName("Branch: release/1.0");

  await start.tap();
  await expect(screen.getByText("Started “E2E_HOLD_BRANCH rate limit proxy” from the backlog in Investigation.")).toBeVisible();
  await expect.poll(() => repo.git("worktree", "list", "--porcelain")).toContain("branch refs/heads/feature/typed-name");
  await expect.poll(() => repo.git("rev-parse", "feature/typed-name")).toBe(repo.git("rev-parse", "release/1.0"));
  const started = (await hui.api<{ groups: { sessions: { title: string; cwd: string; stage?: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap((group) => group.sessions).find((row) => row.title === "E2E_HOLD_BRANCH rate limit proxy");
  expect(started?.cwd).not.toBe(repo.path);
  expect(started?.cwd).toContain("typed-name");
  expect(started?.stage).toBe("investigation");
});
