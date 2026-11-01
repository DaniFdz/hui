/** GitHub chat cards: what the gateway reports about a pull request, issue or repository link in the latest messages
 * becomes a card after the text, at most three in reading order, and one that cannot be previewed keeps its link and
 * says why (RICH-029, RICH-030, RICH-032). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const say = (markdown: string) => `E2E_REPLY:${Buffer.from(markdown).toString("base64url")}`;
const answer = (previews: unknown[]) => JSON.stringify({ previews });
const PREVIEWS = /\/__hui\/github\/previews/u;

async function reply(screen: Screen, hui: Hui, markdown: string) {
  const session = await hui.createSession({ title: "GitHub cards" });
  await hui.prompt(session, say(markdown));
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByRole("button", "Copy response")).toBeVisible();
  return transcript;
}

const PULL = "https://github.com/acme/web/pull/12";
const ISSUE = "https://github.com/acme/web/issues/7";
const REPO = "https://github.com/acme/api";
const MERGED = "https://github.com/acme/web/pull/13";
const CLOSED = "https://github.com/acme/web/pull/14";

const pull = {
  kind: "pull", url: PULL, repository: "acme/web", number: 12, state: "open", title: "Speed up the parser", author: "acme-dev",
  additions: 128, deletions: 34, changedFiles: 5, comments: 2, body: "Read **the** [docs](https://example.com/docs) first.\n\n### Steps",
};
const issue = {
  kind: "issue", url: ISSUE, repository: "acme/web", number: 7, state: "closed", stateReason: "not_planned",
  title: "Crash on an empty file", author: "octo", labels: ["bug", "urgent"], comments: 3, body: "Steps to reproduce the crash.",
};
const repository = {
  kind: "repo", url: REPO, fullName: "acme/api", description: "The Acme HTTP API.", stars: 1234, forks: 56,
  language: "Go", private: false, archived: true,
};

test("A pull request or issue link in the latest reply becomes a card after the text with its facts and a link to GitHub, at most three in reading order and deduplicated", { tags: ["RICH-029"], platforms: ["web"] }, async ({ screen, hui }) => {
  const previews = await hui.intercept("GET", PREVIEWS);
  const transcript = await reply(screen, hui, [
    `Merge ${PULL} to fix ${ISSUE}, then again acme/web#12.`,
    "",
    `Also read ${REPO} and https://github.com/acme/cli.`,
    "",
    "Keep `https://github.com/acme/ignored/pull/1` quoted, and https://gitlab.com/acme/web/pull/2 is another host.",
  ].join("\n"));
  await previews.answer(answer([{ url: PULL, preview: pull }, { url: ISSUE, preview: issue }, { url: REPO, preview: repository }]));

  const list = transcript.getByLabel("GitHub links");
  const cards = list.getByRole("listitem");
  await expect(cards).toHaveCount(3);

  const pullCard = cards.nth(0);
  await expect(pullCard).toHaveAccessibleName("Pull request acme/web#12, open: Speed up the parser");
  for (const text of ["acme/web#12", "Open", "Speed up the parser", "Read the docs first.", "acme-dev", "+128", "−34", "5 files", "2 comments"]) {
    await expect(pullCard.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(pullCard).toHaveAttribute("href", PULL);
  await expect(pullCard).toHaveAttribute("target", "_blank");

  const issueCard = cards.nth(1);
  await expect(issueCard).toHaveAccessibleName("Issue acme/web#7, closed as not planned: Crash on an empty file");
  for (const text of ["acme/web#7", "Closed as not planned", "Crash on an empty file", "Steps to reproduce the crash.", "octo", "bug", "urgent", "3 comments"]) {
    await expect(issueCard.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(issueCard).toHaveAttribute("href", ISSUE);

  await expect(cards.nth(2)).toHaveAccessibleName("GitHub repository acme/api");
  await expect(list.getByText("acme/cli", { exact: true })).toHaveCount(0);
  await expect(transcript.getByText("https://github.com/acme/ignored/pull/1", { exact: true })).toBeVisible();
  await hui.expectLinkTo(transcript, "https://github.com/acme/cli", "https://github.com/acme/cli");

  const done = await hui.intercept("GET", PREVIEWS);
  const later = await reply(screen, hui, `Both ${MERGED} and ${CLOSED} are done.`);
  await done.answer(answer([
    { url: MERGED, preview: { kind: "pull", url: MERGED, repository: "acme/web", number: 13, state: "merged", title: "Land the reader", additions: 0, deletions: 0, changedFiles: 1, comments: 0 } },
    { url: CLOSED, preview: { kind: "pull", url: CLOSED, repository: "acme/web", number: 14, state: "closed", title: "Retire the old reader", additions: 0, deletions: 0, changedFiles: 1, comments: 0 } },
  ]));
  const laterCards = later.getByLabel("GitHub links").getByRole("listitem");
  await expect(laterCards).toHaveCount(2);
  await expect(laterCards.nth(0)).toHaveAccessibleName("Pull request acme/web#13, merged: Land the reader");
  await expect(laterCards.nth(0).getByText("Merged", { exact: true })).toBeVisible();
  await expect(laterCards.nth(1)).toHaveAccessibleName("Pull request acme/web#14, closed: Retire the old reader");
  await expect(laterCards.nth(1).getByText("Closed", { exact: true })).toBeVisible();
});

test("A repository link shows a card with its name, tags, description, language, stars and forks inside a user bubble on a phone, and opens the repository", { tags: ["RICH-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  const phone = await hui.phoneScreen();
  const previews = await hui.intercept("GET", PREVIEWS);
  const session = await hui.createSession({ title: "Repositories" });
  await hui.prompt(session, `Read ${REPO} and https://github.com/acme/cli before you start.`);
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await previews.answer(answer([
    { url: REPO, preview: { ...repository, private: true, archived: true } },
    { url: "https://github.com/acme/cli", preview: { kind: "repo", url: "https://github.com/acme/cli", fullName: "acme/cli", description: "The Acme command line.", stars: 987, forks: 4, language: "TypeScript", private: false, archived: false } },
  ]));
  const list = transcript.getByLabel("GitHub links");
  const cards = list.getByRole("listitem");
  await expect(cards).toHaveCount(2);

  const api = cards.nth(0);
  await expect(api).toHaveAccessibleName("GitHub repository acme/api");
  for (const text of ["acme/api", "Private", "Archived", "The Acme HTTP API.", "Go", "★ 1.2k"]) {
    await expect(api.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(api.getByLabel("56 forks")).toBeVisible();
  await expect(api).toHaveAttribute("href", REPO);
  await expect(api).toHaveAttribute("target", "_blank");

  const cli = cards.nth(1);
  await expect(cli).toHaveAccessibleName("GitHub repository acme/cli");
  await expect(cli.getByText("The Acme command line.", { exact: true })).toBeVisible();
  await expect(cli.getByText("TypeScript", { exact: true })).toBeVisible();
  await expect(cli.getByText("Private", { exact: true })).toHaveCount(0);
  await expect(cli.getByText("Archived", { exact: true })).toHaveCount(0);

  const said = transcript.getByText("Read https://github.com/acme/api and https://github.com/acme/cli before you start.", { exact: true });
  const [card, text] = [(await cli.boundingBox())!, (await said.boundingBox())!];
  expect(card.x).toBeGreaterThanOrEqual(text.x);
  expect(card.y).toBeGreaterThanOrEqual(text.y + text.height);
  expect(card.x + card.width).toBeLessThanOrEqual(phone.width);
  expect(await hui.overflowX()).toBe(0);
});

test("A card that cannot be previewed keeps its link to GitHub and says why", { tags: ["RICH-032"], platforms: ["web"] }, async ({ screen, hui }) => {
  const reasons = [
    ["https://github.com/acme/web/pull/12", "not_found", "GitHub acme/web#12", "Not found, or your GitHub account cannot see it."],
    ["https://github.com/acme/web/issues/7", "signed_out", "GitHub acme/web#7", "Connect GitHub in Settings → Integrations to preview it."],
    ["https://github.com/acme/api", "cli_missing", "GitHub acme/api", "GitHub CLI (gh) is required for previews."],
  ] as const;
  const previews = await hui.intercept("GET", PREVIEWS);
  const transcript = await reply(screen, hui, reasons.map(([url]) => url).join(" "));
  await previews.answer(answer(reasons.map(([url, error]) => ({ url, error }))));
  const cards = transcript.getByLabel("GitHub links").getByRole("listitem");
  await expect(cards).toHaveCount(3);
  for (const [index, [url, , name, why]] of reasons.entries()) {
    const card = cards.nth(index);
    await expect(card).toHaveAccessibleName(name);
    await expect(card.getByText(why, { exact: true })).toBeVisible();
    await expect(card).toHaveAttribute("href", url);
    await expect(card).toHaveAttribute("target", "_blank");
  }

  const last = await hui.intercept("GET", PREVIEWS);
  const other = await reply(screen, hui, "See https://github.com/acme/web/issues/8 for the rest.");
  await last.answer(answer([{ url: "https://github.com/acme/web/issues/8", error: "unavailable" }]));
  const alone = other.getByLabel("GitHub links").getByRole("listitem");
  await expect(alone).toHaveCount(1);
  await expect(alone).toHaveAccessibleName("GitHub acme/web#8");
  await expect(alone.getByText("GitHub preview unavailable.", { exact: true })).toBeVisible();
  await expect(alone).toHaveAttribute("href", "https://github.com/acme/web/issues/8");
});
