/** A session card carries what its session needs: its status, its pull requests with their state breakdown, and its linked
 * Jira work item. Sort by Status, the default, runs Error, Waiting input, Done, Working and Idle, then a pinned card, then
 * the most recent; Sort by Last updated and Created order by that time instead (BOARD-002). The `github` fixture world
 * answers the pull request states, and the `jira` one the linked work item's key and status. */
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { World } from "../../fixtures/world.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;
const reply = (text: string) => `E2E_REPLY:${Buffer.from(text).toString("base64url")}`;
const hold = (name: string, input: unknown) => `E2E_HOLD:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/** A GraphQL pull request node the fake `gh` answers with, as `previews.json` holds them. */
const node = (number: number, title: string, patch: Record<string, unknown> = {}) => ({
  __typename: "PullRequest", number, title, state: "OPEN", isDraft: false, author: { login: "hui-e2e" },
  additions: 4, deletions: 1, changedFiles: 1, comments: { totalCount: 0 }, reviewThreads: { totalCount: 0 },
  body: `The description of ${title}.`, ...patch,
});

const question = { questions: [{ header: "Pick", question: "Which colour?", options: [{ label: "Red", description: "Warm." }, { label: "Blue", description: "Cool." }] }] };

type Row = { id: string; title: string; status: string; unread?: boolean };

/** One session of a world, by its title, as the board reads it. */
const rowOf = async (world: World, title: string) => {
  const rows = (await world.api<{ groups: { sessions: Row[] }[] }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  const found = rows.find((row) => row.title === title);
  if (!found) throw new Error(`the ${world.name} world lists no session named ${title}`);
  return found;
};

test("a card reads its status, its pull requests with their breakdown and its Jira item, and Sort by Status, Last updated or Created orders the cards", { tags: ["BOARD-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  // A card's status comes from the session itself, so the five states are driven on one board of this world.
  const world = await hui.world("jira");
  // The world's own seed sessions would sit in the same lane; they are archived out of the default view.
  const seeded = (await world.api<{ groups: { sessions: Row[] }[] }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  for (const session of seeded) await world.api("PATCH", `/__hui/sessions/${session.id}`, { archived: true });
  await writeFile(join(world.runDir, "workspace", "ask-board.json"), JSON.stringify(question));

  // Created oldest first, so Created and Last updated can disagree: the pin is the oldest card, and the newest update is
  // a session created before the others were prompted.
  const pinned = await world.createSession({ title: "Idle pinned" });
  await world.createSession({ title: "Idle older" });
  const newest = await world.createSession({ title: "Idle newest" });
  const finished = await world.createSession({ title: "Finished card" });
  const working = await world.createSession({ title: "Working card" });
  const asking = await world.createSession({ title: "Asking card" });
  await world.createSession({ title: "Error card", model: "missing/model" });
  const keyed = await world.createSession({ title: "Keyed card" });
  await world.api("PATCH", `/__hui/sessions/${pinned.id}`, { pinned: true });
  await world.api("PATCH", `/__hui/sessions/${keyed.id}`, { stage: "implementation" });
  await world.api("POST", `/__hui/sessions/${keyed.id}/jira/link`, { key: "CI-1" });

  await world.prompt(finished, reply("Finished."));
  await world.prompt(working, hold("fixture_echo", { text: "held" }));
  await world.prompt(asking, "E2E_ASK_USER:board");
  await world.prompt(newest, reply("Read again."));
  // A finished run is Done until it is read; opening it clears the mark, which leaves the card Idle.
  await hui.open(`${world.url}/sessions/${newest.id}`);
  await expect.poll(async () => (await rowOf(world, "Idle newest")).unread).toBe(undefined);
  await expect.poll(async () => (await rowOf(world, "Asking card")).status).toBe("waiting");
  await expect.poll(async () => (await rowOf(world, "Working card")).status).toBe("running");
  await expect.poll(async () => (await rowOf(world, "Error card")).status).toBe("error");

  await hui.open(`${world.url}/kanban`);
  const board = screen.getByLabel("Kanban board");
  const workspace = basename(join(world.runDir, "workspace"));
  const lane = (stage: string) => board.getByLabel(`${workspace}, ${stage}`);
  const card = (title: string) => board.getByRole("listitem").filter({ hasText: title });
  const titles = ["Idle pinned", "Idle older", "Idle newest", "Finished card", "Working card", "Asking card", "Error card"];
  const order = async () => (await lane("Investigation").getByRole("listitem").allTextContents())
    .map((text) => titles.find((title) => text.trim().startsWith(title)) ?? text.trim());

  // Each card's own status label, in the column its session sits in.
  await expect(card("Error card").getByRole("link", { name: "Error card, Error, Investigation" })).toBeVisible();
  await expect(card("Asking card").getByRole("link", { name: "Asking card, Waiting input, Investigation" })).toBeVisible();
  await expect(card("Finished card").getByRole("link", { name: "Finished card, Done, Investigation" })).toBeVisible();
  await expect(card("Working card").getByRole("link", { name: "Working card, Working, Investigation" })).toBeVisible();
  await expect(card("Idle older").getByRole("link", { name: "Idle older, Idle, Investigation" })).toBeVisible();
  // The linked work item's key and the status Jira answers with.
  const jira = lane("Implementation").getByRole("link", { name: "Jira CI-1, in progress: Pipeline reliability" });
  await expect(jira).toBeVisible();
  await expect(jira.getByText("CI-1")).toBeVisible();
  await expect(jira.getByText("In Progress")).toBeVisible();

  // Sort by Status, the default: what needs attention first, then the pinned card, then the most recently updated.
  await expect.poll(order).toEqual(["Error card", "Asking card", "Finished card", "Working card", "Idle pinned", "Idle newest", "Idle older"]);

  const sortBy = async (choice: string) => {
    await screen.getByRole("button", "Board options").tap();
    await screen.getByLabel("Board options").first().getByText(choice, { visible: true }).tap();
  };
  // Last updated keeps the pin first and then follows the clock, which puts the session prompted last above the one
  // created last.
  await sortBy("Last updated");
  await expect.poll(order).toEqual(["Idle pinned", "Idle newest", "Asking card", "Working card", "Finished card", "Error card", "Idle older"]);
  // Created keeps the pin first and then follows the creation order instead.
  await sortBy("Created");
  await expect.poll(order).toEqual(["Idle pinned", "Error card", "Asking card", "Working card", "Finished card", "Idle newest", "Idle older"]);

  // A card's pull requests carry their count and the states behind it, from the world whose fake gh answers them.
  const github = await hui.world("github");
  await writeFile(join(github.runDir, "gh", "previews.json"), JSON.stringify({
    "acme/web#12": node(12, "Ship the checkout"),
    "acme/web#13": node(13, "Retire the old form", { state: "MERGED" }),
  }));
  const pulled = await github.createSession({ title: "Pulled card" });
  await github.prompt(pulled, call("bash", { command: "echo gh pr create; echo https://github.com/acme/web/pull/12; echo https://github.com/acme/web/pull/13" }));
  await expect.poll(async () => {
    const rows = (await github.api<{ groups: { sessions: { id: string; pullRequests?: { state?: string }[] }[] }[] }>("GET", "/__hui/sessions"))
      .groups.flatMap((group) => group.sessions);
    return rows.find((row) => row.id === pulled.id)?.pullRequests?.map((pullRequest) => pullRequest.state);
  }).toEqual(["open", "merged"]);

  await hui.open(`${github.url}/kanban`);
  const other = screen.getByLabel("Kanban board").getByRole("listitem").filter({ hasText: "Pulled card" });
  await expect(other.getByText("2 PRs · 1 open, 1 merged")).toBeVisible();
});
