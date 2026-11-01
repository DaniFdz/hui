/** The calendar's week navigation: Previous week, This week and Next week move the period, never past this week, Refresh reads it again, a week without work says so and a new visit opens on this week (BOARD-052). */
import { basename } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Previous week, This week and Next week move the calendar but never past this week, Refresh reads it again, a week without work says so and the date is not kept between visits", { tags: ["BOARD-052"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Calendar week card" });
  await hui.prompt(session, "Record a little work for the calendar.");
  await hui.open("/contributions");
  await screen.getByRole("button", "Calendar").tap();

  const project = basename(hui.workspace);
  const projects = screen.getByLabel("Time per project");
  const previous = screen.getByRole("button", "Previous week");
  const thisWeek = screen.getByRole("button", "This week");
  const next = screen.getByRole("button", "Next week");
  await expect(projects.getByText(project)).toBeVisible();
  await expect(thisWeek).toBeDisabled();
  await expect(next).toBeDisabled();

  await previous.tap();
  await expect(screen.getByText("No HUI session activity this week.")).toBeVisible();
  await expect(projects.getByText(project)).toBeHidden();
  await expect(thisWeek).toBeEnabled();
  await expect(next).toBeEnabled();

  await next.tap();
  await expect(projects.getByText(project)).toBeVisible();
  await expect(thisWeek).toBeDisabled();
  await expect(next).toBeDisabled();

  await previous.tap();
  await expect(screen.getByText("No HUI session activity this week.")).toBeVisible();
  await thisWeek.tap();
  await expect(projects.getByText(project)).toBeVisible();
  await expect(thisWeek).toBeDisabled();
  await expect(next).toBeDisabled();

  const reread = await hui.intercept("GET", /\/__hui\/session-activity/u);
  await screen.getByRole("button", "Refresh").tap();
  await reread.arrived();
  await reread.deliver();
  await expect(projects.getByText(project)).toBeVisible();

  await previous.tap();
  await expect(screen.getByText("No HUI session activity this week.")).toBeVisible();
  await hui.reload();
  await expect(projects.getByText(project)).toBeVisible();
  await expect(thisWeek).toBeDisabled();
  await expect(next).toBeDisabled();
});
