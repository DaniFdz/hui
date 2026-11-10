/** Link Jira work item… opens a search that lists the Recently viewed items and finds a work item by key, pasted URL or summary words, and the chosen one is linked to the session, whose row then carries it (BOARD-036). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Link Jira work item… lists the recently viewed items, finds one by key, pasted URL or summary words and says so when nothing matches, and choosing one links it and moves the row's mark", { tags: ["BOARD-036"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("jira");
  await hui.open(`${world.url}/`);
  await hui.sessionList();

  const options = async () => {
    const row = await hui.sessionMenu("Docs cleanup");
    await row.getByText("Link Jira work item…", { visible: true }).tap();
    return screen.getByRole("dialog", { name: "Link Jira work item" });
  };
  const dialog = await options();
  await expect(dialog.getByText("To “Docs cleanup”.")).toBeVisible();
  const search = dialog.getByRole("combobox", { name: "Search Jira work items" });
  await expect(search).toHaveAttribute("placeholder", "Key, URL or summary text");
  const option = (key: string) => dialog.getByRole("option").filter({ hasText: key });

  // An empty search is what the operator looked at last, newest first.
  await expect(dialog.getByText("Recently viewed")).toBeVisible();
  await expect(option("CI-1")).toBeVisible();
  await expect(option("CI-2")).toBeVisible();

  // A key, a pasted /browse/ URL and words from the summary all find their item.
  await search.fill("CI-2");
  await expect(dialog.getByText("Results")).toBeVisible();
  await expect(option("CI-2")).toBeVisible();
  await expect(option("CI-1")).toBeHidden();
  await search.fill(`${world.jiraUrl}/browse/CI-1`);
  await expect(option("CI-1")).toBeVisible();
  await search.fill("on-call");
  await expect(option("OPS-1")).toBeVisible();
  await expect(option("CI-1")).toBeHidden();

  // A search that finds nothing says what to try instead.
  await search.fill("zzz-nothing-matches");
  await expect(dialog.getByText("No matching work items. Try a key such as CI-123 or paste its URL.")).toBeVisible();
  await expect(dialog.getByRole("option")).toHaveCount(0);

  await search.fill("tooling");
  await option("CI-2").tap();
  await expect(dialog).toBeHidden();
  await expect(screen.getByText("Linked Jira work item CI-2.")).toBeVisible();
  // The row carries the item it was linked to, with its status and summary.
  await expect(screen.getByRole("link", { name: /Jira CI-2, to do: Developer tooling polish$/u })).toBeVisible();
});
