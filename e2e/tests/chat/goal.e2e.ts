/** A goal is one objective a conversation keeps pursuing: /goal starts it, HUI continues it after a clean turn until
 * the goal pauses itself, and its Run status popover pauses, edits and clears it (CHAT-073). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openRunStatus } from "../agent/run-status.ts";

test("a goal starts from /goal, continues by itself, and pauses, edits and clears from its Run status popover", { tags: ["CHAT-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const trigger = screen.getByTestId("run-status-trigger");
  const popover = screen.getByLabel("Run status");
  // A wide window opens the popover itself while a turn streams and closes it again when that run ends.
  const openPanel = () => openRunStatus(screen);

  // Start a goal whose first turn the provider holds, so the operator can pause it while it runs.
  const paused = await hui.createSession({ title: "Paused goal" });
  await hui.open(`/sessions/${paused.id}`);
  await message.fill("/goal E2E_REPLAY get CI green on PR 1");
  await send.tap();
  await expect(transcript.getByText("E2E_REPLAY get CI green on PR 1")).toBeVisible();
  // A wide window opens the popover while this turn streams, so the header draws its panel rather than the pill; the
  // control is there either way, and its accessible name reads what the pill would.
  await expect(trigger).toBeAttached();
  await expect(trigger).toHaveAccessibleName(/^Run status: Working, goal pursuing/u);
  await openPanel();
  // The head says Working while the turn streams, so the Goal section is where the goal's own word is written, once.
  const pursuing = popover.getByText("Pursuing goal", { exact: true });
  await expect(pursuing).toHaveCount(1);
  await expect(pursuing).toBeVisible();
  await expect(popover).toContainText("E2E_REPLAY get CI green on PR 1");
  await popover.getByRole("button", "Pause goal").tap();
  await hui.provider.release();
  await expect(trigger).toHaveAccessibleName(/^Run status: Goal paused/u);
  // Pausing ended the run, so the panel it opened by itself closed with it; the operator opens it to read the pause.
  await openPanel();
  await expect(popover.getByRole("button", "Resume goal")).toBeVisible();
  // One state word per box: a paused goal alone in the panel names its state in the head — the pill's own word,
  // converted — so the Goal section is named by its title alone, prints no state, and the word appears exactly once.
  const goalSection = popover.getByRole("region", "Goal");
  await expect(goalSection).toBeVisible();
  await expect(popover.getByText("Goal paused", { exact: true })).toHaveCount(1);
  await expect(goalSection.getByText("Goal paused", { exact: true })).toHaveCount(0);
  // A paused goal is not pursued: no continuation turn is queued behind the paused run.
  await expect(transcript.getByText("Continue the goal", { exact: false })).toBeHidden();

  // The popover reads the whole objective and retypes it in place; saving starts the goal again and sends the new
  // objective as its next turn.
  await popover.getByRole("button", "Edit goal objective").tap();
  await expect(popover.getByLabel("Goal objective")).toHaveValue("E2E_REPLAY get CI green on PR 1");
  await popover.getByLabel("Goal objective").fill("E2E_REPLAY get CI green on PR 1 and the nightly job");
  await popover.getByRole("button", "Save goal").tap();
  await expect(popover.getByLabel("Goal objective")).toBeHidden();
  await expect(trigger).toHaveAccessibleName(/^Run status: Working, goal pursuing/u);
  await expect(transcript.getByText("and the nightly job", { exact: false })).toBeVisible();

  await openPanel();
  await popover.getByRole("button", "Clear goal").tap();
  await expect(trigger).toBeHidden();

  // A goal the operator leaves alone keeps working after each clean turn, and stops itself at the cap.
  const running = await hui.createSession({ title: "Running goal" });
  await hui.open(`/sessions/${running.id}`);
  await message.fill("/goal get the tests green");
  await send.tap();
  await expect(transcript.getByText("get the tests green")).toBeVisible();
  await expect(transcript.getByText("Continue the goal", { exact: false }).first()).toBeVisible();
  await expect(trigger).toHaveAccessibleName(/^Run status: Goal paused/u);
});
