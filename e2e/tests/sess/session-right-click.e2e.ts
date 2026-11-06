/** Right-clicking a session row opens the same Actions menu as its ⋯ button without opening the session (SESS-077). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a right click on a session row opens its actions menu and runs it without opening the session", { tags: ["SESS-077"], platforms: ["web"] }, async ({ screen, hui }) => {
  const open = await hui.createSession({ title: "Open session" });
  await hui.createSession({ title: "Right-click session" });
  await hui.open(`/sessions/${open.id}`);

  const row = screen.getByTestId("session-row").filter({ hasText: "Right-click session" });
  const link = row.getByRole("link");
  await hui.contextMenu(link);
  await expect(row.getByRole("button", "Actions for Right-click session")).toHaveAttribute("aria-expanded", "true");
  await expect(row.getByText("Rename…", { exact: true, visible: true })).toBeVisible();
  await expect(row.getByText("Archive session", { exact: true, visible: true })).toBeVisible();
  await expect(link).toHaveAttribute("aria-current", "false");
  await expect.poll(hui.url).toContain(`/sessions/${open.id}`);

  await row.getByText("Mark as unread", { exact: true, visible: true }).tap();
  await expect.poll(() => hui.accentDot("Right-click session")).toBe(true);
});
