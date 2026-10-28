/** Usage reports the tokens and recorded PI cost estimates of real turns, and follows its range, chart, search and sort (PAGE-021). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import type { UsageReport } from "../../../src/api/schema/diagnostics.ts";

async function richTurn(screen: Screen, hui: Hui, title: string) {
  const session = await hui.createSession({ title });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill("E2E_RICH");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("transcript").getByText("Tool complete")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  return session;
}

async function shownRange(screen: Screen) {
  return { from: await screen.getByLabel("From").inputValue(), to: await screen.getByLabel("To").inputValue() };
}

test("Usage reports a real turn's tokens, its recorded PI cost and its session", { tags: ["PAGE-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const totals = screen.getByTestId("usage-totals");
  const sessions = screen.getByTestId("usage-sessions");
  const chart = screen.getByTestId("usage-chart");

  await richTurn(screen, hui, "Usage coverage");
  for (const text of ["USAGE_BEFORE_COMPACTION", `USAGE_KEPT ${"kept ".repeat(400)}`]) {
    await screen.getByLabel("Message").fill(text);
    await screen.getByRole("button", "Send message").tap();
    await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
    await expect(screen.getByTestId("transcript").getByText(text, { exact: true })).toBeVisible();
  }
  await hui.open("/usage");
  await expect(screen.getByTestId("usage-report")).toBeVisible();

  await expect(totals).toBeVisible();
  await expect(totals).toContainText("Total tokens", { ignoreCase: true });
  await expect(totals).toContainText("PI cost estimate", { ignoreCase: true });
  await expect(totals).toContainText("$0.00");
  await expect(totals).toContainText("Sessions", { ignoreCase: true });
  await expect(totals).not.toContainText("Unavailable", { ignoreCase: true });
  await expect(chart.getByRole("button", /: [1-9][\d,]* tokens · \$0\.00$/u)).toBeVisible();
  await expect(screen.getByText("hui-e2e/fixture", { exact: false })).toBeVisible();

  const beforeCompaction = await totals.allTextContents();
  await expect(sessions.getByRole("button", /Usage coverage/u)).toBeVisible();
  await sessions.getByRole("button", /Usage coverage/u).tap();
  await expect(screen.getByTestId("transcript").getByText("Tool complete")).toBeVisible();
  await screen.getByLabel("Message").fill("/compact");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText(/Context compacted/u)).toBeVisible();
  await hui.open("/usage");
  const outsideEntries = screen.getByTestId("usage-unplaced");
  await expect(outsideEntries).toContainText("2 tokens, $0.00, for all recorded time");
  await expect.poll(() => totals.allTextContents()).toEqual(beforeCompaction);
  await screen.getByRole("button", /No recorded usage/u).first().tap();
  await expect(screen.getByText("No usage in this range.")).toBeVisible();
  await expect(outsideEntries).toContainText("2 tokens, $0.00, for all recorded time");
  await screen.getByRole("button", "All").tap();
  await expect(sessions.getByRole("button", /Usage coverage/u)).toBeVisible();
  await expect(outsideEntries).toContainText("2 tokens, $0.00, for all recorded time");
  await screen.getByPlaceholder("Title, ID or model").fill("no matching session");
  await expect(screen.getByText("No sessions match your search.")).toBeVisible();
  await expect(outsideEntries).toContainText("2 tokens, $0.00, for all recorded time");
});

test("Usage follows its range, its time zone and its chart", { tags: ["PAGE-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const chart = screen.getByTestId("usage-chart");

  await richTurn(screen, hui, "Usage range");
  await hui.open("/usage");
  await expect(chart).toBeVisible();
  await expect(chart).toContainText(/\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} ·/u);
  await expect(screen.getByLabel("Range presets")).toBeVisible();
  await expect(screen.getByLabel("Chart metric")).toBeVisible();
  await expect(screen.getByLabel("Token breakdown")).toBeVisible();
  const chooseRange = async (preset: string, days: number) => {
    await screen.getByRole("button", preset).tap();
    await expect.poll(async () => { const { from, to } = await shownRange(screen); return (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1; }).toBe(days);
    const range = await shownRange(screen);
    await expect(chart).toContainText(`${range.from} to ${range.to}`);
    return range;
  };
  for (const [preset, days] of [["Today", 1], ["7d", 7], ["90d", 90], ["1y", 366], ["All", 1]] as const) await chooseRange(preset, days);
  await chooseRange("1y", 366);
  await expect(chart).toContainText("Monthly token usage", { ignoreCase: true });
  await expect(chart.getByRole("button", /^[A-Z][a-z]{2} \d{4}: /u).first()).toBeVisible();
  await chooseRange("90d", 90);
  await expect(chart).toContainText("Weekly token usage", { ignoreCase: true });
  await chart.getByRole("button", / to [A-Z][a-z]{2} \d{1,2}: [\d,]+ tokens · /u).last().tap();
  await expect.poll(async () => { const { from, to } = await shownRange(screen); return (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1; }).toBeLessThanOrEqual(7);
  const grouped = await shownRange(screen);
  await expect(chart).toContainText(`${grouped.from} to ${grouped.to}`);
  const month = await chooseRange("30d", 30);
  await expect(chart).toContainText("Daily token usage", { ignoreCase: true });
  await screen.getByLabel("From").fill(month.to);
  await chooseRange("30d", 30);
  await expect(screen.getByLabel("From")).toHaveValue(month.from);

  await screen.getByLabel("Time zone").selectOption("UTC");
  await expect(chart).toContainText("· UTC");
  await screen.getByLabel("Time zone").selectOption("Local");
  await expect(screen.getByLabel("Time zone")).toHaveValue("local");
  await expect(screen.getByTestId("usage-report")).toHaveAttribute("aria-busy", "false");
  const beforeDisplay = await screen.getByTestId("usage-totals").allTextContents();

  for (let pass = 0; pass < 2; pass++) {
    await screen.getByRole("button", "Cost").tap();
    await expect(chart).toContainText("Daily cost estimates", { ignoreCase: true });
    await expect(screen.getByRole("button", "Total")).toBeHidden();
    await screen.getByRole("button", "Tokens").tap();
    await expect(chart).toContainText("Daily token usage", { ignoreCase: true });
  }
  await screen.getByRole("button", "By type").tap();
  await expect(screen.getByRole("button", "By type")).toHaveAttribute("aria-pressed", "true");
  await screen.getByRole("button", "Total").tap();
  await expect(screen.getByRole("button", "Total")).toHaveAttribute("aria-pressed", "true");
  const days = chart.getByRole("button", /: [\d,]+ tokens ·/u);
  await days.first().press("End");
  await expect(days.last()).toBeFocused();
  await days.last().press("Home");
  await expect(days.first()).toBeFocused();
  await expect.poll(() => screen.getByTestId("usage-totals").allTextContents()).toEqual(beforeDisplay);

  await screen.getByRole("button", /: [1-9][\d,]* tokens · \$0\.00$/u).tap();
  await expect.poll(async () => { const { from, to } = await shownRange(screen); return from === to; }).toBe(true);
  const day = await shownRange(screen);
  await expect(chart).toContainText(`${day.from} to ${day.to}`);

  const week = await chooseRange("7d", 7);
  await screen.getByLabel("From").fill(week.to);
  await screen.getByRole("button", "Apply range").tap();
  await expect(chart).toContainText(`${week.to} to ${week.to}`);

  await chooseRange("30d", 30);
  await expect(screen.getByRole("button", /No recorded usage/u).first()).toBeVisible();
  await screen.getByRole("button", /No recorded usage/u).first().tap();
  await expect(screen.getByText("No usage in this range.")).toBeVisible();
});

test("Usage searches its sessions by title, id or model, sorts them and reads them again", { tags: ["PAGE-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const sessions = screen.getByTestId("usage-sessions");
  const totals = screen.getByTestId("usage-totals");
  const filter = screen.getByLabel("Filter sessions");
  const clear = screen.getByRole("button", "Clear search");
  const sort = screen.getByLabel("Sort sessions");
  const titles = async () => (await sessions.getByRole("button").allTextContents())
    .map((text) => (/Usage coverage alpha/u.test(text) ? "alpha" : /Usage coverage beta/u.test(text) ? "beta" : text));

  const first = await richTurn(screen, hui, "Usage coverage alpha");
  await screen.getByLabel("Message").fill("E2E_RICH");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(screen.getByTestId("transcript").getByText("Tool complete")).toHaveCount(2);
  await richTurn(screen, hui, "Usage coverage beta");

  await hui.open("/usage");
  await expect(sessions).toBeVisible();
  await expect(sessions.getByRole("button")).toHaveCount(2);
  await expect.poll(titles).toEqual(["beta", "alpha"]);

  await sort.selectOption("Tokens");
  await expect.poll(titles).toEqual(["alpha", "beta"]);
  await sort.selectOption("Cost");
  await expect(sort).toHaveValue("cost");
  await expect(sessions.getByRole("button")).toHaveCount(2);

  await filter.fill("alpha");
  await expect(sessions.getByRole("button")).toHaveCount(1);
  await expect(totals).toContainText(/\b1\s*sessions/iu);
  await expect(clear).toBeVisible();
  await filter.fill("nothing recorded matches this");
  await expect(screen.getByText("No sessions match your search.")).toBeVisible();
  await clear.tap();
  await expect(filter).toHaveValue("");
  await expect(sessions.getByRole("button")).toHaveCount(2);
  await expect(clear).toBeHidden();

  await filter.fill(first.id);
  await expect(sessions.getByRole("button")).toHaveCount(1);
  await clear.tap();
  await filter.fill("hui-e2e/fixture");
  await expect(sessions.getByRole("button")).toHaveCount(2);
  await clear.tap();

  const before = await totals.allTextContents();
  const calls = async () => (await hui.api<UsageReport>("GET", "/__hui/usage")).sessions.find(({ id }) => id === first.id)?.metrics.calls ?? 0;
  const recorded = await calls();
  await hui.api("POST", `/__hui/sessions/${first.id}/prompt`, { text: "E2E_RICH" });
  await expect.poll(calls).toBeGreaterThan(recorded);
  await screen.getByRole("button", "Refresh").tap();
  await expect.poll(() => totals.allTextContents()).not.toEqual(before);
  await expect(sessions.getByRole("button")).toHaveCount(2);
  await expect(screen.getByTestId("usage-report")).toBeVisible();
});