/** On a 390 px screen a busy run keeps its queue and controls on screen, a touch device names its busy placeholder, and mid-turn messages and folded activity fit the width (CHAT-072, CHAT-074, CHAT-079). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const KEYBOARD_PLACEHOLDER = /^↵ adds to this run · (?:⌘|Ctrl\+)↵ queues for later$/u;
const TOUCH_PLACEHOLDER = "Add to this run…";

const held = (path: string) =>
  `E2E_HOLD:${Buffer.from(JSON.stringify([{ name: "read", input: { path } }, { name: "fixture_echo", input: { text: "held" } }])).toString("base64url")}`;

const fits = async (target: Locator, phone: { width: number; height: number }) => {
  const box = (await target.boundingBox())!;
  expect(box.width).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(phone.width);
  expect(box.y + box.height).toBeLessThanOrEqual(phone.height);
};

async function busyRun(screen: Screen, hui: Hui, title: string) {
  const session = await hui.createSession({ title });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
}

test("a touch device's busy composer names the short action instead of the keyboard shortcuts", { tags: ["CHAT-072"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.phoneScreen();
  await busyRun(screen, hui, "Keyboard busy composer");
  await expect(screen.getByLabel("Message")).toHaveAttribute("placeholder", KEYBOARD_PLACEHOLDER);
  await hui.provider.release();
  await expect(screen.getByTestId("transcript").getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await hui.touchPointer();
  await busyRun(screen, hui, "Touch busy composer");
  await expect(screen.getByLabel("Message")).toHaveAttribute("placeholder", TOUCH_PLACEHOLDER);
  await hui.provider.release();
  await expect(screen.getByTestId("transcript").getByText("Replay prefix — replay suffix")).toBeVisible();
});

test("a busy phone keeps the queued messages tray above the composer and its controls on screen without overflow", { tags: ["CHAT-074"], platforms: ["web"] }, async ({ screen, hui }) => {
  const phone = await hui.phoneScreen();
  await busyRun(screen, hui, "Phone queue");
  const message = screen.getByLabel("Message");
  const steer = screen.getByRole("button", "Steer message; touch and hold to enqueue");
  const queue = screen.getByLabel("Queued messages");

  await message.fill("Steer on a phone");
  await steer.tap();
  await expect.poll(() => hui.textOf(queue)).toMatch(/Steer on a phone\s*Steer/u);
  await message.fill("Follow up on a phone");
  await hui.hold(steer, screen.getByText("Enqueue"));
  await screen.getByText("Enqueue").tap();
  await expect.poll(() => hui.textOf(queue)).toMatch(/Steer on a phone\s*Steer.*Follow up on a phone\s*Follow up/su);
  await expect(message).toHaveValue("");

  for (const control of [queue, message, screen.getByLabel("Add attachment").first(), screen.getByRole("button", "Stop")]) {
    await expect(control).toBeVisible();
    await fits(control, phone);
  }
  const tray = (await queue.boundingBox())!;
  expect(tray.y + tray.height).toBeLessThanOrEqual((await message.boundingBox())!.y);
  expect(await hui.overflowsSideways()).toBe(false);

  await hui.provider.release();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(queue).toBeHidden();
});

test("mid-turn messages and folded activity fit a phone's width and stay readable when the activity opens", { tags: ["CHAT-079"], platforms: ["web"] }, async ({ screen, hui }) => {
  const phone = await hui.phoneScreen();
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Phone mid-turn" });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill("E2E_MIDTURN_MESSAGE");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("What to check for the checkout alert")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  const midTurn = transcript.getByText("Started two helpers in the background; I'll report when they're back.");
  await expect(midTurn).toBeVisible();
  await fits(midTurn, phone);
  await fits(transcript.getByText("Ran 1 command"), phone);
  expect(await hui.overflowsSideways()).toBe(false);

  await hui.scrollTo(transcript, transcript.getByText("Ran 1 command"));
  await transcript.getByText("Ran 1 command").tap();
  await expect(transcript.getByRole("button", "Read fixture.txt")).toBeVisible();
  await expect(midTurn).toBeVisible();
  await fits(midTurn, phone);
  expect(await hui.overflowsSideways()).toBe(false);

  const run = await hui.createSession({ title: "Phone held activity" });
  await hui.open(`/sessions/${run.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill(held(`${hui.workspace}/fixture.txt`));
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  const activity = screen.getByLabel(/^Agent activity: /u);
  await expect(activity).toBeVisible();
  await fits(activity, phone);
  await fits(transcript.getByText(/^Ran 2 commands/u), phone);
  expect(await hui.overflowsSideways()).toBe(false);
  await hui.provider.release();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
