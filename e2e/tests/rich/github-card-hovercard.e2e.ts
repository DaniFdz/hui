/** A chat's pull request card opens the same hovercard as a session's pull request badge on hover or keyboard focus,
 * driven against the `github` fixture world whose fake `gh` describes `acme/web#12`: the card's snippet shows the first
 * line of the description, and the hovercard adds the state, the title and the whole Markdown description, headings
 * included (RICH-031). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type World = Awaited<ReturnType<Hui["world"]>>;

/** Removes the world's session once the assertions are done: a runtime still writing into the world's agent directory
 * while the fixture stops and removes that directory makes the world's own cleanup race it. */
const settle = async (world: World, session: { id: string }) => {
  await world.api("DELETE", `/__hui/sessions/${session.id}`);
};

test("Hovering or keyboard-focusing a pull request card opens the same hovercard as a session badge, with the state and the full Markdown description the snippet leaves out", { tags: ["RICH-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  const session = await world.createSession({ title: "The checkout card" });
  // The fake `gh` describes this pull request's body as "Adds GitHub link previews to chat messages." followed by a
  // "Details" heading and one more paragraph, so the card's snippet and the hovercard can be told apart.
  await world.prompt(session, "Review https://github.com/acme/web/pull/12 before you start.");
  await hui.open(`${world.url}/sessions/${session.id}`);

  const card = screen.getByLabel("Pull request acme/web#12, open: Fixture pull request 12");
  await expect(card).toBeVisible();
  // The card shows the first line of the description only.
  await expect(card.getByText("Adds GitHub link previews to chat messages.", { exact: true })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Details" })).toHaveCount(0);

  // Hovering the card opens a card of its own with the reference, the state, the title and the whole description,
  // rendered as Markdown: the heading the embed's snippet leaves out is a heading there.
  const hovercard = screen.getByRole("tooltip", { name: /^acme\/web#12 /u });
  await hui.peek(card);
  await expect(hovercard).toBeVisible();
  await expect(hovercard.getByText("acme/web#12", { exact: true })).toBeVisible();
  await expect(hovercard.getByText("Open", { exact: true })).toBeVisible();
  await expect(hovercard.getByText("Fixture pull request 12", { exact: true })).toBeVisible();
  await expect(hovercard.getByText("Adds GitHub link previews to chat messages.", { exact: true })).toBeVisible();
  await expect(hovercard.getByRole("heading", { name: "Details" })).toBeVisible();
  await expect(hovercard.getByText("More.", { exact: true })).toBeVisible();
  // The pointer travelling onto the card keeps it open, as it does for a badge's card.
  await hui.peek(hovercard.getByText("More.", { exact: true }));
  await expect(hovercard).toBeVisible();

  // Leaving closes it, and keyboard focus on the card opens it again: a keyboard user gets the same description.
  await hui.peek(screen.getByTestId("session-title", { visible: true }));
  await expect(hovercard).toBeHidden();
  await card.focus();
  await expect(card).toBeFocused();
  await expect(hovercard).toBeVisible();
  await expect(hovercard.getByRole("heading", { name: "Details" })).toBeVisible();
  await expect(hovercard.getByText("More.", { exact: true })).toBeVisible();
  await settle(world, session);
});
