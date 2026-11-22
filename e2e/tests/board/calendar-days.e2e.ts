/** Previous day, Next day, Today and Back to week step the calendar a day at a time across weeks, and a day without work says so (BOARD-058). */
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

test("Previous day and Next day step across days and weeks, Today returns to the current activity day and disables itself and Next day, a day without work says so, and Back to week returns to the week containing the day with the grouping kept", { tags: ["BOARD-058"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Day navigation" });
  await hui.prompt(session, "Record work for stepping between days.");
  await hui.open("/contributions");
  await screen.getByRole("button", "Calendar").tap();

  const blocks = screen.getByRole("button", /of activity/u);
  const previous = screen.getByRole("button", "Previous day");
  const next = screen.getByRole("button", "Next day");
  const today = screen.getByRole("button", "Today");
  const empty = screen.getByText("No HUI session activity this day.");
  await expect(blocks).toHaveCount(1);
  await screen.getByRole("button", { name: /^View /u }).nth(todayHeading()).tap();
  await expect(previous).toBeVisible();
  await expect(today).toBeDisabled();
  await expect(next).toBeDisabled();
  await expect(blocks).toHaveCount(1);

  await previous.tap();
  await expect(empty).toBeVisible();
  await expect(blocks).toHaveCount(0);
  await expect(today).toBeEnabled();
  await expect(next).toBeEnabled();

  await next.tap();
  await expect(blocks).toHaveCount(1);
  await expect(empty).toBeHidden();
  await expect(today).toBeDisabled();

  await previous.tap();
  await expect(empty).toBeVisible();
  await today.tap();
  await expect(blocks).toHaveCount(1);
  await expect(today).toBeDisabled();

  for (let day = 0; day < 7; day++) await previous.tap();
  await expect(empty).toBeVisible();
  await expect(today).toBeEnabled();

  await screen.getByRole("button", "Session", { exact: true }).tap();
  await screen.getByRole("button", "Back to week").tap();
  await expect(screen.getByRole("button", "This week")).toBeEnabled();
  await expect(screen.getByRole("button", "Next week")).toBeEnabled();
  await expect(hui.pressed(screen, "Session")).toBeVisible();
  await expect(screen.getByText("No HUI session activity this week.")).toBeVisible();

  await screen.getByRole("button", "This week").tap();
  await expect(blocks).toHaveCount(1);
  await expect(screen.getByLabel("Time per session").getByText("Day navigation", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "This week")).toBeDisabled();
  await expect(screen.getByRole("button", "Next week")).toBeDisabled();
});
