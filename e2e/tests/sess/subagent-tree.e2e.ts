/** Subagent sessions nest under their parent in the sidebar: the open session's ancestors alone are expanded, the whole
 * subtree folds and unfolds without changing the open session or the address, a nested child keeps its own fold when its
 * parent reopens, a search or status filter reveals folded children and clearing it restores the folds, the phone's
 * drawer stays open while folding, folds last for the page, and a child's header offers Open parent (SESS-046). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a subagent tree nests under its parent, folds without moving the open session, keeps a nested fold, shows folded children under a filter and in the phone drawer, and offers Open parent in a child's header", { tags: ["SESS-046"] }, async ({ screen, hui }) => {
  const rows = screen.getByTestId("session-row");
  const row = (title: string) => rows.filter({ hasText: title });
  const link = (title: string) => row(title).getByRole("link", { name: new RegExp(`^${title}, status `, "u") });
  const heading = screen.getByTestId("session-title", { visible: true });
  const search = screen.getByPlaceholder("Search sessions");
  const closeDrawer = screen.getByRole("button", "Close navigation", { visible: true }).first();
  const parent = await hui.createSession({ title: "Tree parent" });
  const child = await hui.createSubagent(parent);
  // The fixture's spawned children share one label, so each gets a name of its own to tell the depths apart.
  await hui.api("PATCH", `/__hui/sessions/${child.id}`, { title: "Inner helper" });
  const grandchild = await hui.createSubagent({ id: child.id });
  await hui.api("PATCH", `/__hui/sessions/${grandchild.id}`, { title: "Grand helper" });
  await hui.createSession({ title: "Elsewhere" });

  // The open session's ancestors alone are expanded: opening the grandchild shows the chain, indented by depth.
  await hui.open(`/sessions/${grandchild.id}`);
  await hui.sessionList();
  await expect(row("Tree parent")).toHaveAttribute("data-session-depth", "0");
  await expect(row("Inner helper")).toHaveAttribute("data-session-depth", "1");
  await expect(row("Grand helper")).toHaveAttribute("data-session-depth", "2");
  const left = async (title: string) => (await link(title).boundingBox())!.x;
  expect(await left("Inner helper")).toBeGreaterThan(await left("Tree parent"));
  expect(await left("Grand helper")).toBeGreaterThan(await left("Inner helper"));
  // A finished subagent's row carries how long it ran.
  await expect(row("Inner helper")).toContainText(/\d+(?:h \d+m|m \d+s|[hms])/u);

  // Opening a session outside the tree folds the whole tree away, and opening the parent expands no child by default.
  await hui.open(`/sessions/${(await hui.api<{ groups: { sessions: { id: string; title: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap(({ sessions }) => sessions).find(({ title }) => title === "Elsewhere")!.id}`);
  await hui.sessionList();
  await expect(row("Tree parent")).toBeVisible();
  await expect(row("Inner helper")).toBeHidden();
  await hui.open(`/sessions/${parent.id}`);
  await hui.sessionList();
  await expect(heading).toHaveText("Tree parent");
  await expect(screen.getByRole("button", "Expand subagents of Tree parent")).toBeVisible();
  await expect(row("Inner helper")).toBeHidden();

  // Expanding the parent leaves the nested child's own fold alone, and both toggles stay on the same session and address.
  const address = new URL(await hui.url()).pathname;
  await screen.getByRole("button", "Expand subagents of Tree parent").tap();
  await expect(row("Inner helper")).toBeVisible();
  await expect(row("Grand helper")).toBeHidden();
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(address);
  await screen.getByRole("button", "Collapse subagents of Tree parent").tap();
  await expect(row("Inner helper")).toBeHidden();
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(address);
  await expect(heading).toHaveText("Tree parent");

  // A search or a status filter reveals the folded child, and clearing it restores the fold.
  await search.fill("Grand helper");
  await expect(row("Grand helper")).toBeVisible();
  await search.fill("");
  await expect(row("Grand helper")).toBeHidden();
  await screen.getByRole("button", "Filter & sort").tap();
  await screen.getByRole("menuitemcheckbox", "Idle").tap();
  await expect(row("Grand helper")).toBeVisible();
  await screen.getByRole("button", "Filter & sort").tap();
  await screen.getByRole("menuitemcheckbox", "All").tap();
  await expect(row("Grand helper")).toBeHidden();

  // A nested child keeps its own fold: fold it, leave the tree and come back to the parent that holds it.
  await screen.getByRole("button", "Expand subagents of Tree parent").tap();
  await screen.getByRole("button", "Expand subagents of Inner helper").tap();
  await expect(row("Grand helper")).toBeVisible();
  await screen.getByRole("button", "Collapse subagents of Inner helper").tap();
  await expect(row("Grand helper")).toBeHidden();
  await hui.open("/");
  await hui.open(`/sessions/${parent.id}`);
  await hui.sessionList();
  await screen.getByRole("button", "Expand subagents of Tree parent").tap();
  await expect(row("Inner helper")).toBeVisible();
  await expect(row("Grand helper")).toBeHidden();

  // A child's header offers the way back up.
  await link("Inner helper").tap();
  await expect(heading).toHaveText("Inner helper");
  await expect(screen.getByRole("button", "Open parent")).toBeVisible();
  await screen.getByRole("button", "Open parent").tap();
  await expect(heading).toHaveText("Tree parent");

  // In the phone's drawer a fold leaves the drawer open, and the folds last for the page only.
  await hui.phoneScreen();
  await hui.sessionList();
  await expect(closeDrawer).toBeVisible();
  await screen.getByRole("button", "Expand subagents of Tree parent").tap();
  await expect(row("Inner helper")).toBeVisible();
  await expect(closeDrawer).toBeVisible();
  await hui.reload();
  await hui.sessionList();
  await expect(row("Tree parent")).toBeVisible();
  await expect(row("Inner helper")).toBeHidden();
});
