/** Opening a saved conversation: a lost gateway response shows the connection failure instead of an empty chat, and Try again loads its saved messages once responses arrive (SHELL-024); a slow link over a long conversation shows the loading state with its bar and then the whole transcript, never an empty chat or a toast (SHELL-023). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

/** The open conversation's name: the chat header's title on the wide layout, and on a phone the panel chooser that takes
 * that title's place in the header (SHELL-047). */
const names = (hui: Hui, screen: Screen, title: string) =>
  expect.poll(() => hui.textOf(screen.getByTestId("chat-header"))).toContain(title);

test("a connection lost while opening a conversation shows its reason and Try again restores the saved conversation", { tags: ["SHELL-024"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Recover this conversation" });
  await hui.prompt(session, "Saved before the connection failed");
  await hui.open("/");
  await hui.sessionList();
  const row = screen.getByTestId("session-row").filter({ hasText: "Recover this conversation" });
  await expect(row).toBeVisible();

  const load = await hui.intercept("POST", new RegExp(`/__hui/sessions/${session.id}/open$`, "u"));
  await row.tap();
  await load.arrived();
  const loading = screen.getByText("Loading the conversation…");
  const empty = screen.getByText("Start a conversation", { exact: true });
  await expect(loading).toBeVisible();
  await expect(empty).toBeHidden();
  await load.deliverAndDrop();

  const failed = screen.getByText("Could not load this conversation");
  await expect(failed).toBeVisible();
  await expect(screen.getByText("Could not reach HUI. Check the connection and try again.")).toBeVisible();
  await expect(empty).toBeHidden();
  const retry = screen.getByRole("button", "Try again");
  await expect(retry).toBeVisible();
  await retry.tap();

  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText("Saved before the connection failed", { exact: true })).toBeVisible();
  await expect(transcript.getByText("Fixture response.", { exact: true })).toBeVisible();
  await expect(transcript.getByText("Saved before the connection failed", { exact: true })).toHaveCount(1);
  await expect(transcript.getByText("Fixture response.", { exact: true })).toHaveCount(1);
  await names(hui, screen, "Recover this conversation");
  await expect(failed).toBeHidden();
  await expect(loading).toBeHidden();
  await expect(retry).toBeHidden();
});

test("a long conversation opened over a slow link shows its skeleton and arrives whole", { tags: ["SHELL-023"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Long conversation" });
  const prompts = Array.from({ length: 10 }, (_, index) => `Saved turn ${index + 1}`);
  for (const text of prompts) await hui.prompt(session, text);
  await hui.open("/");
  await hui.sessionList();
  const row = screen.getByTestId("session-row").filter({ hasText: "Long conversation" });
  await expect(row).toBeVisible();

  const loading = screen.getByText("Loading the conversation…");
  const skeleton = screen.getByTestId("conversation-skeleton");
  const empty = screen.getByText("Start a conversation", { exact: true });
  const toast = screen.getByRole("button", "Dismiss notification");
  const load = await hui.intercept("POST", new RegExp(`/__hui/sessions/${session.id}/open$`, "u"));
  await row.tap();
  await load.arrived();
  await expect(loading).toBeVisible();
  await expect(skeleton).toBeVisible();
  await expect(empty).toBeHidden();
  await expect(toast).toBeHidden();

  await load.deliver();
  const transcript = screen.getByTestId("transcript");
  for (const text of prompts) await expect(transcript.getByText(text, { exact: true })).toBeVisible();
  await expect(transcript.getByText("Fixture response.", { exact: true })).toHaveCount(prompts.length);
  await expect(loading).toBeHidden();
  await expect(skeleton).toBeHidden();
  await expect(empty).toBeHidden();
  await expect(toast).toBeHidden();
});
