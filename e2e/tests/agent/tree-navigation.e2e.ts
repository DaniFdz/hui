/** The open conversation alone expands its ancestor path; manual disclosures never navigate, and a card opens its
 * child's transcript with that same highlighted path (AGENT-030). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { expectChatTitle } from "../sess/chat-header.ts";
import { openHelpers } from "./run-status.ts";

test("a tree follows the open session from an address or a card, while disclosures leave the chat alone", { tags: ["AGENT-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  const parent = await hui.createSession({ title: "Tree root" });
  const child = await hui.createSubagent(parent);
  await hui.api("PATCH", `/__hui/sessions/${child.id}`, { title: "Tree child" });
  const grandchild = await hui.createSubagent(child);
  await hui.api("PATCH", `/__hui/sessions/${grandchild.id}`, { title: "Tree leaf" });
  const other = await hui.createSession({ title: "Outside this tree" });
  const rows = screen.getByTestId("session-row");
  const row = (title: string) => rows.filter({ hasText: title });
  const link = (title: string) => row(title).getByRole("link", { name: new RegExp(`^${title}, status `, "u") });
  const expand = (title: string) => screen.getByRole("button", `Expand subagents of ${title}`);
  const collapse = (title: string) => screen.getByRole("button", `Collapse subagents of ${title}`);
  const address = (id: string) => new RegExp(`/sessions/${id}$`, "u");

  // No chat is open: only the root is visible.
  await hui.open("/");
  await hui.sessionList();
  await expect(row("Tree root")).toBeVisible();
  await expect(expand("Tree root")).toBeVisible();
  await expect(row("Tree child")).toBeHidden();
  await expect(row("Tree leaf")).toBeHidden();

  // A deep address shows the whole ancestor path and marks only its own row.
  await hui.open(`/sessions/${grandchild.id}`);
  await expectChatTitle(screen, "Tree leaf");
  await hui.sessionList();
  await expect(row("Tree root")).toHaveAttribute("data-session-depth", "0");
  await expect(row("Tree child")).toHaveAttribute("data-session-depth", "1");
  await expect(row("Tree leaf")).toHaveAttribute("data-session-depth", "2");
  await expect(link("Tree leaf")).toHaveAttribute("aria-current", "true");
  await expect(link("Tree root")).toHaveAttribute("aria-current", "false");
  await expect(link("Tree child")).toHaveAttribute("aria-current", "false");

  // Opening the root is not a request to expand it.
  await link("Tree root").tap();
  await expectChatTitle(screen, "Tree root");
  await hui.sessionList();
  await expect(link("Tree root")).toHaveAttribute("aria-current", "true");
  await expect(expand("Tree root")).toBeVisible();
  await expect(row("Tree child")).toBeHidden();

  // Disclosures expand and fold whole subtrees without changing the selected chat or its address.
  await expand("Tree root").tap();
  await expect(row("Tree child")).toBeVisible();
  await expect(row("Tree leaf")).toBeHidden();
  await expand("Tree child").tap();
  await expect(row("Tree leaf")).toBeVisible();
  await collapse("Tree root").tap();
  await expect(row("Tree child")).toBeHidden();
  await expect(row("Tree leaf")).toBeHidden();
  await expect(link("Tree root")).toHaveAttribute("aria-current", "true");
  expect(await hui.url()).toMatch(address(parent.id));

  // Another chat clears the manual expansion rather than leaving an unrelated tree open.
  await hui.open(`/sessions/${other.id}`);
  await expectChatTitle(screen, "Outside this tree");
  await hui.sessionList();
  await expect(expand("Tree root")).toBeVisible();
  await expect(row("Tree child")).toBeHidden();
  await expect(link("Outside this tree")).toHaveAttribute("aria-current", "true");

  // The parent's actual card opens the child, not a sidebar-only substitute for the card's navigation.
  await hui.open(`/sessions/${parent.id}`);
  const helpers = await openHelpers(screen);
  const open = helpers.getByRole("button", { name: /^Open subagent /u });
  if (await open.count() === 0) await helpers.getByText("1 completed", { exact: true }).tap();
  await expect(open).toHaveCount(1);
  await expect(open).toBeVisible();
  await open.tap();
  await expectChatTitle(screen, "Tree child");
  expect(await hui.url()).toMatch(address(child.id));
  await expect(screen.getByTestId("transcript").getByText("E2E_SUBAGENT_CHILD", { exact: true })).toBeVisible();
  await hui.sessionList();
  await expect(link("Tree child")).toHaveAttribute("aria-current", "true");
  await expect(collapse("Tree root")).toBeVisible();
  await expect(row("Tree leaf")).toBeHidden();
});
