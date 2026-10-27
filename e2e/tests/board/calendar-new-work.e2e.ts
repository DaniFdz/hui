/** Work sent in a new session shows up in this week's calendar at the current time, under its repository, with the first message in its card (BOARD-061). */
import { basename } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const clockMinutes = (text: string) => {
  const [, hours, minutes, suffix] = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?/iu.exec(text)!;
  const hour = suffix ? (Number(hours) % 12) + (/^p/iu.test(suffix) ? 12 : 0) : Number(hours);
  return hour * 60 + Number(minutes);
};
const distance = (one: number, other: number) => Math.min(Math.abs(one - other), 1440 - Math.abs(one - other));

test("after sending a message in a new session, the calendar lists it this week under its repository with a block at the current time whose card shows that first message", { tags: ["BOARD-061"], platforms: ["web"] }, async ({ screen, hui }) => {
  const first = "Calendar new work message";
  const session = await hui.createSession({ title: "Calendar new work" });
  await hui.open(`/sessions/${session.id}`);
  const message = screen.getByLabel("Message");
  await message.fill(first);
  await message.press("Enter");
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();

  await hui.open("/contributions");
  await screen.getByRole("button", "Calendar").tap();
  await expect(screen.getByLabel("Time per project").getByText(basename(hui.workspace))).toBeVisible();

  const block = screen.getByRole("button", /of activity$/u);
  const label = await block.getAttribute("aria-label");
  const now = new Date();
  expect(distance(clockMinutes(label!), now.getHours() * 60 + now.getMinutes())).toBeLessThanOrEqual(5);
  await block.tap();
  await expect(screen.getByLabel("Sessions in this block").getByText(first)).toBeVisible();
});
