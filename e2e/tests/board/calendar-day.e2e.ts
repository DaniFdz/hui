/** A date heading opens that day as one full-width column, with its sessions, blocks, totals and per-item time, cards saying "this day", no Hours per day, and a grouping switch or focus that keeps the day (BOARD-057). */
import { basename } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** The activity day (5 AM to 5 AM) `date` falls in, as the calendar lays it out. */
const dayStart = (date: Date) => {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 5);
  if (date < day) day.setDate(day.getDate() - 1);
  return day;
};
/** This week's Monday is the first heading; today's heading is where the day sits in the week. */
const todayHeading = () => (dayStart(new Date()).getDay() + 6) % 7;

test("activating a date heading shows that day as one full-width column with its sessions, blocks, totals and per-item time, cards saying this day, no Hours per day, and a grouping or focus that keeps the day", { tags: ["BOARD-057"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repo = await hui.repository();
  const alpha = await hui.createSession({ title: "Day view alpha" });
  const beta = await hui.createSession({ title: "Day view repo", cwd: repo.path });
  for (const session of [alpha, beta]) await hui.prompt(session, "Record work for the day view.");
  await hui.open("/contributions");
  await screen.getByRole("button", "Calendar").tap();

  const blocks = screen.getByRole("button", /of activity/u);
  const headings = screen.getByRole("button", { name: /^View /u });
  await expect(blocks).toHaveCount(2);
  await expect(headings).toHaveCount(7);
  const today = todayHeading();
  for (let index = 0; index < 7; index++) {
    if (index <= today) await expect(headings.nth(index)).toBeEnabled();
    else await expect(headings.nth(index)).toBeDisabled();
  }
  const weekWidth = (await blocks.first().boundingBox())!.width;

  await headings.nth(today).tap();
  await expect(screen.getByRole("button", "Back to week")).toBeVisible();
  await expect(screen.getByRole("button", { name: /^View /u })).toHaveCount(0);
  await expect(screen.getByText("2 sessions", { exact: true })).toBeVisible();
  await expect(screen.getByText("2 blocks", { exact: true })).toBeVisible();
  await expect(screen.getByText(/Recorded activity, parallel time counted once · .+ of session time$/u)).toBeVisible();
  await expect(screen.getByText("Hours per day")).toBeHidden();
  await expect(blocks).toHaveCount(2);
  const dayWidth = (await blocks.first().boundingBox())!.width;
  expect(dayWidth).toBeGreaterThan(weekWidth * 3);

  const total = screen.getByText("across", { exact: false });
  const recorded = (await hui.textOf(total)).split(" across ")[0]!.replace(/\s+/gu, " ").trim();
  await blocks.first().tap();
  await expect(screen.getByRole("dialog")).toBeVisible();
  await expect(screen.getByText(/^(?:<1m|\d+m|\d+h \d{2}m) this day$/u)).toBeVisible();
  await expect(screen.getByLabel("Time per project")).toBeVisible();
  await screen.getByTestId("page-title").tap();
  await expect(screen.getByRole("dialog")).toBeHidden();

  await screen.getByRole("button", "Group", { exact: true }).tap();
  await expect(screen.getByRole("button", "Back to week")).toBeVisible();
  await expect(screen.getByLabel("Time per group")).toBeVisible();
  await expect(total).toContainText(`across 1 group`);
  await expect(total).toContainText(recorded);
  await expect(blocks).toHaveCount(1);

  await screen.getByRole("button", "Project", { exact: true }).tap();
  await expect(blocks).toHaveCount(2);
  const project = screen.getByLabel("Time per project").getByRole("button", { name: new RegExp(`^${basename(repo.path)}`, "u") });
  await project.tap();
  await expect(screen.getByText(`Showing ${basename(repo.path)}`, { exact: false })).toBeVisible();
  await expect(blocks).toHaveCount(1);
  await screen.getByRole("button", "Show all").tap();
  await expect(screen.getByRole("button", "Show all")).toBeHidden();
  await expect(blocks).toHaveCount(2);
  await expect(screen.getByRole("button", "Back to week")).toBeVisible();
});
