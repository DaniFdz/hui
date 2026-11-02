/** Arrow keys move between Work tabs, Alt+Shift+Arrow reorders and Delete closes the focused tab (WORK-005). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("arrow keys move between Work tabs, Alt+Shift+Arrow reorders and Delete closes one", { tags: ["WORK-005"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Tab keys" });
  const pane = screen.getByLabel("Work pane");
  const menu = screen.getByRole("button", "Open Work view");
  const key = (value: string) => new RegExp(`(?:⌥⇧⌘|Ctrl\\+Alt\\+Shift\\+|Alt\\+Shift\\+Ctrl\\+)${value}`, "u");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await pane.getByRole("button", { name: /^New terminal/u }).tap();
  await menu.tap();
  await screen.getByText(key("F")).first().tap();
  await menu.tap();
  await screen.getByText(key("B")).first().tap();
  const tabs = pane.getByRole("tab");
  await expect(tabs).toHaveCount(3);

  const terminal = pane.getByRole("tab", "Terminal 1");
  await terminal.tap();
  await expect(terminal).toHaveAttribute("aria-selected", "true");
  await terminal.press("ArrowRight");
  await expect(pane.getByRole("tab", "Files")).toHaveAttribute("aria-selected", "true");
  await pane.getByRole("tab", "Files").press("End");
  await expect(pane.getByRole("tab", "Browser")).toHaveAttribute("aria-selected", "true");
  await pane.getByRole("tab", "Browser").press("Home");
  await expect(terminal).toHaveAttribute("aria-selected", "true");

  await terminal.press("Alt+Shift+ArrowRight");
  await expect(screen.getByText(/moved to position 2 of 3\./u)).toBeVisible();
  await terminal.press("Delete");
  await expect(tabs).toHaveCount(2);
});
