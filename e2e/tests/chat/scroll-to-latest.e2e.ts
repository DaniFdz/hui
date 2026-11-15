/** Scrolling away from a streaming reply keeps the reading position and offers Scroll to latest, which returns to the live edge and follows again (CHAT-062). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const reply = (text: string) => `E2E_REPLY:${Buffer.from(text).toString("base64url")}`;
const filler = (turn: number) => Array.from({ length: 16 }, (_, line) => `Turn ${turn} line ${line + 1}`).join("\n\n");

test("reading back while a reply streams keeps the reading position, and Scroll to latest returns to the live edge", { tags: ["CHAT-062"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const latest = screen.getByRole("button", "Scroll to latest");
  const message = screen.getByLabel("Message");
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Read back" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  for (const turn of [1, 2]) {
    await message.fill(reply(filler(turn)));
    await screen.getByRole("button", "Send message").tap();
    await expect(transcript.getByText(`Turn ${turn} line 16`)).toBeVisible();
    await expect(idle).toBeVisible();
  }
  await expect(latest).toHaveCount(0);

  // A reply that streams in two halves, held between them.
  await message.fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await expect(transcript.getByText("Replay prefix — ")).toBeVisible();

  await hui.wheel(transcript, -800);
  await expect(latest).toBeVisible();
  const reading = (await transcript.getByText("Turn 2 line 1").boundingBox())!;
  const scrolled = (await transcript.boundingBox())!;

  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(idle).toBeVisible();
  // The reading position did not move under the arriving text, and the view never jumped to the live edge.
  const held = (await transcript.getByText("Turn 2 line 1").boundingBox())!;
  expect(Math.round(held.y)).toBe(Math.round(reading.y));
  await expect(latest).toBeVisible();
  expect((await transcript.getByText("Replay prefix — replay suffix").boundingBox())!.y).toBeGreaterThan(scrolled.y + scrolled.height);

  await latest.tap();
  await expect(latest).toHaveCount(0);
  const end = (await transcript.getByText("Replay prefix — replay suffix").boundingBox())!;
  const frame = (await transcript.boundingBox())!;
  expect(end.y + end.height).toBeLessThanOrEqual(frame.y + frame.height);

  // Auto-follow resumed: the next reply stays in view without anyone scrolling.
  await message.fill(reply("Following again"));
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Following again")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(latest).toHaveCount(0);
});
