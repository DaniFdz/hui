/** A session's own pull requests move its Kanban card: to Testing while any is open or draft, to Done once they are
 * merged, and never at all for a closed or unconfirmed one. They never move a card back, never override the operator's
 * placement, and the ones that existed at the last placement are old news (BOARD-010). The `github` fixture world's fake
 * `gh` answers the preview queries the stage is inferred from. */
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import type { World } from "../../fixtures/world.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/** A GraphQL pull request node the fake `gh` answers with, as `previews.json` holds them. */
const node = (number: number, title: string, patch: Record<string, unknown> = {}) => ({
  __typename: "PullRequest", number, title, state: "OPEN", isDraft: false, author: { login: "hui-e2e" },
  additions: 4, deletions: 1, changedFiles: 1, comments: { totalCount: 0 }, reviewThreads: { totalCount: 0 },
  body: `The description of ${title}.`, ...patch,
});

type Row = { id: string; stage?: string; stageOrigin?: string; pullRequests?: { url: string; state?: string }[] };

/** The session's stage and where it came from, as the board reads it. */
const placement = async (world: World, id: string) => {
  const rows = (await world.api<{ groups: { sessions: Row[] }[] }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  const found = rows.find((row) => row.id === id);
  return `${found?.stage} from ${found?.stageOrigin}`;
};

test("a session's open or draft pull request moves its card to Testing, merged ones to Done, closed or unconfirmed ones nowhere, and none of them move a card back, over a placement or past old news", { tags: ["BOARD-010"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  await writeFile(join(world.runDir, "gh", "previews.json"), JSON.stringify({
    "acme/web#14": node(14, "Draft the upgrade guide", { isDraft: true }),
    "acme/web#15": node(15, "Retire the old form", { state: "CLOSED" }),
  }));
  const pulled = (session: { id: string }, numbers: number[], repository = "acme/web") => world.prompt(session,
    call("bash", { command: ["echo gh pr create", ...numbers.map((number) => `echo https://github.com/${repository}/pull/${number}`)].join("; ") }));

  const open = await world.createSession({ title: "Open work" });
  await pulled(open, [12]);
  const draft = await world.createSession({ title: "Draft work" });
  await pulled(draft, [14]);
  const merged = await world.createSession({ title: "Merged work" });
  await pulled(merged, [13]);
  // Closed and unconfirmed pull requests are no evidence: the session's card must not leave Investigation.
  const quiet = await world.createSession({ title: "Quiet work" });
  await pulled(quiet, [15]);
  await pulled(quiet, [99], "acme/gone");

  // Your placement wins over a pull request that arrives after it.
  const placed = await world.createSession({ title: "Placed by hand" });
  await world.api("PATCH", `/__hui/sessions/${placed.id}`, { stage: "investigation" });
  await pulled(placed, [13]);
  // A card its agent already finished is never pulled back to Testing by a later pull request.
  const finished = await world.createSession({ title: "Finished before" });
  await world.prompt(finished, call("set_stage", { stage: "done" }));
  await pulled(finished, [12]);
  // A pull request that existed when the agent placed the card is old news: it cannot move the card again.
  const old = await world.createSession({ title: "Old news" });
  await pulled(old, [13]);
  await expect.poll(() => placement(world, old.id)).toBe("done from pullRequest");
  await world.prompt(old, call("set_stage", { stage: "investigation" }));

  await expect.poll(() => placement(world, open.id)).toBe("testing from pullRequest");
  await expect.poll(() => placement(world, draft.id)).toBe("testing from pullRequest");
  await expect.poll(() => placement(world, merged.id)).toBe("done from pullRequest");
  await expect.poll(() => placement(world, placed.id)).toBe("investigation from operator");
  await expect.poll(() => placement(world, finished.id)).toBe("done from agent");
  await expect.poll(() => placement(world, old.id)).toBe("investigation from agent");
  // The closed one was read and is still no evidence; the one GitHub never confirmed has no state at all.
  await expect.poll(async () => {
    const rows = (await world.api<{ groups: { sessions: Row[] }[] }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
    return rows.find((row) => row.id === quiet.id)?.pullRequests?.map((pullRequest) => pullRequest.state);
  }).toEqual(["closed", undefined]);
  expect(await placement(world, quiet.id)).toBe("investigation from default");

  await hui.open(`${world.url}/kanban`);
  const board = screen.getByLabel("Kanban board");
  const cell = (stage: string) => board.getByLabel(`${basename(join(world.runDir, "workspace"))}, ${stage}`);
  await expect(cell("Testing").getByText("Open work", { exact: true })).toBeVisible();
  await expect(cell("Testing").getByText("Draft work", { exact: true })).toBeVisible();
  await expect(cell("Done").getByText("Merged work", { exact: true })).toBeVisible();
  await expect(cell("Done").getByText("Finished before", { exact: true })).toBeVisible();
  for (const title of ["Quiet work", "Placed by hand", "Old news"]) {
    await expect(cell("Investigation").getByText(title, { exact: true })).toBeVisible();
  }
});
