/** Search transcripts takes two or more characters, lists the matching sessions newest first with their title, an Archived chip, their matching message count and a snippet, opens the one chosen, and reports no hit, a worker that could not be searched and a failed search (SESS-060). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Found = { hits: { id: string; snippet: string; matches: number }[]; unsearched: { worker: string; error: string }[] };

test("Search transcripts needs two characters, lists matching sessions newest first with their title, message count and snippet, and opens the one chosen", { tags: ["SESS-060"], platforms: ["web"] }, async ({ screen, hui }) => {
  const search = screen.getByPlaceholder("Search transcript messages…");
  const button = screen.getByRole("button", "Search");
  const results = () => screen.getByRole("button", /message/u);
  const shown = async () => (await results().allTextContents()).map((text) => /^(Bravo|Zulu) transcript/u.exec(text)?.[0]);
  const hits = async () => (await hui.api<Found>("GET", "/__hui/sessions/search?q=pineapple")).hits.map(({ id }) => id).sort();
  const zulu = await hui.createSession({ title: "Zulu transcript" });
  const bravo = await hui.createSession({ title: "Bravo transcript" });
  await hui.prompt(zulu, "pineapple in Zulu");
  await hui.prompt(bravo, "pineapple in Bravo");
  await expect.poll(hits).toEqual([zulu.id, bravo.id].sort());
  await hui.api("PATCH", `/__hui/sessions/${bravo.id}`, { archived: true });

  await hui.open("/sessions");
  await search.fill("p");
  await expect(button).toBeDisabled();
  await search.fill("pi");
  await expect(button).toBeEnabled();
  await search.fill("pineapple");
  await button.tap();
  await expect.poll(shown).toEqual(["Bravo transcript", "Zulu transcript"]);
  await expect.poll(async () => (await results().allTextContents())[0]).toMatch(/^Bravo transcript Archived 1 message/u);
  await expect.poll(async () => (await results().allTextContents())[1]).toMatch(/^Zulu transcript 1 message/u);
  await expect.poll(async () => (await results().allTextContents())[0]).toContain("pineapple in Bravo");
  await expect(screen.getByText("2 sessions mention “pineapple”")).toBeVisible();

  await screen.getByRole("button", /^Zulu transcript 1 message/u).tap();
  await expect.poll(() => hui.url()).toContain(`/sessions/${zulu.id}`);
});

test("Search transcripts says when nothing matches, names a worker it could not search with its reason, and shows a failed search", { tags: ["SESS-060"], platforms: ["web"] }, async ({ screen, hui }) => {
  const search = screen.getByPlaceholder("Search transcript messages…");
  const button = screen.getByRole("button", "Search");
  const session = await hui.createSession({ title: "Zulu quiet" });
  await hui.prompt(session, "quiet transcript");
  await expect.poll(async () => (await hui.api<Found>("GET", "/__hui/sessions/search?q=quiet")).hits.map(({ id }) => id)).toEqual([session.id]);

  await hui.open("/sessions");
  await search.fill("quince");
  await button.tap();
  await expect(screen.getByText("No transcript mentions “quince”.")).toBeVisible();

  const unsearched = await hui.intercept("GET", /\/__hui\/sessions\/search/u);
  await search.fill("quiet");
  await button.tap();
  await unsearched.arrived();
  await unsearched.answer(JSON.stringify({
    hits: [{ id: session.id, snippet: "quiet transcript", matches: 1 }],
    unsearched: [{ worker: "worker-two", error: "it is unreachable" }],
  }));
  await expect(screen.getByText("Could not search worker-two: it is unreachable")).toBeVisible();

  const failing = await hui.intercept("GET", /\/__hui\/sessions\/search/u);
  await button.tap();
  await failing.arrived();
  await failing.reject(503, "The transcript search is unavailable.");
  await expect(screen.getByText("The transcript search is unavailable.")).toBeVisible();
});