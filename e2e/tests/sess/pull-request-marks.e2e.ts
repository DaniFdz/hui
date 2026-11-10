/** A session's pull request marks and their card, driven against the `github` fixture world whose fake `gh` answers the
 * preview queries: one mark per pull request the session created, colored and named by state with its title, the newest at
 * the trailing edge and the next one half-visible, the strip widening and scrolling on the pointer, narrowing on the title,
 * and a pull request only mentioned in text getting no mark (SESS-044); and a mark's card, which opens on hover or keyboard
 * focus with its repository number, state pill, title and Markdown description or the no-facts fallback, stays open while
 * the pointer is on it and scrolls its description, and whose link opens GitHub while HUI stays on the session (SESS-045). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;
const reply = (text: string) => `E2E_REPLY:${Buffer.from(text).toString("base64url")}`;

/** A GraphQL pull request node the fake `gh` answers with, as `previews.json` holds them. */
const node = (number: number, title: string, patch: Record<string, unknown> = {}) => ({
  __typename: "PullRequest", number, title, state: "OPEN", isDraft: false, author: { login: "hui-e2e" },
  additions: 4, deletions: 1, changedFiles: 1, comments: { totalCount: 0 }, reviewThreads: { totalCount: 0 },
  body: `The description of ${title}.`, ...patch,
});

