/** GitHub link previews in the chat, driven against the `github` fixture world, whose fake `gh` answers the preview
 * queries: an issue or pull request link (or `owner/repo#N`) becomes a card after the text with its state, title,
 * snippet, author, labels or diff, at most three per message in reading order and deduplicated, while links in code and
 * on other hosts get none; a repository link becomes a card with its name, tags, description, language, stars and forks
 * that fits a phone, inside a user bubble too; and an item only a second, inactive account can read still fills its card
 * without that account's token reaching the browser (RICH-029, RICH-030, RICH-033). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** A reply the fixture's provider answers with, byte for byte. */
const reply = (text: string) => `E2E_REPLY:${Buffer.from(text).toString("base64url")}`;

/** Removes the world's session once the assertions are done: a runtime still writing into the world's agent directory
 * while the fixture stops and removes that directory makes the world's own cleanup race it. */
const settle = async (world: { api<T>(method: string, path: string, body?: unknown): Promise<T> }, session: { id: string }) => {
  await world.api("DELETE", `/__hui/sessions/${session.id}`);
};

/** A card's own box, so a phone's screen can be checked against it. */
const edges = async (target: Locator) => {
  const { x, y, width, height } = (await target.boundingBox())!;
  return { left: x, right: x + width, top: y, bottom: y + height };
};

