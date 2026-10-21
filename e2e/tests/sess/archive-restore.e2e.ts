/** Archive session hides a session and its subagents without stopping their work, the toast's Restore and the Sessions page bring the tree back, and a message to an archived session restores it too (SESS-034, SESS-035, SESS-036). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const row = (title: string) => new RegExp(`^${title}, status `, "u");

test("Archive session hides the whole tree, returns an open view Home and keeps its run going", { tags: ["SESS-034", "SESS-035"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const toast = screen.getByText("Archived “Plan website”.");
  const parent = await hui.createSession({ title: "Plan website" });
  const child = await hui.createSubagent(parent);
  await hui.createSession({ title: "Independent conversation" });

  await hui.open(`/sessions/${child.id}`);
  await expect(screen.getByLabel(row(child.title))).toBeVisible();
  await hui.prompt(parent, "E2E_REPLAY");
  await hui.provider.held();
  await hui.sessionMenu("Plan website");
  await screen.getByText("Archive session", { visible: true }).tap();
  await expect(toast).toBeVisible();
  await expect(screen.getByRole("button", "Restore")).toBeEnabled();
  await expect(screen.getByRole("button", "Dismiss archive notification")).toBeVisible();
  await expect.poll(() => hui.url()).toMatch(/\/$/u);
  await expect(screen.getByLabel(row("Independent conversation"))).toBeVisible();
  await expect(screen.getByLabel(row("Plan website"))).toBeHidden();
  await expect(screen.getByLabel(row(child.title))).toBeHidden();
  await hui.provider.release();

  await screen.getByRole("button", "Restore").tap();
  await expect(screen.getByText("Session restored.")).toBeVisible();
  await expect(toast).toBeHidden();
  await expect(screen.getByLabel(row("Plan website"))).toBeVisible();
  await hui.open(`/sessions/${parent.id}`);
  await screen.getByRole("button", "Expand subagents of Plan website").tap();
  await expect(screen.getByLabel(row(child.title))).toBeVisible();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
});

test("archiving a session closes its split pane and leaves the open conversation alone", { tags: ["SESS-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Split parent" });
  const other = await hui.createSession({ title: "Main conversation" });
  await hui.open(`/sessions/${other.id}`);
  await hui.sessionMenu("Split parent");
  await screen.getByText("Open in split pane", { visible: true }).tap();
  await expect(screen.getByLabel(/^Split parent, status idle, .*, open in split pane$/u)).toBeVisible();
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveCount(2);
  await screen.getByTestId("session-title", { visible: true }).filter({ hasText: "Main conversation" }).tap();
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${other.id}$`, "u"));
  await hui.sessionMenu("Split parent");
  await screen.getByText("Archive session", { visible: true }).tap();
  await expect(screen.getByText("Archived “Split parent”.")).toBeVisible();
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Main conversation");
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${other.id}$`, "u"));
  await expect(screen.getByLabel(row("Split parent"))).toBeHidden();
});

test("the archive toast expires untouched, and a failed restore keeps its error and an enabled Restore", { tags: ["SESS-035"], platforms: ["web"] }, async ({ screen, hui }) => {
  const restore = screen.getByRole("button", "Restore");
  const session = await hui.createSession({ title: "Fragile restore" });
  await hui.open("/");
  await hui.sessionMenu("Fragile restore");
  await screen.getByText("Archive session", { visible: true }).tap();
  await hui.failNextRequest("PATCH", `/__hui/sessions/${session.id}`, "The registry is read-only right now.");
  await restore.tap();
  await expect(screen.getByText("The registry is read-only right now.")).toBeVisible();
  await expect(restore).toBeEnabled();
  await expect(screen.getByLabel(row("Fragile restore"))).toBeHidden();
  await restore.tap();
  await expect(screen.getByText("Session restored.")).toBeVisible();
  await expect(screen.getByLabel(row("Fragile restore"))).toBeVisible();

  await hui.sessionMenu("Fragile restore");
  await screen.getByText("Archive session", { visible: true }).tap();
  await expect(screen.getByText("Archived “Fragile restore”.")).toBeVisible();
  await expect(screen.getByText("Archived “Fragile restore”.")).toBeHidden({ timeout: 20_000 });
  await expect(screen.getByLabel(row("Fragile restore"))).toBeHidden();
});

test("Sessions, Archived restores a tree that stays restored, and a message to an archived session restores its tree", { tags: ["SESS-036"], platforms: ["web"] }, async ({ screen, hui }) => {
  const tree = async () => {
    await screen.getByRole("button", "Expand subagents of Archived plan").tap();
    await expect(screen.getByLabel(row(child.title))).toBeVisible();
  };
  const parent = await hui.createSession({ title: "Archived plan" });
  const child = await hui.createSubagent(parent);
  await hui.api("PATCH", `/__hui/sessions/${parent.id}`, { archived: true });

  await hui.open("/sessions");
  await screen.getByRole("button", "Archived").tap();
  await expect(screen.getByRole("button", "Restore Archived plan")).toBeVisible();
  await expect(screen.getByRole("button", `Restore ${child.title}`)).toBeVisible();
  await expect(screen.getByText("Archived", { exact: true, visible: true })).toHaveCount(3);
  await screen.getByRole("button", "Restore Archived plan").tap();
  await expect(screen.getByText("No matching sessions")).toBeVisible();
  await expect(screen.getByLabel(row("Archived plan"))).toBeVisible();
  await tree();
  await hui.reload();
  await expect(screen.getByLabel(row("Archived plan"))).toBeVisible();
  await tree();

  await hui.api("PATCH", `/__hui/sessions/${parent.id}`, { archived: true });
  await hui.open(`/sessions/${parent.id}`);
  await screen.getByLabel("Message", { visible: true }).fill("Wake up");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel(row("Archived plan"))).toBeVisible();
  await tree();
});
