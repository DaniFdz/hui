/** Hovering a Jira mark opens its preview card: the key and type, the status pill, the summary and the description as
 * Markdown that scrolls while the card stays open, the other linked items, and the note an item Jira could not read shows
 * (BOARD-034). The `jira` fixture world's site answers CI-1 as "Epic" / "In Progress" with a long Markdown description,
 * and knows nothing about the key the unreadable case names. */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

type Listed = { groups: { sessions: { id: string; title: string }[] }[] };

/** A session the world seeded, by its title. */
const sessionNamed = async (world: Awaited<ReturnType<Hui["world"]>>, title: string) => {
  const sessions = (await world.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  const found = sessions.find((session) => session.title === title);
  if (!found) throw new Error(`the ${world.name} world seeded no session named ${title}`);
  return found;
};

test("a Jira mark's hover card names the work item, its status, summary and Markdown description that scrolls, its other links, and the note for an item Jira could not read", { tags: ["BOARD-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("jira");
  const docs = await sessionNamed(world, "Docs cleanup");
  // Two linked items: the newest owns the mark, and the card lists the other one.
  await world.api("POST", `/__hui/sessions/${docs.id}/jira/link`, { key: "CI-2" });
  await world.api("POST", `/__hui/sessions/${docs.id}/jira/link`, { key: "CI-1" });
  // A work item this site cannot answer for: the session reports a key the connected Jira does not have.
  const unreadable = await world.createSession({ title: "Unreadable item" });
  await world.prompt(unreadable, call("bash", { command: "jira issue create -s'Missing' || echo https://acme.atlassian.net/browse/CI-999" }));

  await hui.open(`${world.url}/`);
  const row = screen.getByRole("link", { name: /^Docs cleanup, status idle, tool \w+, stage investigation, Jira CI-1, in progress: Pipeline reliability, 1 more linked$/u });
  await expect(row).toBeVisible();
  await expect(screen.getByRole("link", { name: /^Unreadable item, status .*Jira CI-999, status unavailable$/u })).toBeVisible();

  await hui.peek(row.getByTestId("jira-mark"));
  const card = screen.getByRole("tooltip");
  await expect(card.getByText("CI-1 · Epic")).toBeVisible();
  await expect(card.getByText("In Progress")).toBeVisible();
  await expect(card.getByText("Pipeline reliability")).toBeVisible();
  // The description is Markdown, not its source: the fixture's ADF headings and bullets are real elements.
  await expect(card.getByRole("heading", { name: "Goal" })).toBeVisible();
  const workstreams = card.getByRole("heading", { name: "Workstreams" });
  await expect(workstreams).toBeVisible();
  await expect(card.getByRole("listitem").filter({ hasText: "Retry wrappers surface the first failure" })).toBeVisible();
  await expect(card.getByText("Also linked: CI-2")).toBeVisible();

  // The description scrolls under the pointer, and scrolling it leaves the card open on the same work item.
  const resting = (await workstreams.boundingBox())!.y;
  await hui.wheel(card.getByRole("heading", { name: "Goal" }), 240);
  await expect.poll(async () => (await workstreams.boundingBox())!.y).toBeLessThan(resting);
  await expect(card.getByText("CI-1 · Epic")).toBeVisible();

  // A card mark previews the same way, and an item Jira cannot read says how to reach it instead of showing nothing.
  await hui.open(`${world.url}/kanban`);
  const board = screen.getByLabel("Kanban board");
  await hui.peek(board.getByRole("listitem").filter({ hasText: "Unreadable item" }).getByTestId("jira-mark"));
  const unread = screen.getByRole("tooltip");
  await expect(unread.getByText(/^CI-999$/u)).toBeVisible();
  await expect(unread.getByText("Jira details are unavailable. Open the work item to view it.")).toBeVisible();
});
