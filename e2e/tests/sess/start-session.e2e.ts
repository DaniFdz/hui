/** New Session starts a session that opens and answers its first message, and keeps an unsent draft across a reload (SESS-001). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("New Session starts a session that answers its first message", { tags: ["SESS-001", "smoke"], platforms: ["web"] }, async ({ screen, hui }) => {
  const directory = screen.getByLabel("Project directory");
  const message = screen.getByPlaceholder("What should this session work on?");
  const start = screen.getByRole("button", "Start session");
  const transcript = screen.getByTestId("transcript");

  await hui.open("/");
  await expect(start).toBeDisabled();
  await directory.fill(hui.workspace);
  await message.fill("Hello from New Session");
  await expect(start).toBeEnabled();
  await start.tap();

  await expect(transcript.getByText("Hello from New Session")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(screen.getByLabel(/, status idle, tool durable, stage investigation$/u)).toHaveCount(1);
});

test("an unsent New Session message survives a reload", { tags: ["SESS-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByPlaceholder("What should this session work on?");

  await hui.open("/");
  await message.fill("A draft to keep");
  await expect.poll(() => hui.newSessionDraft()).toBe("A draft to keep");
  await hui.reload();
  await expect(message).toHaveValue("A draft to keep");
});
