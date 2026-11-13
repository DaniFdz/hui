/** At 390 px, a turn's mid-turn messages and its folded activity fit the width with no sideways scrolling, and opening the activity keeps them readable (CHAT-079). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("mid-turn messages and folded activity fit a 390 px screen and stay readable once opened", { tags: ["CHAT-079"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Mid-turn on a phone" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  const phone = await hui.phoneScreen();
  const inside = (box: { x: number; y: number; width: number; height: number }) => {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(phone.width);
  };

  await screen.getByLabel("Message").fill("E2E_MIDTURN_MESSAGE");
  await screen.getByRole("button", "Send message").tap();
  const midTurn = transcript.getByText("Started two helpers in the background; I'll report when they're back.");
  await expect(midTurn).toBeVisible();
  await expect(idle).toBeVisible();
  expect(await hui.overflowX()).toBe(0);
  inside((await midTurn.boundingBox())!);

  const group = transcript.getByText("Used 1 tool");
  await hui.scrollTo(transcript, group);
  inside((await group.boundingBox())!);
  await group.tap();
  const read = transcript.getByRole("button", /^Read fixture\.txt/u);
  await expect(read).toBeVisible();
  inside((await read.boundingBox())!);
  expect(await hui.overflowX()).toBe(0);
  // The message written before the activity keeps its own row, readable at the same width.
  await hui.scrollTo(transcript, midTurn);
  await expect(midTurn).toBeVisible();
  inside((await midTurn.boundingBox())!);
});
