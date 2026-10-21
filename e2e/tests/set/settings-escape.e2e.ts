/** Escape in Settings clears the search, closes an open select, menu or phone drawer, and otherwise leaves Settings (SET-003). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Escape clears the search, then leaves Settings; it closes an open select, a menu or the phone drawer and stays", { tags: ["SET-003"], platforms: ["web"] }, async ({ screen, hui }) => {
  const search = screen.getByLabel("Search settings");
  const title = screen.getByTestId("settings-page-title");
  const session = await hui.createSession({ title: "Scheduled" });
  const { task } = await hui.api<{ task: { id: string } }>("POST", "/__hui/automation/tasks", {
    name: "Nightly check", sessionId: session.id, prompt: "Check", schedule: { kind: "every", everyMs: 3_600_000 }, enabled: false,
  });

  await hui.open("/settings/appearance");
  await search.fill("diag");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(title).toHaveText("Appearance");

  await screen.getByRole("button", "Message width: Comfortable").tap();
  const widths = screen.getByRole("listbox", "Message width");
  await expect(widths).toBeVisible();
  await widths.press("Escape");
  await expect(widths).toBeHidden();
  await expect(title).toHaveText("Appearance");

  await hui.open("/settings/automation");
  await screen.getByRole("combobox", "Schedule").tap();
  const schedules = screen.getByRole("listbox", "Schedule");
  await expect(schedules).toBeVisible();
  await schedules.press("Escape");
  await expect(schedules).toBeHidden();
  await expect(title).toHaveText("Automation");
  await screen.getByRole("button", "Actions for Nightly check").tap();
  await expect(screen.getByRole("menuitem", "Edit")).toBeVisible();
  await screen.getByRole("menuitem", "Edit").press("Escape");
  await expect(screen.getByRole("menuitem", "Edit")).toBeHidden();
  await expect(title).toHaveText("Automation");
  await hui.api("DELETE", `/__hui/automation/tasks/${task.id}`);

  await search.press("Escape");
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  await expect(title).toBeHidden();

  await hui.phoneScreen();
  await hui.open("/settings/models");
  await screen.getByRole("button", "Open settings navigation").tap();
  await expect(screen.getByRole("button", { name: "Close settings navigation", expanded: true })).toBeVisible();
  await search.press("Escape");
  await expect(screen.getByRole("button", "Open settings navigation")).toBeFocused();
  await expect(title).toHaveText("Models");
  expect(await hui.url()).toMatch(/\/settings\/models$/u);
});
