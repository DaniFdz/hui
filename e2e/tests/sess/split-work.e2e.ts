/** Two panes of a split keep their own transcript, composer, draft, queue and stream: both sessions run at once with their own Stop, stopping one leaves the other running, and a session with an unsent draft marks its row's menu button (SESS-049). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

const first = (panes: Locator) => ({
  title: panes.nth(0).getByTestId("session-title"),
  transcript: panes.nth(0).getByTestId("transcript"),
  message: panes.nth(0).getByLabel("Message"),
  stop: panes.nth(0).getByRole("button", "Stop"),
  steer: panes.nth(0).getByRole("button", "Steer message; touch and hold to enqueue"),
  queue: panes.nth(0).getByLabel("Queued messages"),
  idle: panes.nth(0).getByLabel("Session status: Idle"),
});
const second = (panes: Locator) => ({
  title: panes.nth(1).getByTestId("session-title"),
  transcript: panes.nth(1).getByTestId("transcript"),
  message: panes.nth(1).getByLabel("Message"),
  stop: panes.nth(1).getByRole("button", "Stop"),
  queue: panes.nth(1).getByLabel("Queued messages"),
  idle: panes.nth(1).getByLabel("Session status: Idle"),
});

test("each pane keeps its own transcript, composer, draft, queue and stream, so two sessions run at once with their own Stop and an unsent draft marks its row", { tags: ["SESS-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.wideScreen(2200);
  const panes = screen.getByTestId("session-pane");
  const left = await hui.createSession({ title: "Left running chat" });
  const right = await hui.createSession({ title: "Right running chat" });

  await hui.open(`/sessions/${left.id}`);
  await expect(first(panes).title).toHaveText("Left running chat");
  await hui.sessionList();
  await (await hui.sessionMenu("Right running chat")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(2);
  await expect(first(panes).title).toHaveText("Left running chat");
  await expect(second(panes).title).toHaveText("Right running chat");

  // Each pane draws its own session's transcript, not the other's.
  await hui.prompt(left, "E2E_REPLAY left pane work");
  await hui.prompt(right, "E2E_REPLAY right pane work");
  await expect(first(panes).transcript.getByText("E2E_REPLAY left pane work")).toBeVisible();
  await expect(second(panes).transcript.getByText("E2E_REPLAY right pane work")).toBeVisible();
  await expect(first(panes).transcript.getByText("E2E_REPLAY right pane work")).toBeHidden();
  await expect(second(panes).transcript.getByText("E2E_REPLAY left pane work")).toBeHidden();

  // Both streams run at once, each with its own Stop, and stopping one leaves the other running.
  await hui.provider.held();
  await expect(first(panes).stop).toBeVisible();
  await expect(second(panes).stop).toBeVisible();
  await second(panes).stop.tap();
  await expect(second(panes).stop).toBeHidden();
  await expect(second(panes).idle).toBeVisible();
  await expect(first(panes).stop).toBeVisible();

  // The queue belongs to the pane that made it.
  await first(panes).message.fill("Queued in the left pane");
  await hui.hold(first(panes).steer, screen.getByText("Enqueue"));
  await screen.getByText("Enqueue").tap();
  await expect(first(panes).queue.getByText("Queued in the left pane")).toBeVisible();
  await expect(second(panes).queue).toBeHidden();

  await hui.provider.release();
  await expect(first(panes).stop).toBeHidden();
  await expect(first(panes).idle).toBeVisible();
  await expect(first(panes).queue).toBeHidden();

  // An unsent draft belongs to its own pane and marks its session's row menu button.
  await second(panes).message.fill("A draft the right pane keeps");
  await expect(second(panes).message).toHaveValue("A draft the right pane keeps");
  await expect(first(panes).message).toHaveValue("");
  await hui.sessionList();
  await expect(screen.getByLabel(/^Right running chat, status idle, tool durable, stage investigation, draft,/u)).toBeVisible();
  await expect(screen.getByLabel(/^Left running chat, .*draft/u)).toHaveCount(0);
});