test("An issue and pull request link or shorthand becomes a card with its state, title, snippet and facts, at most three per message in reading order and deduplicated, while code and other hosts get none", { tags: ["RICH-029"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  const session = await world.createSession({ title: "Preview the work" });
  await world.prompt(session, reply([
    "Opened https://github.com/acme/web/pull/12 on top of acme/web#13. The bug was https://github.com/acme/web/issues/7.",
    "Repeated https://github.com/acme/web/pull/12 is the same card, `https://github.com/acme/web/pull/99` stays code, and https://github.com/acme/other is a fourth link that gets no card.",
  ].join("\n\n")));

  await hui.open(`${world.url}/sessions/${session.id}`);
  const links = screen.getByLabel("GitHub links");
  const opened = links.getByLabel("Pull request acme/web#12, open: Fixture pull request 12");
  await expect(opened).toBeVisible();

  // Three cards, in reading order: two pull requests and a closed issue.
  await expect(links.getByRole("listitem")).toHaveCount(3);
  await expect(links.getByRole("listitem").nth(0)).toHaveAttribute("aria-label", "Pull request acme/web#12, open: Fixture pull request 12");
  await expect(links.getByRole("listitem").nth(1)).toHaveAttribute("aria-label", "Pull request acme/web#13, merged: Ship the checkout redesign");
  await expect(links.getByRole("listitem").nth(2)).toHaveAttribute("aria-label", "Issue acme/web#7, closed: Checkout button overlaps footer on mobile");

  // A pull request card: its number, state, title, body snippet, author, diff and counts, opening GitHub in a new tab.
  await expect(opened).toHaveAttribute("href", "https://github.com/acme/web/pull/12");
  await expect(opened).toHaveAttribute("target", "_blank");
  await expect(opened.getByText("acme/web#12", { exact: true })).toBeVisible();
  await expect(opened.getByText("Open", { exact: true })).toBeVisible();
  await expect(opened.getByText("Fixture pull request 12", { exact: true })).toBeVisible();
  await expect(opened.getByText("Adds GitHub link previews to chat messages.", { exact: true })).toBeVisible();
  await expect(opened.getByText("hui-e2e", { exact: true })).toBeVisible();
  await expect(opened.getByText("+120 −34", { exact: true })).toBeVisible();
  await expect(opened.getByText("5 files", { exact: true })).toBeVisible();
  // The fixture's pull request carries two comments and one review thread, which the card counts together.
  await expect(opened.getByText("3 comments", { exact: true })).toBeVisible();
  await expect(links.getByLabel("Pull request acme/web#13, merged: Ship the checkout redesign").getByText("Merged", { exact: true })).toBeVisible();

  // An issue card: its state, title, snippet, author, labels and comments, and the issue's own GitHub address.
  const issue = links.getByLabel("Issue acme/web#7, closed: Checkout button overlaps footer on mobile");
  await expect(issue).toHaveAttribute("href", "https://github.com/acme/web/issues/7");
  await expect(issue.getByText("Closed", { exact: true })).toBeVisible();
  await expect(issue.getByText("Checkout button overlaps footer on mobile", { exact: true })).toBeVisible();
  await expect(issue.getByText("Seen on iOS Safari.", { exact: true })).toBeVisible();
  await expect(issue.getByText("lana", { exact: true })).toBeVisible();
  await expect(issue.getByText("bug", { exact: true })).toBeVisible();
  await expect(issue.getByText("mobile", { exact: true })).toBeVisible();
  await expect(issue.getByText("4 comments", { exact: true })).toBeVisible();

  // The repeated link is one card, and neither the code link nor the other host is a reference at all.
  await expect(links.getByLabel(/99|other/u)).toHaveCount(0);
  await settle(world, session);
});

test("A repository link becomes a card with its name, Private or Archived tags, description, language, stars and forks that fits a phone inside a user bubble", { tags: ["RICH-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  // A second canned repository, archived and public, so both tags the card can carry are on screen.
  await writeFile(join(world.runDir, "gh", "previews.json"), JSON.stringify({
    "acme/legacy": { nameWithOwner: "acme/legacy", description: "The storefront before the rewrite.", stargazerCount: 12, forkCount: 3, primaryLanguage: { name: "Go" }, isPrivate: false, isArchived: true },
  }));
  const session = await world.createSession({ title: "Two repositories" });
  await world.prompt(session, "Compare https://github.com/acme/web with https://github.com/acme/legacy before you start.");
  await hui.open(`${world.url}/sessions/${session.id}`);

  // The cards sit under the operator's own message, which is the latest one HUI unfurls.
  const phone = await hui.phoneScreen();
  const links = screen.getByLabel("GitHub links");
  const current = links.getByLabel("GitHub repository acme/web");
  await expect(current).toBeVisible();
  await expect(links.getByRole("listitem")).toHaveCount(2);
  await expect(current).toHaveAttribute("href", "https://github.com/acme/web");
  await expect(current).toHaveAttribute("target", "_blank");
  await expect(current.getByText("acme/web", { exact: true })).toBeVisible();
  await expect(current.getByText("Private", { exact: true })).toBeVisible();
  await expect(current.getByText("Acme storefront and design system", { exact: true })).toBeVisible();
  await expect(current.getByText("TypeScript", { exact: true })).toBeVisible();
  await expect(current.getByLabel("1284 stars")).toContainText("1.3k");
  await expect(current.getByLabel("97 forks")).toContainText("97");

  const legacy = links.getByLabel("GitHub repository acme/legacy");
  await expect(legacy.getByText("Archived", { exact: true })).toBeVisible();
  await expect(legacy.getByText("Private", { exact: true })).toHaveCount(0);
  await expect(legacy.getByText("The storefront before the rewrite.", { exact: true })).toBeVisible();
  await expect(legacy.getByText("Go", { exact: true })).toBeVisible();
  await expect(legacy.getByLabel("12 stars")).toContainText("12");
  await expect(legacy.getByLabel("3 forks")).toContainText("3");

  // A phone's width holds both cards, the user bubble they hang under included.
  const bubble = screen.getByText("Compare", { exact: false }).first();
  expect((await edges(bubble)).right).toBeLessThanOrEqual(phone.width + 0.5);
  expect((await edges(current)).right).toBeLessThanOrEqual(phone.width + 0.5);
  expect((await edges(legacy)).right).toBeLessThanOrEqual(phone.width + 0.5);
  expect(await hui.overflowX()).toBe(0);
  await settle(world, session);
});

test("An item only gh's second, inactive account can read still fills its card, and that account's token never reaches the browser", { tags: ["RICH-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  // `_account` is the fixture's own rule: only that login's token answers this item, so the active one cannot see it.
  const token = "fake-token-hui-e2e-personal";
  const url = "https://github.com/acme/web/pull/21";
  await writeFile(join(world.runDir, "gh", "previews.json"), JSON.stringify({
    "acme/web#21": { __typename: "PullRequest", number: 21, title: "Only my personal account can see this", state: "OPEN", isDraft: false, author: { login: "hui-e2e-personal" }, additions: 3, deletions: 1, changedFiles: 1, comments: { totalCount: 0 }, body: "Hidden from the work account.", _account: "hui-e2e-personal" },
  }));
  const session = await world.createSession({ title: "A private item" });
  await world.prompt(session, reply(`The review is at ${url} and only my personal account can read it.`));
  await hui.open(`${world.url}/sessions/${session.id}`);

  const links = screen.getByLabel("GitHub links");
  const card = links.getByLabel("Pull request acme/web#21, open: Only my personal account can see this");
  await expect(card).toBeVisible();
  await expect(card.getByText("Hidden from the work account.", { exact: true })).toBeVisible();
  await expect(card.getByText("hui-e2e-personal", { exact: true })).toBeVisible();

  // The browser's own previews payload and the transcript carry facts only, never the inactive account's token.
  const payload = await world.api<unknown>("GET", `/__hui/github/previews?url=${encodeURIComponent(url)}`);
  expect(JSON.stringify(payload)).toContain("Only my personal account can see this");
  expect(JSON.stringify(payload)).not.toContain(token);
  expect(await hui.textOf(screen.getByTestId("transcript"))).not.toContain(token);
  await settle(world, session);
});
