/** A HUI request the browser could not get to the gateway reaches Logs as one `ui` entry with a count, delivered once the gateway is back (SHELL-025). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Observability = { logs: { area: string; action: string; summary: string; detail?: string }[] };

/** The `ui` failures Logs holds, with the Logs page's own reads picked out by their path. */
const logReads = async (hui: Hui) =>
  (await hui.api<Observability>("GET", "/__hui/observability")).logs
    .filter((entry) => entry.area === "ui" && entry.action === "request_failed" && entry.detail?.startsWith("GET /__hui/observability:"));

test("a request that could not reach the gateway shows in Logs as one merged ui entry with a count once the gateway is back", { tags: ["SHELL-025"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/logs");
  await expect(screen.getByTestId("page-title")).toHaveText("Logs");
  const logs = screen.getByLabel("logs");
  const refresh = screen.getByRole("button", "Refresh");
  const before = (await logReads(hui)).length;

  // Two reads that cannot reach the gateway merge into one report, which waits for the gateway to come back.
  await hui.network("offline");
  await refresh.tap();
  await refresh.tap();
  await hui.network("online");

  // The next read that reaches the gateway delivers the waiting report, and the one after it shows it.
  await refresh.tap();
  await expect.poll(async () => (await logReads(hui)).length, { timeout: 30_000 }).toBe(before + 1);
  await refresh.tap();
  const merged = (await logReads(hui)).filter((entry) => /\(\d+×\)$/u.test(entry.summary));
  expect(merged).toHaveLength(1);
  expect(merged[0]!.summary).toMatch(/^UI request could not reach the gateway \([2-9]\d*×\)$/u);
  expect(merged[0]!.detail).toMatch(/^GET \/__hui\/observability: Failed to fetch on \/logs · first .+, last .+$/u);
  await expect(logs.getByText(/^GET \/__hui\/observability: Failed to fetch on \/logs · first .+, last .+$/u)).toBeVisible();
  await expect(logs.getByText(/^request_failed: UI request could not reach the gateway \(\d+×\)/u).first()).toBeVisible();
  await expect(logs.getByText("warning", { exact: true }).first()).toBeVisible();
  await expect(logs.getByText("ui", { exact: true }).first()).toBeVisible();
});
