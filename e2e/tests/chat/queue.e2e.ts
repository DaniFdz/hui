/** While a run is busy, Send steers it and holding Send enqueues follow-ups, which can be edited, removed, reordered and sent now (CHAT-005 to CHAT-008, CHAT-010). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const chat = (screen: Screen) => ({
  message: screen.getByLabel("Message"),
  steer: screen.getByRole("button", "Steer message; touch and hold to enqueue"),
  enqueue: screen.getByText("Enqueue"),
  queue: screen.getByLabel("Queued messages"),
  transcript: screen.getByTestId("transcript"),
  idle: screen.getByLabel("Session status: Idle"),
});

async function startHeldRun(screen: Screen, hui: Hui, title: string) {
  const session = await hui.createSession({ title });
  await hui.open(`/sessions/${session.id}`);
  await expect(chat(screen).idle).toBeVisible();
  await chat(screen).message.fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
}

async function enqueue(screen: Screen, hui: Hui, text: string) {
  const { message, steer, enqueue: menu, queue } = chat(screen);
  await message.fill(text);
  await hui.hold(steer, menu);
  await menu.tap();
  await expect(queue.getByText(text)).toBeVisible();
}

test("Send steers a busy run, and PI takes the steer before a follow-up queued ahead of it", { tags: ["CHAT-005"] }, async ({ screen, hui }) => {
  const { message, steer, queue, transcript, idle } = chat(screen);

  await startHeldRun(screen, hui, "Steer a run");
  await enqueue(screen, hui, "Queued before the steer");
  await message.fill("Use tabs, not spaces");
  await steer.tap();
  await expect.poll(() => hui.textOf(queue)).toMatch(/^\s*Use tabs, not spaces\s*Steer\s*Queued before the steer\s*Follow up/u);
  await expect(queue.getByRole("button", "Edit queued message")).toHaveCount(1);
  await expect(message).toHaveValue("");
  await message.fill("The next draft");
  await expect(message).toHaveValue("The next draft");
  await expect(transcript.getByText("Use tabs, not spaces")).toBeHidden();

  await hui.provider.release();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect.poll(() => hui.textOf(transcript)).toMatch(/Replay prefix — replay suffix.*Use tabs, not spaces.*Fixture response\..*Queued before the steer.*Fixture response\./su);
  await expect(idle).toBeVisible();
  await expect(queue).toBeHidden();
  await expect(message).toHaveValue("The next draft");
});

test("Holding Send enqueues follow-ups, which PI takes in order once the run settles", { tags: ["CHAT-006"] }, async ({ screen, hui }) => {
  const { queue, transcript, idle } = chat(screen);

  await startHeldRun(screen, hui, "Queue follow-ups");
  await enqueue(screen, hui, "E2E_REPLAY first follow-up");
  await enqueue(screen, hui, "Second follow-up");
  await expect.poll(() => hui.textOf(queue)).toMatch(/E2E_REPLAY first follow-up\s*Follow up.*Second follow-up\s*Follow up/su);
  await expect(transcript.getByText("E2E_REPLAY first follow-up")).toBeHidden();

  await hui.provider.release();
  await hui.provider.held();
  await expect(transcript.getByText("E2E_REPLAY first follow-up")).toBeVisible();
  await expect.poll(() => hui.textOf(queue)).toMatch(/^\s*Second follow-up\s*Follow up/u);
  await expect(transcript.getByText("Second follow-up")).toBeHidden();

  await hui.provider.release();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect.poll(() => hui.textOf(transcript)).toMatch(/E2E_REPLAY first follow-up.*Replay prefix — replay suffix.*Second follow-up.*Fixture response\./su);
  await expect(transcript.getByText("Replay prefix — replay suffix")).toHaveCount(2);
  await expect(idle).toBeVisible();
  await expect(queue).toBeHidden();
});

test("A follow-up opens in an editor from Edit or a double click, saves or cancels, and can be removed; a Steer row can't be edited", { tags: ["CHAT-007"] }, async ({ screen, hui }) => {
  const { message, steer, queue, transcript, idle } = chat(screen);
  const editor = queue.getByRole("textbox", "Edit queued message");
  const edits = queue.getByRole("button", "Edit queued message");
  const removals = queue.getByRole("button", "Remove queued message");

  await startHeldRun(screen, hui, "Edit the queue");
  await message.fill("A steer");
  await steer.tap();
  await enqueue(screen, hui, "Original follow-up");
  await enqueue(screen, hui, "Doomed follow-up");
  await expect(edits).toHaveCount(2);
  await expect(removals).toHaveCount(2);

  await edits.first().tap();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("Original follow-up");
  await expect(queue.getByRole("button", "Cancel edit")).toBeVisible();
  await editor.fill("Edited follow-up");
  await queue.getByRole("button", "Save queued message").tap();
  await expect(queue.getByText("Edited follow-up")).toBeVisible();
  await expect(editor).toBeHidden();

  await queue.getByText("A steer").doubleTap();
  await queue.getByText("Doomed follow-up").doubleTap();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("Doomed follow-up");
  await queue.getByRole("button", "Cancel edit").tap();
  await expect(queue.getByText("Doomed follow-up")).toBeVisible();
  await expect(editor).toBeHidden();

  await removals.nth(1).tap();
  await expect(removals).toHaveCount(1);
  await expect(queue.getByText("Doomed follow-up")).toBeHidden();

  const rejected = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/queue$/u);
  await removals.tap();
  await rejected.reject(409, "That queued message is no longer available.");
  await expect(screen.getByText("That queued message is no longer available.")).toBeVisible();
  await expect(queue.getByText("Edited follow-up")).toBeVisible();

  await hui.provider.release();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect.poll(() => hui.textOf(transcript)).toMatch(/A steer.*Fixture response\..*Edited follow-up.*Fixture response\./su);
  await expect(idle).toBeVisible();
  await expect(transcript.getByText("Original follow-up")).toBeHidden();
  await expect(transcript.getByText("Doomed follow-up")).toBeHidden();
});

test("Dragging a follow-up by its handle onto another row reorders the queue and the order PI takes them in", { tags: ["CHAT-008"] }, async ({ screen, hui }) => {
  const { queue, transcript, idle } = chat(screen);

  await startHeldRun(screen, hui, "Reorder the queue");
  await enqueue(screen, hui, "First follow-up");
  await enqueue(screen, hui, "Second follow-up");
  await queue.getByRole("button", "Reorder queued message").nth(1).dragTo(queue.getByText("First follow-up"));
  await expect.poll(() => hui.textOf(queue)).toMatch(/Second follow-up.*First follow-up/su);

  await hui.provider.release();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect.poll(() => hui.textOf(transcript)).toMatch(/Replay prefix — replay suffix.*Second follow-up.*Fixture response\..*First follow-up.*Fixture response\./su);
  await expect(idle).toBeVisible();
  await expect(queue).toBeHidden();
});

test("Steer queued message sends a follow-up into the running turn, ahead of the follow-ups that wait for the run to end", { tags: ["CHAT-010"] }, async ({ screen, hui }) => {
  const { queue, transcript, idle } = chat(screen);

  await startHeldRun(screen, hui, "Send a follow-up now");
  await enqueue(screen, hui, "First follow-up");
  await enqueue(screen, hui, "Urgent follow-up");
  await queue.getByRole("button", "Steer queued message").nth(1).tap();
  await expect.poll(() => hui.textOf(queue)).toMatch(/^\s*Urgent follow-up\s*Steer\s*First follow-up\s*Follow up/u);

  await hui.provider.release();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect.poll(() => hui.textOf(transcript)).toMatch(/Replay prefix — replay suffix.*Urgent follow-up.*Fixture response\..*First follow-up.*Fixture response\./su);
  await expect(idle).toBeVisible();
  await expect(queue).toBeHidden();
});
