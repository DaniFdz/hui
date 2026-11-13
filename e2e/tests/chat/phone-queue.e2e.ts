/** At 390 px, a busy run's queue tray, Message field, composer controls and Stop all stay on screen with nothing overflowing sideways (CHAT-082). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the queue, Message field, composer controls and Stop stay on a 390 px screen without overflowing", { tags: ["CHAT-082"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const steer = screen.getByRole("button", "Steer message; touch and hold to enqueue");
  const queue = screen.getByLabel("Queued messages");

  const session = await hui.createSession({ title: "Queue on a phone" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await message.fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();

  await message.fill("Queued after this run");
  await hui.hold(steer, screen.getByText("Enqueue"));
  await screen.getByText("Enqueue").tap();
  await expect(queue.getByText("Queued after this run")).toBeVisible();
  await message.fill("Sent into this run");
  await steer.tap();
  await expect(queue.getByText("Sent into this run")).toBeVisible();
  await message.fill("");

  const phone = await hui.phoneScreen();
  const inside = (box: { x: number; y: number; width: number; height: number }) => {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(phone.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(phone.height);
  };
  await expect(queue).toBeVisible();
  await expect(message).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeVisible();
  inside((await queue.boundingBox())!);
  inside((await message.boundingBox())!);
  inside((await screen.getByRole("button", "Stop").boundingBox())!);
  for (const control of [screen.getByLabel("Add attachment").first(), screen.getByLabel(/^Model: /u), screen.getByLabel(/^Thinking: /u)]) {
    await expect(control).toBeVisible();
    inside((await control.boundingBox())!);
  }
  // The tray reads above the field it queues for, on the composer's top edge.
  expect((await queue.boundingBox())!.y).toBeLessThan((await message.boundingBox())!.y);
  expect(await hui.overflowX()).toBe(0);
  expect(await hui.reachable(message)).toBe(true);
  expect(await hui.reachable(screen.getByRole("button", "Stop"))).toBe(true);

  await hui.provider.release();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
