/** A request the browser could not get to the gateway reaches Logs as one `ui` entry with a count of its repeats, once the gateway is back (SHELL-025). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Activity = { activity: { id: number; area: string; action: string; level: string; summary: string; detail?: string }[] };

/** The `ui` entries the gateway recorded for a request path. */
const uiEntries = async (hui: { api: <T>(method: string, path: string) => Promise<T> }, path: string) =>
  (await hui.api<Activity>("GET", "/__hui/observability")).activity
    .filter((entry) => entry.area === "ui" && entry.action === "request_failed" && entry.detail?.includes(path));

test("a request that could not reach the gateway reaches Logs as one ui entry with a count of its repeats once the gateway is back", { tags: ["SHELL-025"], platforms: ["web"] }, async ({ screen, hui }) => {
  const nav = (name: string) => screen.getByTestId("nav-item").filter({ hasText: name });
  const title = screen.getByTestId("page-title");
  // A phone keeps the primary navigation in its drawer, which a choice closes again, so every destination is
  // reached through it.
  const goTo = async (name: string) => {
    await hui.sessionList();
    await nav(name).tap();
  };

  await hui.clearOffline();
  await hui.open("/");
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  // The gateway's log spans the whole suite. Account for older failures without letting this test's repeats make
  // more than one new entry.
  const previous = await uiEntries(hui, "/__hui/github/contributions");
  const previousIds = new Set(previous.map((entry) => entry.id));
  const reported = async () => (await uiEntries(hui, "/__hui/github/contributions")).filter((entry) => !previousIds.has(entry.id));

  // Two loads of the same page data while the gateway cannot be reached.
  await hui.network("offline");
  await goTo("Contributions");
  await expect(title).toHaveText("Contributions");
  await goTo("Usage");
  await expect(title).toHaveText("Usage");
  await goTo("Contributions");
  await expect(title).toHaveText("Contributions");

  // Back online, the next HUI request carries the report the page held while it could not reach the gateway.
  await hui.network("online");
  await goTo("Usage");
  await expect(title).toHaveText("Usage");
  await expect.poll(async () => (await reported()).length, { timeout: 60_000 }).toBe(1);
  const [entry] = await reported();
  // Repeats are one entry with a count, not one entry each.
  const repeats = Number(/\((\d+)×\)$/u.exec(entry!.summary)?.[1] ?? 1);
  expect(entry!.summary).toMatch(/^UI request could not reach the gateway \(\d+×\)$/u);
  expect(repeats).toBeGreaterThan(1);
  expect(entry!.detail).toContain("GET /__hui/github/contributions");

  // Logs shows it as a ui warning with the request it names.
  await hui.open("/logs");
  const logs = screen.getByLabel("logs");
  // The stream holds every entry the gateway recorded, other tests' included: the row this test made is the one that
  // shows exactly what the gateway stored for it, so its repeats stay one count on that single row.
  const row = logs.getByText(`request_failed: UI request could not reach the gateway (${repeats}×)${entry!.detail}`, { exact: true });
  const olderMatching = previous.filter((older) => older.summary === entry!.summary && older.detail === entry!.detail).length;
  await expect(row).toHaveCount(olderMatching + 1);
  await expect(row.first()).toBeVisible();
  expect(entry!.level).toBe("warning");
});
