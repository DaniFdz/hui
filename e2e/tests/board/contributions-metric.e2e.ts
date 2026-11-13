/** The Commits / Pull requests switch redraws both Contributions charts and the browser remembers it after a reload (BOARD-045). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the Commits / Pull requests switch changes both charts and the browser remembers the choice after a reload", { tags: ["BOARD-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  await hui.open(`${world.url}/contributions`);

  await expect(screen.getByText(/^[\d,]+ commits in the last year$/u)).toBeVisible();
  await expect(screen.getByRole("heading", { name: "Commits per week", exact: true })).toBeVisible();
  await expect(screen.getByRole("img", { name: /^[\d,]+ commits in the last year$/u })).toBeVisible();
  await expect(screen.getByRole("img", { name: /^[\d,]+ commits per week in the last year$/u })).toBeVisible();

  await screen.getByRole("button", "Pull requests").tap();
  // Both charts follow: the calendar says pull requests, and so does the weekly chart with its average.
  await expect(screen.getByRole("img", { name: /^[\d,]+ pull requests in the last year$/u })).toBeVisible();
  await expect(screen.getByRole("img", { name: /^[\d,]+ pull requests per week in the last year$/u })).toBeVisible();
  await expect(screen.getByRole("heading", { name: "Pull requests per week", exact: true })).toBeVisible();
  await expect(screen.getByText(/^[\d.]+ a week on average in the last year\.$/u)).toBeVisible();
  await expect(screen.getByRole("button", "Pull requests", { pressed: true })).toBeVisible();

  await hui.reload();
  await expect(screen.getByRole("button", "Pull requests", { pressed: true })).toBeVisible();
  await expect(screen.getByRole("img", { name: /^[\d,]+ pull requests in the last year$/u })).toBeVisible();
  await expect(screen.getByRole("heading", { name: "Pull requests per week", exact: true })).toBeVisible();
});
