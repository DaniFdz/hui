/** The calendar keeps its period and data through a failed read, disables navigation while loading, and reads again with Retry or Refresh (BOARD-060). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("while a period loads date navigation is disabled, a failed read keeps the shown week with the error above it, the first failure offers Retry, and Retry or Refresh reads again", { tags: ["BOARD-060"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Calendar failure card" });
  await hui.prompt(session, "Load a block for the failing calendar.");
  const loading = await hui.intercept("GET", /\/__hui\/session-activity/u);
  await hui.open("/contributions");
  await screen.getByRole("button", "Calendar").tap();
  const previous = screen.getByRole("button", "Previous week");
  const thisWeek = screen.getByRole("button", "This week");
  await loading.arrived();
  await expect(previous).toBeDisabled();
  await expect(thisWeek).toBeDisabled();
  await loading.deliver();
  const block = screen.getByRole("button", /of activity$/u);
  await expect(block).toBeVisible();

  const failing = await hui.intercept("GET", /\/__hui\/session-activity/u);
  await previous.tap();
  await failing.arrived();
  await expect(screen.getByRole("button", "Refresh")).toBeDisabled();
  await failing.reject(503, "The activity store is restarting.");
  await expect(screen.getByText("The activity store is restarting.")).toBeVisible();
  await expect(block).toBeVisible();
  await expect(thisWeek).toBeDisabled();
  await expect(screen.getByRole("button", "Retry")).toBeHidden();

  const reread = await hui.intercept("GET", /\/__hui\/session-activity/u);
  await screen.getByRole("button", "Refresh").tap();
  await reread.arrived();
  await reread.deliver();
  await expect(block).toBeVisible();
  await expect(screen.getByText("The activity store is restarting.")).toBeHidden();

  const firstFailing = await hui.intercept("GET", /\/__hui\/session-activity/u);
  await hui.reload();
  await firstFailing.reject(503, "The activity store is restarting.");
  const retry = screen.getByRole("button", "Retry");
  await expect(retry).toBeVisible();
  await expect(screen.getByText("The activity store is restarting.", { exact: false })).toBeVisible();
  const retried = await hui.intercept("GET", /\/__hui\/session-activity/u);
  await retry.tap();
  await retried.arrived();
  await retried.deliver();
  await expect(block).toBeVisible();
  await expect(retry).toBeHidden();
});
