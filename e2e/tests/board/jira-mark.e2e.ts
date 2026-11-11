/** A linked session shows a Jira mark in its row's leading status column, coloured by the work item's status category, its
 * row's accessible name ends with the work item's key, status and summary (and how many more are linked), and the mark
 * opens the work item in a new tab without opening the session (BOARD-033). The `jira` fixture world is a gateway whose
 * connected Jira answers CI-1 as "In Progress" (status category `indeterminate`, the mark's blue) with the summary
 * "Pipeline reliability". */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Listed = { groups: { sessions: { id: string; title: string }[] }[] };

/** A session the world seeded, by its title. */
const sessionNamed = async (world: Awaited<ReturnType<Hui["world"]>>, title: string) => {
  const sessions = (await world.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  const found = sessions.find((session) => session.title === title);
  if (!found) throw new Error(`the ${world.name} world seeded no session named ${title}`);
  return found;
};

test("a linked session's Jira mark takes its status category's colour, its row name ends with the work item, and the mark opens Jira without opening the session", { tags: ["BOARD-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("jira");
  const docs = await sessionNamed(world, "Docs cleanup");
  const flaky = await sessionNamed(world, "Flaky CI retries");
  await world.api("POST", `/__hui/sessions/${docs.id}/jira/link`, { key: "CI-1" });
  // Two linked items: the newest owns the mark, and the row's name says how many more there are.
  await world.api("POST", `/__hui/sessions/${flaky.id}/jira/link`, { key: "CI-2" });
  await world.api("POST", `/__hui/sessions/${flaky.id}/jira/link`, { key: "CI-1" });

  await hui.open(`${world.url}/`);
  const single = screen.getByRole("link", { name: /^Docs cleanup, status idle, tool \w+, stage investigation, Jira CI-1, in progress: Pipeline reliability$/u });
  const linked = screen.getByRole("link", { name: /^Flaky CI retries, status idle, tool \w+, stage investigation, Jira CI-1, in progress: Pipeline reliability, 1 more linked$/u });
  await expect(single).toBeVisible();
  await expect(linked).toBeVisible();

  // The mark is the element inside the row's own link that stands in the leading status column, and it carries the
  // status category's blue rather than the muted colour a mark without a readable status falls back to.
  const mark = single.getByTestId("jira-mark");
  await expect(mark).toBeVisible();
  expect((await hui.look(mark)).color).toEqual([0, 101, 255]);
  await expect(linked.getByTestId("jira-mark")).toBeVisible();

  const here = await hui.url();
  await mark.tap();
  const tab = await hui.tab();
  expect(tab?.via).toBe("window.open");
  expect(tab?.url).toBe(`${world.jiraUrl}/browse/CI-1`);
  expect(tab?.noopener).toBe(true);
  // The press opens the work item elsewhere and leaves the row's session unopened.
  expect(await hui.url()).toBe(here);
});
