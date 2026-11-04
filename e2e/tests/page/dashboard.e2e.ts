/** Labs → Dashboard adds the Dashboard page, which shows the sessions in flight and the host's metrics (PAGE-044, PAGE-045). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Labs = { labs: { dashboard: boolean } };

test("Labs → Dashboard adds the Dashboard to the sidebar and keeps it across a reload", { tags: ["PAGE-044"], platforms: ["web"] }, async ({ screen, hui }) => {
  const navigation = screen.getByTestId("primary-navigation");
  const dashboard = screen.getByTestId("dashboard");
  const toggle = screen.getByRole("switch", "Dashboard");

  await hui.open("/dashboard");
  await expect(navigation.getByText("Usage")).toBeVisible();
  await expect(navigation.getByText("Dashboard")).toBeHidden();
  await expect(dashboard).toBeHidden();

  await hui.open("/labs");
  await expect(toggle).toBeChecked({ checked: false });
  await toggle.tap({ position: { x: 8, y: 8 } });
  await expect(navigation.getByText("Dashboard")).toBeVisible();
  await expect.poll(async () => (await hui.api<Labs>("GET", "/__hui/settings")).labs.dashboard).toBe(true);

  await hui.reload();
  await expect(toggle).toBeChecked();
  await navigation.getByText("Dashboard").tap();
  await expect(dashboard).toBeVisible();
  await expect(screen.getByText("The sessions in flight and the gateway host's resource use.")).toBeVisible();

  await hui.open("/labs");
  await toggle.tap({ position: { x: 8, y: 8 } });
  await expect(toggle).toBeChecked({ checked: false });
  await expect(navigation.getByText("Dashboard")).toBeHidden();
});

test("Dashboard lists a running session, opens it, and shows the host's metrics", { tags: ["PAGE-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  const settings = await hui.api<Labs>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, labs: { ...settings.labs, dashboard: true } });
  const active = screen.getByTestId("dashboard-active-sessions");

  const session = await hui.createSession({ title: "Dashboard running" });
  await hui.open("/dashboard");
  await expect(screen.getByTestId("dashboard-summary")).toContainText("Idle");
  await expect(screen.getByLabel("Sessions by stage")).toContainText("Investigation");
  const needsYou = screen.getByTestId("dashboard-needs-you");
  await expect(needsYou.getByText("Dashboard running")).toBeVisible();
  await expect(screen.getByTestId("dashboard-summary")).toContainText("1 needs you");

  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await screen.getByTestId("primary-navigation").getByText("Dashboard").tap();
  await expect(active.getByText("Dashboard running")).toBeVisible();
  await expect(active).toContainText("Running");
  await expect(active).toContainText("Investigation");
  await expect(needsYou).toBeHidden();

  const metrics = screen.getByTestId("dashboard-metrics");
  await expect(metrics).toBeVisible();
  for (const title of ["CPU", "Memory", "Disk", "GPU", "Network", "Gateway process"]) await expect(metrics.getByText(title)).toBeVisible();
  await expect(metrics).toContainText(/\d+%/u);
  await expect(metrics).toContainText(/Load [\d.]+ · [\d.]+ · [\d.]+ · \d+ cores/u);
  await expect(metrics).toContainText(/ of /u);

  await active.getByText("Dashboard running").tap();
  await expect(screen.getByTestId("transcript").getByText("Replay prefix —", { exact: false })).toBeVisible();
  await hui.provider.release();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});

test("Needs you leads with a question, then an unread answer, then parked work, each longest wait first", { tags: ["PAGE-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  const settings = await hui.api<Labs>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, labs: { ...settings.labs, dashboard: true } });
  await writeFile(join(hui.workspace, "ask-order.json"), JSON.stringify({ questions: [{
    header: "Priority",
    question: "Which session should I look at first?",
    options: [{ label: "The one asking", description: "It cannot move until you answer." }, { label: "The newest", description: "Something in flight." }],
  }] }));

  const parked = ["Parked oldest", "Parked newest"];
  const unread = ["Unread oldest", "Unread newest"];
  for (const title of [...parked, ...unread]) await hui.createSession({ title });
  const asking = await hui.createSession({ title: "Waiting question" });

  await hui.open("/");
  for (const title of unread) {
    await screen.getByText(title).first().hover();
    await screen.getByRole("button", `Actions for ${title}`).tap();
    await screen.getByText("Mark as unread").tap();
    await expect(screen.getByText("Marked as unread.")).toBeVisible();
  }

  await hui.open(`/sessions/${asking.id}`);
  await screen.getByLabel("Message").fill("E2E_ASK_USER:order");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("Which session should I look at first?")).toBeVisible();

  await hui.open("/dashboard");
  const needsYou = screen.getByTestId("dashboard-needs-you");
  await needsYou.getByRole("button", "Show all 5").tap();
  await expect(needsYou.getByRole("listitem")).toHaveText([
    /^Waiting question/u,
    /^Unread oldest/u,
    /^Unread newest/u,
    /^Parked oldest/u,
    /^Parked newest/u,
  ]);
  await expect(needsYou.getByRole("listitem").nth(0)).toContainText("Needs input");
  await expect(needsYou.getByRole("listitem").nth(1)).toContainText("Unread");
  await expect(needsYou.getByRole("listitem").nth(3)).not.toContainText("Unread");
});
