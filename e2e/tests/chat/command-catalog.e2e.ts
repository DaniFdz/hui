/** While the command catalog loads the menu says so and Enter cannot send the bare `/`, and a failed catalog shows its error with Retry commands, which reloads it and keeps the draft (CHAT-047). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a slow command catalog says Loading commands without sending, and a failed one retries with the draft kept", { tags: ["CHAT-047"], platforms: ["web"] }, async ({ screen, hui }) => {
  const catalog = await hui.intercept("GET", /\/__hui\/sessions\/[^/]+\/commands/u);
  const session = await hui.createSession({ title: "Catalog failure" });
  await hui.open(`/sessions/${session.id}`);
  const message = screen.getByLabel("Message");
  const menu = screen.getByLabel("Commands and paths");
  const transcript = screen.getByTestId("transcript");
  const before = await hui.providerRequests();

  await message.fill("/");
  await catalog.arrived();
  await expect(screen.getByText("Loading commands…")).toBeVisible();
  await message.press("Enter");
  await expect(transcript.getByText("Start a conversation")).toBeVisible();
  expect(await hui.providerRequests()).toBe(before);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await message.fill("/");
  await expect(screen.getByText("Loading commands…")).toBeVisible();
  await catalog.reject(500, "Could not load commands.");
  await expect(screen.getByText(/Could not load commands\./u)).toBeVisible();
  await expect(message).toHaveValue("/");

  await screen.getByRole("button", "Retry commands").tap();
  await expect(menu.getByText("$check-status", { exact: true })).toBeVisible();
  await expect(screen.getByText(/Could not load commands\./u)).toBeHidden();
  await expect(message).toHaveValue("/");
  await expect(transcript.getByText("Start a conversation")).toBeVisible();
});
