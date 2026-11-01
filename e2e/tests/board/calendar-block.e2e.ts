/** A calendar block opens a card with its day, start and end, total and sessions, which open their session, and Escape closes it back onto the block (BOARD-053, BOARD-054). */
import { basename } from "node:path";
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const WHEN = /^\w{3}, \w{3} \d{1,2} · \d{1,2}:\d{2}(?: [AP]M)? – \d{1,2}:\d{2}(?: [AP]M)? · .+ of activity$/u;
const DURATION = /^(?:<1m|\d+m|\d+h \d{2}m)$/u;

const work = async (hui: Hui, text: string) => {
  const session = await hui.createSession({ title: "Calendar block card", group: "Alpha" });
  await hui.prompt(session, text);
  return session;
};

test("a block's card names its day, start and end, activity and total this week, lists its sessions which open their session, and a click elsewhere closes it", { tags: ["BOARD-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const first = "Show the block card's first message.";
  const session = await work(hui, first);
  const week = 7 * 24 * 3600 * 1000;
  const model = async () => {
    const activity = await hui.api<{ sessions: { id: string; blocks: { model?: string }[] }[] }>("GET", `/__hui/session-activity?from=${Date.now() - week}&to=${Date.now() + week}`);
    return activity.sessions.find(({ id }) => id === session.id)?.blocks.at(-1)?.model;
  };
  await expect.poll(model, { timeout: 30_000 }).toBeTruthy();
  await hui.open("/contributions");
  await screen.getByRole("button", "Calendar").tap();

  const block = screen.getByRole("button", /of activity$/u);
  const when = screen.getByText("of activity", { exact: false });
  const sessions = screen.getByLabel("Sessions in this block");
  const project = screen.getByText(basename(hui.workspace), { exact: true });
  await expect(project).toHaveCount(2);
  await block.tap();
  await expect(when).toHaveText(WHEN);
  await expect(project).toHaveCount(3);
  await expect(screen.getByText(/^(?:<1m|\d+m|\d+h \d{2}m) this week$/u)).toBeVisible();
  await expect(sessions.getByRole("listitem").filter({ hasText: "Calendar block card" })).toBeVisible();
  await expect(sessions.getByText(first)).toBeVisible();
  await expect(sessions.getByText(DURATION)).toBeVisible();

  await sessions.getByRole("button", "Calendar block card", { exact: false }).tap();
  expect(new URL(await hui.url()).pathname).toBe(`/sessions/${session.id}`);

  await hui.open("/contributions");
  await block.tap();
  await expect(when).toHaveText(WHEN);
  await screen.getByText("Hours per day").tap();
  await expect(sessions).toBeHidden();

  await screen.getByRole("button", "Session", { exact: true }).tap();
  await block.tap();
  await expect(when).toHaveText(WHEN);
  await expect(project).toBeVisible();
  await expect(screen.getByText("Alpha", { exact: true })).toBeVisible();
  const found = (await model())!;
  const name = found.slice(found.lastIndexOf("/") + 1);
  await expect(screen.getByText(name, { exact: true })).toBeVisible();
  await expect(screen.getByText(first, { exact: false })).toBeVisible();
  await screen.getByRole("button", "Open session").tap();
  expect(new URL(await hui.url()).pathname).toBe(`/sessions/${session.id}`);
});

test("Escape closes an open block card and returns focus to its block", { tags: ["BOARD-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  await work(hui, "Escape closes this card.");
  await hui.open("/contributions");
  await screen.getByRole("button", "Calendar").tap();
  const block = screen.getByRole("button", /of activity$/u);
  const sessions = screen.getByLabel("Sessions in this block");
  await block.tap();
  await sessions.getByRole("button", "Calendar block card", { exact: false }).press("Escape");
  await expect(sessions).toBeHidden();
  await expect(block).toBeFocused();
});
