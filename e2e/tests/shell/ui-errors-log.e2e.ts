/** Browser-side failures reach Logs: a request the browser could not deliver to the gateway appears as a `ui` entry with
 * its repeats merged into one count, waits while the gateway is unreachable and is sent once it answers again, and a page
 * that is reloaded meanwhile never sends what it held (SHELL-025). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a request the browser could not get to the gateway appears in Logs once with its count, and what an unreachable gateway left waiting is sent when it answers again unless the page was reloaded", { tags: ["SHELL-025"], platforms: ["web"] }, async ({ screen, hui }) => {
  const logs = screen.getByLabel("logs");
  const refresh = screen.getByRole("button", "Refresh");
  const unreachable = "Could not reach HUI. Check the connection and try again.";
  const merged = /^request_failed: UI request could not reach the gateway \(2×\)/u;
  /** The Logs entries for the failed diagnostics reads themselves, one per distinct request. */
  const reported = async () => (await hui.api<{ logs: { area: string; action: string; summary: string; detail?: string }[] }>("GET", "/__hui/observability"))
    .logs.filter((entry) => entry.area === "ui" && entry.action === "request_failed" && entry.detail?.startsWith("GET /__hui/observability:"))
    .map((entry) => entry.summary);

  await hui.open("/logs");
  await expect(refresh).toBeVisible();
  await expect.poll(() => hui.offlineFilesReady(), { timeout: 120_000 }).toBe(true);

  // Two reads the gateway never receives: the page keeps both, so nothing reaches Logs yet.
  await hui.network("offline");
  await refresh.tap();
  await expect(screen.getByText(unreachable)).toBeVisible();
  await refresh.tap();
  await expect(screen.getByText(unreachable)).toBeVisible();

  // Once the gateway answers again the batch goes, and the repeat is one entry with its count.
  await hui.network("online");
  await refresh.tap();
  await expect(screen.getByText(unreachable)).toBeHidden();
  await expect.poll(reported, { timeout: 60_000 }).toEqual(["UI request could not reach the gateway (2×)"]);
  await refresh.tap();
  await expect(logs.getByText(merged).first()).toBeVisible();

  // A failure the page still holds when it is reloaded never reaches Logs.
  await hui.network("offline");
  await refresh.tap();
  await expect(screen.getByText(unreachable)).toBeVisible();
  await hui.reload();
  await hui.network("online");
  await hui.open("/logs");
  await refresh.tap();
  await expect.poll(reported, { timeout: 30_000 }).toEqual(["UI request could not reach the gateway (2×)"]);
  await expect(logs.getByText(merged).first()).toBeVisible();
});
