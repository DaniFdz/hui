/** Session actions, Group options and Filter & sort move with the arrow keys, Home and End and choose with Enter, Escape closes them back to their trigger, and Escape cancels the delete dialog back to the control that opened it (SESS-041). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the session, group and sort menus move with the arrow keys, Home, End and Enter and close on Escape back to their trigger, and Escape cancels the delete dialog", { tags: ["SESS-041"], platforms: ["web"] }, async ({ screen, hui }) => {
  const actions = screen.getByRole("button", "Actions for Keyboard session");
  const group = screen.getByRole("button", "Group options for Atlas");
  const sort = screen.getByRole("button", "Filter & sort");
  const item = screen.getByRole("menuitem");
  const choice = screen.getByRole("menuitemcheckbox");
  const press = async (key: string) => {
    await hui.keyboard.down(key);
    await hui.keyboard.up(key);
  };
  const focused = async (target: Locator) => {
    await target.focus();
    await expect(target).toBeFocused();
  };

  await hui.createSession({ title: "Keyboard session", group: "Atlas" });
  await hui.open("/");

  await actions.press("Enter");
  await focused(item.filter({ hasText: "Pin session" }));
  await press("End");
  await expect(item.filter({ hasText: "Delete…" })).toBeFocused();
  await press("Home");
  await expect(item.filter({ hasText: "Pin session" })).toBeFocused();
  await press("ArrowDown");
  await expect(item.filter({ hasText: "Rename…" })).toBeFocused();
  await press("Enter");
  await expect(screen.getByLabel("Session name")).toBeVisible();
  await screen.getByLabel("Session name").press("Escape");
  await expect(screen.getByLabel("Session name")).toBeHidden();
  await actions.press("Enter");
  await focused(item.filter({ hasText: "Pin session" }));
  await press("Escape");
  await expect(item.filter({ hasText: "Pin session" })).toBeHidden();
  await expect(actions).toBeFocused();

  await group.press("Enter");
  await focused(item.filter({ hasText: "New session defaults" }));
  await press("End");
  await expect(item.filter({ hasText: "Delete group" })).toBeFocused();
  await press("Home");
  await expect(item.filter({ hasText: "New session defaults" })).toBeFocused();
  await press("ArrowDown");
  await expect(item.filter({ hasText: "Rename group" })).toBeFocused();
  await press("Enter");
  await expect(screen.getByText("Rename group “ATLAS”")).toBeVisible();
  await expect(screen.getByLabel("Group name")).toHaveValue("Atlas");
  await press("Escape");
  await expect(screen.getByText("Rename group “ATLAS”")).toBeHidden();
  await group.press("Enter");
  await focused(item.filter({ hasText: "New session defaults" }));
  await press("Escape");
  await expect(item.filter({ hasText: "New session defaults" })).toBeHidden();
  await expect(group).toBeFocused();

  await sort.press("Enter");
  await focused(choice.filter({ hasText: "Custom groups" }));
  await press("End");
  await expect(choice.filter({ hasText: "Never" })).toBeFocused();
  await press("Home");
  await expect(choice.filter({ hasText: "Custom groups" })).toBeFocused();
  await press("ArrowDown");
  await press("ArrowDown");
  await expect(choice.filter({ hasText: "None" })).toBeFocused();
  await press("Enter");
  await expect(screen.getByText("ATLAS", { exact: true, visible: true })).toBeHidden();
  await sort.press("Enter");
  await focused(choice.filter({ hasText: "Custom groups" }));
  await press("Escape");
  await expect(choice.filter({ hasText: "Custom groups" })).toBeHidden();
  await expect(sort).toBeFocused();

  await actions.press("Enter");
  await focused(item.filter({ hasText: "Pin session" }));
  await press("End");
  await press("Enter");
  await expect(screen.getByText("Remove Keyboard session from HUI?")).toBeVisible();
  await press("Escape");
  await expect(screen.getByText("Remove Keyboard session from HUI?")).toBeHidden();
  await expect(actions).toBeFocused();
  await expect(screen.getByRole("button", "Actions for Keyboard session")).toBeVisible();
});
