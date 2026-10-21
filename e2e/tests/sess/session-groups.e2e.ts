/** Session groups are created from the Sessions toolbar on desktop and phone, renamed, deleted, reordered and collapsed from their headers (SESS-023, SESS-024, SESS-025, SESS-026, SESS-027). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const groupMenu = async (screen: Screen, hui: Hui, label: string, item: string) => {
  await hui.peek(screen.getByRole("button", label.toLocaleUpperCase()));
  await screen.getByRole("button", `Group options for ${label}`).tap();
  await screen.getByText(item, { visible: true }).tap();
};

test("New group creates a group above OTHER even when filters hid every row, resets search and status but keeps the sort, and shows a rejected name", { tags: ["SESS-023"], platforms: ["web"] }, async ({ screen, hui }) => {
  const newGroup = screen.getByRole("button", "New group");
  const name = screen.getByLabel("Group name");
  const search = screen.getByPlaceholder("Search sessions");
  const rows = () => screen.getByLabel(/^(Alpha older|Zulu newer), status/u).allTextContents();
  const choose = async (choice: string) => {
    await screen.getByRole("button", "Filter & sort").tap();
    await screen.getByText(choice, { exact: true, visible: true }).tap();
  };
  await hui.createSession({ title: "Alpha older" });
  await hui.createSession({ title: "Zulu newer" });

  await hui.open("/");
  await expect.poll(rows).toEqual(["Zulu newer", "Alpha older"]);
  await choose("Name");
  await expect.poll(rows).toEqual(["Alpha older", "Zulu newer"]);
  await search.fill("Zulu");
  await expect.poll(rows).toEqual(["Zulu newer"]);
  await choose("Error");
  await expect(screen.getByText("No matching sessions.")).toBeVisible();

  await newGroup.tap();
  await expect(name).toBeFocused();
  await name.fill("Research Lab");
  await screen.getByRole("button", "Create group").tap();
  await expect(screen.getByRole("button", "RESEARCH LAB")).toBeVisible();
  await expect.poll(() => screen.getByRole("button", /^(RESEARCH LAB|OTHER)$/u).allTextContents()).toEqual(["RESEARCH LAB", "OTHER"]);
  await expect(newGroup).toBeFocused();
  await expect(search).toHaveValue("");
  await expect.poll(rows).toEqual(["Alpha older", "Zulu newer"]);

  await newGroup.tap();
  await name.fill("Research Lab");
  await screen.getByRole("button", "Create group").tap();
  await expect(screen.getByText("A group named \"Research Lab\" already exists.")).toBeVisible();
  await expect(name).toBeVisible();
  await screen.getByRole("button", "Cancel").tap();
  await expect(name).toBeHidden();
});

test("on a phone the drawer closes before the New group dialog opens and focus returns to Open navigation", { tags: ["SESS-023"], platforms: ["web"] }, async ({ screen, hui }) => {
  const navigation = screen.getByRole("button", "Open navigation");
  const name = screen.getByLabel("Group name");
  await hui.phoneScreen();
  await hui.open("/");
  await navigation.tap();
  await screen.getByRole("button", "New group").tap();
  await expect(name).toBeFocused();
  await expect(navigation).toBeVisible();
  await name.fill("Mobile Ideas");
  await screen.getByRole("button", "Create group").tap();
  await expect(name).toBeHidden();
  await expect(navigation).toBeFocused();
  await navigation.tap();
  await expect(screen.getByRole("button", "MOBILE IDEAS")).toBeVisible();
});

test("a renamed group keeps its casing and its rows, collapses across a reload, and deleting it returns its sessions to OTHER", { tags: ["SESS-024", "SESS-025", "SESS-027"], platforms: ["web"] }, async ({ screen, hui }) => {
  const alpha = screen.getByLabel(/^Alpha session, status/u);
  const beta = screen.getByLabel(/^Beta session, status/u);
  const outside = screen.getByLabel(/^Outside session, status/u);
  const name = screen.getByLabel("Group name");
  await hui.createSession({ title: "Alpha session", group: "Sprint 03" });
  await hui.createSession({ title: "Beta session", group: "Sprint 03" });
  await hui.createSession({ title: "Outside session" });

  await hui.open("/");
  await expect(alpha).toBeVisible();
  await groupMenu(screen, hui, "Sprint 03", "Rename group");
  await expect(name).toHaveValue("Sprint 03");
  await name.fill("Archive 03");
  await screen.getByRole("button", "Save").tap();
  await expect(screen.getByRole("button", "ARCHIVE 03")).toBeVisible();
  await expect(screen.getByRole("button", "SPRINT 03")).toBeHidden();

  const archive = screen.getByRole("button", "ARCHIVE 03");
  await archive.tap();
  await expect(outside).toBeVisible();
  await expect(alpha).toBeHidden();
  await expect(beta).toBeHidden();
  await hui.reload();
  await expect(outside).toBeVisible();
  await expect(alpha).toBeHidden();
  await archive.tap();
  await expect(alpha).toBeVisible();
  await expect(beta).toBeVisible();

  await groupMenu(screen, hui, "Archive 03", "Rename group");
  await expect(name).toHaveValue("Archive 03");
  await screen.getByRole("button", "Cancel").tap();
  await expect(name).toBeHidden();

  await groupMenu(screen, hui, "Archive 03", "Delete group");
  await expect(screen.getByText("The group is removed. Its sessions move back to OTHER.")).toBeVisible();
  await screen.getByRole("button", "Delete").tap();
  await expect(screen.getByText("The group is removed. Its sessions move back to OTHER.")).toBeHidden();
  await expect(archive).toBeHidden();
  const other = screen.getByRole("button", "OTHER");
  await expect(outside).toBeVisible();
  await other.tap();
  await expect(alpha).toBeHidden();
  await expect(beta).toBeHidden();
  await expect(outside).toBeHidden();
});

test("dragging headers or Move group up and down reorders custom groups across a reload, OTHER stays last, and a failed reorder keeps the order", { tags: ["SESS-026"], platforms: ["web"] }, async ({ screen, hui }) => {
  const order = () => screen.getByRole("button", /^(FIRST LANE|SECOND LANE|THIRD LANE|OTHER)$/u).allTextContents();
  const header = (label: string) => screen.getByRole("button", label);
  await hui.createSession({ title: "First lane row", group: "First lane" });
  await hui.createSession({ title: "Second lane row", group: "Second lane" });
  await hui.createSession({ title: "Third lane row", group: "Third lane" });
  await hui.createSession({ title: "Other row" });

  await hui.open("/");
  await expect.poll(order).toEqual(["FIRST LANE", "SECOND LANE", "THIRD LANE", "OTHER"]);
  await header("FIRST LANE").dragTo(screen.getByTestId("session-row").filter({ hasText: "Third lane row" }));
  await expect(screen.getByText("Moved FIRST LANE.")).toBeVisible();
  await expect.poll(order).toEqual(["SECOND LANE", "THIRD LANE", "FIRST LANE", "OTHER"]);

  await header("OTHER").dragTo(header("SECOND LANE"));
  await header("SECOND LANE").dragTo(header("OTHER"));
  await expect(screen.getByText("Moved SECOND LANE.")).toBeVisible();
  await expect.poll(order).toEqual(["THIRD LANE", "FIRST LANE", "SECOND LANE", "OTHER"]);

  await groupMenu(screen, hui, "Third lane", "Move group down");
  await expect(screen.getByText("Moved THIRD LANE.")).toBeVisible();
  await expect.poll(order).toEqual(["FIRST LANE", "THIRD LANE", "SECOND LANE", "OTHER"]);
  await groupMenu(screen, hui, "Third lane", "Move group up");
  await expect(screen.getByText("Moved THIRD LANE.")).toBeVisible();
  await expect.poll(order).toEqual(["THIRD LANE", "FIRST LANE", "SECOND LANE", "OTHER"]);

  const reorder = await hui.intercept("PUT", /\/__hui\/session-groups$/u);
  await groupMenu(screen, hui, "First lane", "Move group down");
  await reorder.reject(503, "The registry is read-only right now.");
  await expect(screen.getByText("The registry is read-only right now.")).toBeVisible();
  await expect.poll(order).toEqual(["THIRD LANE", "FIRST LANE", "SECOND LANE", "OTHER"]);

  await hui.reload();
  await expect(header("THIRD LANE")).toBeVisible();
  await expect.poll(order).toEqual(["THIRD LANE", "FIRST LANE", "SECOND LANE", "OTHER"]);
});
