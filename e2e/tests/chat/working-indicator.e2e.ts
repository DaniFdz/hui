/** While a turn runs, the working indicator names the step the agent is on, and it goes when the turn settles (CHAT-003). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const heldEcho = `E2E_HOLD:${Buffer.from(JSON.stringify({ name: "fixture_echo", input: { text: "held" } })).toString("base64url")}`;

test("the working indicator names each step until the turn settles", { tags: ["CHAT-003"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Working steps" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();

  for (const [prompt, step] of [["E2E_COMMAND_RUNNING", "Running command…"], [heldEcho, "Working…"], ["E2E_REPLAY", "Writing response…"]]) {
    await message.fill(prompt!);
    await send.tap();
    await hui.provider.held();
    await expect(screen.getByLabel(`Agent activity: ${step}`)).toBeVisible();
    await hui.provider.release();
    await expect(idle).toBeVisible();
    await expect(screen.getByLabel(/^Agent activity: /u)).toBeHidden();
  }
  await expect(screen.getByTestId("transcript").getByText("Replay prefix — replay suffix")).toBeVisible();
});
