/** The Gateway settings page reads the live transport, permissions and runtime, keeps those values labelled as last known when a health check fails, and restores them on Retry (SET-017, SET-018). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the Gateway page shows live runtime values and recovers after a failed health check", { tags: ["SET-017", "SET-018"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const connected = page.getByText("Connected", { exact: true });
  const disconnected = page.getByText("Disconnected", { exact: true });
  const notice = page.getByText(/^Could not reach gateway:/u);

  await hui.open("/settings/connection");
  await expect(connected).toBeVisible();
  await expect(page.getByText("HTTP + SSE", { exact: true })).toBeVisible();
  await expect(page.getByText("Full Access", { exact: true })).toBeVisible();
  await expect(page.getByText("Uptime", { exact: true })).toBeVisible();
  await expect(page.getByText(/^\d+[dhms]( \d+[dhms])*$/u).first()).toBeVisible();
  await expect(page.getByText("Registered sessions", { exact: true })).toBeVisible();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await expect(page.getByText("Idle", { exact: true })).toBeVisible();
  await expect(page.getByText("Live process state · updates automatically.", { exact: true })).toBeVisible();

  const failing = await hui.answerAll("GET", /\/__hui\/health$/u, JSON.stringify({ error: "The gateway is not answering." }), 503);
  await expect(disconnected).toBeVisible({ timeout: 15_000 });
  await expect(notice).toBeVisible();
  await expect(page.getByText("Last known values · waiting to reconnect.", { exact: true })).toBeVisible();
  await expect(page.getByText("Registered sessions", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", "Retry connection")).toBeVisible();

  await failing.stop();
  await page.getByRole("button", "Retry connection").click();
  await expect(connected).toBeVisible();
  await expect(notice).toBeHidden();
  await expect(page.getByText("Live process state · updates automatically.", { exact: true })).toBeVisible();
});