test("a session's pull request marks name and color each state, the newest sits at the trailing edge with the next half-visible, the strip widens and scrolls, the title narrows it, and a mentioned pull request gets no mark", { tags: ["SESS-044"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  await writeFile(join(world.runDir, "gh", "previews.json"), JSON.stringify({
    "acme/web#1": node(1, "Write the release notes"),
    "acme/web#2": node(2, "Draft the upgrade guide", { isDraft: true }),
    "acme/web#3": node(3, "Ship the new checkout", { state: "MERGED" }),
    "acme/web#4": node(4, "Retire the old form", { state: "CLOSED" }),
  }));
  const session = await world.createSession({ title: "Release train" });
  await world.prompt(session, call("bash", {
    command: ["echo gh pr create", ...[1, 2, 3, 4].map((number) => `echo https://github.com/acme/web/pull/${number}`)].join("; "),
  }));
  // A pull request the answer only mentions is not one the session created.
  await world.prompt(session, reply("The old form lives on https://github.com/acme/web/pull/99, which this session never opened."));

  await hui.open(`${world.url}/sessions/${session.id}`);
  await hui.sessionList();
  const strip = screen.getByRole("group", "4 pull requests");
  const mark = (number: number, state: string, title: string) => screen.getByRole("link", `Pull request acme/web#${number}, ${state}: ${title}`);
  const open = mark(1, "open", "Write the release notes");
  const draft = mark(2, "draft", "Draft the upgrade guide");
  const merged = mark(3, "merged", "Ship the new checkout");
  const closed = mark(4, "closed", "Retire the old form");

  // One mark per created pull request, colored and named by its state, and none for the one only mentioned in text.
  for (const [target, state] of [[open, "open"], [draft, "draft"], [merged, "merged"], [closed, "closed"]] as const) {
    await expect(target).toBeVisible();
    await expect(target).toHaveAttribute("data-state", state);
  }
  await expect(screen.getByRole("link", /#99, /u)).toHaveCount(0);
  await expect(screen.getByRole("group", "5 pull requests")).toHaveCount(0);

  // The newest sits at the trailing edge and the next one is half-visible past the strip's leading edge.
  const box = async (target: Locator) => (await target.boundingBox())!;
  const edge = async () => (await strip.boundingBox())!;
  expect((await box(closed)).x).toBeGreaterThan((await box(merged)).x);
  // Narrowed, the newest mark still fits whole inside the strip.
  await expect(closed).toBeVisible();
  await expect.poll(async () => (await box(closed)).x + (await box(closed)).width <= (await edge()).x + (await edge()).width + 0.5).toBe(true);

  // The strip widens under the pointer and keeps that room while a mark holds focus.
  const resting = (await edge()).width;
  await hui.peek(strip);
  await expect.poll(async () => (await edge()).width).toBeGreaterThan(resting);
  const widened = (await edge()).width;
  await draft.focus();
  await expect(draft).toBeFocused();
  await expect.poll(async () => (await edge()).width).toBeGreaterThanOrEqual(widened);

  // The wheel scrolls the strip through the marks it hides.
  await hui.wheel(strip, 200);
  await expect.poll(async () => (await box(open)).x).toBeGreaterThanOrEqual((await edge()).x - 1);

  // Hovering the title narrows it back to a single mark.
  const title = screen.getByRole("link", { name: /^Release train, status /u });
  await title.focus();
  await hui.peek(title);
  await expect.poll(async () => (await edge()).width).toBeLessThan(resting);
});

test("a mark's card opens on hover or keyboard focus with its repository number, state, title and description, keeps open while the pointer is on it, and its link opens GitHub while HUI stays on the session", { tags: ["SESS-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  const description = "The checkout keeps the cart's currency on every step.";
  await writeFile(join(world.runDir, "gh", "previews.json"), JSON.stringify({
    "acme/web#3": node(3, "Ship the new checkout", { state: "MERGED", body: `## Details\n\n${description}\n\n${Array.from({ length: 30 }, (_, index) => `A paragraph ${index + 1} of the description.`).join("\n\n")}` }),
    "acme/web#4": node(4, "Retire the old form", { state: "CLOSED", body: "" }),
  }));
  const press = async (key: string) => {
    await hui.keyboard.down(key);
    await hui.keyboard.up(key);
  };
  const session = await world.createSession({ title: "Release train" });
  await world.prompt(session, call("bash", {
    // #5 has no GitHub facts at all, so its mark and card fall back to the reference alone.
    command: ["echo gh pr create", ...[3, 4, 5].map((number) => `echo https://github.com/acme/web/pull/${number}`)].join("; "),
  }));
  await hui.open(`${world.url}/sessions/${session.id}`);
  await hui.sessionList();
  const merged = screen.getByRole("link", "Pull request acme/web#3, merged: Ship the new checkout");
  const unknown = screen.getByRole("link", /^Pull request acme\/web#5, status unavailable/u);
  const strip = screen.getByRole("group", "3 pull requests");
  const card = screen.getByRole("tooltip", { name: /^acme\/web#3 Merged Ship the new checkout/u });
  await expect(merged).toBeVisible();

  // Hovering a mark opens the card below it with the reference, a state pill, the title and the Markdown description.
  // The strip widens under the pointer first, as a real pointer would rest on it before reaching the mark it hides.
  await hui.peek(strip);
  await hui.peek(merged);
  await expect(card).toBeVisible();
  await expect(card.getByText("acme/web#3", { exact: true })).toBeVisible();
  await expect(card.getByText("Merged", { exact: true })).toBeVisible();
  await expect(card.getByText("Ship the new checkout", { exact: true })).toBeVisible();
  await expect(card.getByText(description, { exact: true })).toBeVisible();
  expect((await card.boundingBox())!.y).toBeGreaterThan((await merged.boundingBox())!.y + (await merged.boundingBox())!.height);

  // The pointer moves onto the card and scrolls its description without closing it.
  const details = card.getByText("Details", { exact: true });
  const before = (await details.boundingBox())!.y;
  await hui.peek(card.getByText(description, { exact: true }));
  await expect(card).toBeVisible();
  await hui.peek(card.getByText("A paragraph 30 of the description.", { exact: true }));
  await expect(card).toBeVisible();
  await expect.poll(async () => (await details.boundingBox())!.y).toBeLessThan(before);

  // Leaving closes it, and keyboard focus on a mark opens its own, which has no GitHub details.
  await hui.peek(screen.getByRole("link", { name: /^Release train, status /u }));
  await expect(card).toBeHidden();
  const unknownCard = screen.getByRole("tooltip", { name: /^acme\/web#5 Status unavailable GitHub details are unavailable/u });
  await screen.getByRole("link", { name: /^Release train, status /u }).focus();
  await press("Tab");
  await expect(unknown).toBeFocused();
  await expect(unknownCard).toBeVisible();
  await expect(unknownCard.getByText("acme/web#5", { exact: true })).toBeVisible();
  await expect(unknownCard.getByText("Status unavailable", { exact: true })).toBeVisible();
  await expect(unknownCard.getByText("GitHub details are unavailable. Open the pull request to view it.")).toBeVisible();

  // Activating the mark opens the pull request on GitHub and leaves HUI on the session.
  await expect(unknown).toHaveAttribute("href", "https://github.com/acme/web/pull/5");
  await expect(unknown).toHaveAttribute("target", "_blank");
  await unknown.tap();
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${session.id}`);
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Release train");
});
