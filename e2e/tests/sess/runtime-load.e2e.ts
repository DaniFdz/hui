/** The Sessions page's runtime summary and each row's runtime reading: the Live count, loaded and working runtimes, total memory, heaviest runtime and average startup, Active or Cold with memory and startup ("Measuring…" while starting), all read again by Refresh (SESS-059). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Session = { id: string; title: string; status: string; runtime?: { active: true; memoryBytes?: number; bootDurationMs?: number } };
type Listed = { revision: number; groups: { label: string; sessions: Session[] }[] };

test("the Sessions page reads the runtime summary and each row's Active or Cold, memory and startup, and Refresh reads them again", { tags: ["SESS-059"], platforms: ["web"] }, async ({ screen, hui }) => {
  const row = (title: string) => screen.getByTestId("session-data-row").filter({ hasText: title });
  const summary = screen.getByLabel("Runtime resource summary");
  const answer = async (mutate: (sessions: Session[]) => void) => {
    const listed = await hui.api<Listed>("GET", "/__hui/sessions");
    mutate(listed.groups.flatMap((group) => group.sessions));
    return JSON.stringify(listed);
  };
  await hui.createSession({ title: "Zulu cold" });
  const warm = await hui.createSession({ title: "Bravo warm" });
  await hui.prompt(warm, "E2E_REPLAY");
  await hui.provider.held();

  await hui.open("/sessions");
  const cold = row("Zulu cold");
  const warmRow = row("Bravo warm");
  const startup = /(?:\d+ ms|\d+(?:\.\d+)? s)/u.exec(await hui.textOf(warmRow))![0];
  await expect(warmRow.getByText("Active", { exact: true })).toBeVisible();
  await expect(warmRow.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(warmRow.getByText(startup, { exact: true })).toBeVisible();
  await expect(summary.getByText("Loaded runtimes")).toBeVisible();
  await expect(summary.getByText("2", { exact: true })).toBeVisible();
  await expect(summary.getByText("1 working now")).toBeVisible();
  await expect(summary.getByText("Total memory")).toBeVisible();
  await expect(summary.getByText("0 of 2 measured")).toBeVisible();
  await expect(summary.getByText("Heaviest runtime")).toBeVisible();
  await expect(summary.getByText("Average startup")).toBeVisible();
  await expect(screen.getByText("1 Live", { exact: true })).toBeVisible();

  const refreshed = await hui.intercept("GET", /\/__hui\/sessions$/u);
  await screen.getByRole("button", "Refresh").tap();
  await refreshed.arrived();
  await refreshed.answer(await answer((sessions) => {
    delete sessions.find(({ title }) => title === "Zulu cold")!.runtime;
    sessions.find(({ title }) => title === "Bravo warm")!.runtime = { active: true, memoryBytes: 987_654_321, bootDurationMs: 4_321 };
  }));
  await expect(cold.getByText("Cold", { exact: true })).toBeVisible();
  await expect(cold.getByText("—", { exact: true })).toHaveCount(2);
  await expect(warmRow.getByText("942 MB", { exact: true })).toBeVisible();
  await expect(warmRow.getByText("4.3 s", { exact: true })).toBeVisible();
  await expect(summary.getByText("1", { exact: true })).toBeVisible();
  await expect(summary.getByText("All loaded runtimes")).toBeVisible();
  await expect(summary.getByText("942 MB", { exact: true })).toHaveCount(2);
  await expect(summary.getByText("Bravo warm", { exact: true })).toBeVisible();
  await expect(summary.getByText("4.3 s", { exact: true })).toBeVisible();

  const events = await hui.intercept("GET", /\/__hui\/sessions\/events$/u);
  const starting = await hui.intercept("GET", /\/__hui\/sessions$/u);
  await hui.reload();
  await starting.arrived();
  await events.arrived();
  await starting.answer(await answer((sessions) => {
    sessions.find(({ title }) => title === "Bravo warm")!.status = "starting";
  }));
  await expect(warmRow).toBeVisible();
  await expect(warmRow.getByText("Measuring…", { exact: true })).toBeVisible();
  await expect(screen.getByText("1 Live", { exact: true })).toBeVisible();
  await events.deliver();
});