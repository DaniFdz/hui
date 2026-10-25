/** A lost gateway response while opening a saved conversation shows the connection failure instead of an empty chat, and Try again loads its saved messages once responses arrive (SHELL-024). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a connection lost while opening a conversation shows its reason and Try again restores the saved conversation", { tags: ["SHELL-024"], platforms: ["web"] }, async ({ screen, hui }) => {
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
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Recover this conversation");
  await expect(failed).toBeHidden();
  await expect(loading).toBeHidden();
  await expect(retry).toBeHidden();
});
