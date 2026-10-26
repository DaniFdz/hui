/** The calendar's Group by switches its colours and side list between project, group and session, joins each unit's sessions into one block, keeps the total and is kept by the browser (BOARD-055). */
import { basename, join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Group by switches the calendar between project, group and session, joins each unit's sessions, keeps the total and survives a reload", { tags: ["BOARD-055"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repo = await hui.repository();
  const sessions = [
    await hui.createSession({ title: "Grouping alpha", group: "Alpha" }),
    await hui.createSession({ title: "Grouping alpha again", group: "Alpha" }),
    await hui.createSession({ title: "Grouping repository", cwd: repo.path }),
    await hui.createSession({ title: "Grouping subdirectory", cwd: join(repo.path, "sub") }),
  ];
  for (const session of sessions) await hui.prompt(session, "Record work for the grouping.");
  await hui.open("/contributions");
  await screen.getByRole("button", "Calendar").tap();

  const blocks = screen.getByRole("button", /of activity/u);
  const joined = screen.getByRole("button", /, 2 sessions$/u);
  const total = screen.getByText("across", { exact: false });
  const summary = async () => (await total.textContent())!.replace(/\s+/gu, " ").trim();
  const colours = async (count: number) => Promise.all(Array.from({ length: count }, (_, index) => blocks.nth(index).getAttribute("data-color")));
  await expect(screen.getByLabel("Time per project").getByText(basename(hui.workspace), { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Time per project").getByText(basename(repo.path), { exact: true })).toBeVisible();
  await expect(joined).toHaveCount(2);
  await expect(total).toContainText("across 2 projects");
  expect(new Set(await colours(2)).size).toBe(2);
  const projectTotal = (await summary()).split(" across ")[0];

  await screen.getByRole("button", "Group", { exact: true }).tap();
  await expect(screen.getByLabel("Time per group").getByText("Alpha", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Time per group").getByText("Other", { exact: true })).toBeVisible();
  await expect(joined).toHaveCount(2);
  await expect(total).toContainText("across 2 groups");
  expect((await summary()).split(" across ")[0]).toBe(projectTotal);
  expect(new Set(await colours(2)).size).toBe(2);

  await screen.getByRole("button", "Session", { exact: true }).tap();
  const perSession = screen.getByLabel("Time per session");
  for (const title of ["Grouping alpha", "Grouping alpha again", "Grouping repository", "Grouping subdirectory"]) {
    await expect(perSession.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(blocks).toHaveCount(4);
  await expect(total).toContainText("across 4 sessions");
  expect((await summary()).split(" across ")[0]).toBe(projectTotal);
  expect(new Set(await colours(4)).size).toBe(4);

  await hui.reload();
  await expect(screen.getByLabel("Time per session")).toBeVisible();
  await expect(blocks).toHaveCount(4);
});
