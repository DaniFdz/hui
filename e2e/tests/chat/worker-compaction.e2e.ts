/** Compaction on PI's worker holds the run, queues what is sent meanwhile and can be stopped, and a rewind across a summary keeps or drops it (CHAT-038, CHAT-040). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const LONG = `COMPACT_THREE${" kept".repeat(400)}`;

const chat = (screen: Screen) => ({
  message: screen.getByLabel("Message"),
  transcript: screen.getByTestId("transcript"),
  replies: screen.getByTestId("transcript").getByText("Fixture response."),
  marker: screen.getByTestId("transcript").getByLabel(/^Context compacted/u),
  idle: screen.getByLabel("Session status: Idle"),
});

async function open(screen: Screen, hui: Hui, title: string, tool?: "pi") {
  const session = await hui.createSession({ title, ...(tool ? { tool } : {}) });
  await hui.open(`/sessions/${session.id}`);
  await expect(chat(screen).idle).toBeVisible({ timeout: 30_000 });
}

async function submit(screen: Screen, text: string) {
  await chat(screen).message.fill(text);
  await screen.getByRole("button", "Send message").tap();
}

async function send(screen: Screen, text: string) {
  const { replies, idle } = chat(screen);
  const before = await replies.count();
  await submit(screen, text);
  await expect(replies).toHaveCount(before + 1);
  await expect(idle).toBeVisible();
}

async function rewindTo(screen: Screen, hui: Hui, turn: number, text: string) {
  const { transcript, message } = chat(screen);
  await hui.peek(transcript.getByText(text));
  await transcript.getByRole("button", "Rewind to here").nth(turn).tap();
  await expect(message).toHaveValue(text);
}

test("PI's worker holds the run while it compacts, queues what is sent meanwhile, and Stop cancels it without a marker", { tags: ["CHAT-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { message, transcript, replies, marker, idle } = chat(screen);
  const live = transcript.getByLabel("Compacting context…");
  const queue = screen.getByLabel("Queued messages");

  await open(screen, hui, "Worker compaction", "pi");
  await send(screen, "E2E_SLOW_COMPACT first turn");
  await send(screen, LONG);
  await submit(screen, "/compact keep the API decisions");
  await hui.provider.held();
  await expect(live).toBeVisible();
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeVisible();
  await expect(screen.getByLabel(/^Agent activity:/u)).toBeHidden();

  await message.fill("TYPED_DURING_COMPACTION");
  await screen.getByRole("button", "Steer message; touch and hold to enqueue").tap();
  await expect(queue.getByText("TYPED_DURING_COMPACTION")).toBeVisible();
  await expect(transcript.getByText("TYPED_DURING_COMPACTION")).toBeHidden();

  await hui.provider.release();
  await expect(marker).toBeVisible();
  await expect(replies).toHaveCount(3);
  await expect(transcript).toHaveText(/Context compacted.*TYPED_DURING_COMPACTION.*Fixture response\./su);
  await expect(idle).toBeVisible();
  await expect(queue).toBeHidden();
  await expect(live).toBeHidden();

  await send(screen, "E2E_SLOW_COMPACT again");
  await send(screen, LONG);
  await submit(screen, "/compact");
  await hui.provider.held();
  await expect(live).toBeVisible();
  await screen.getByRole("button", "Stop").tap();
  await expect(transcript.getByLabel("Compaction cancelled")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(marker).toHaveCount(1);
  await hui.reload();
  await expect(transcript.getByText("E2E_SLOW_COMPACT again")).toBeVisible();
  await expect(marker).toHaveCount(1);
});

test("an overflow on PI's worker compacts as Context is full, then retries the turn", { tags: ["CHAT-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { transcript, replies, marker, idle } = chat(screen);
  const full = transcript.getByLabel("Context is full · compacting…");

  await open(screen, hui, "Worker overflow", "pi");
  await send(screen, "E2E_SLOW_COMPACT first turn");
  await send(screen, LONG);
  await submit(screen, "E2E_OVERFLOW too much");
  await hui.provider.held();
  await expect(full).toBeVisible();
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeVisible();
  await expect(screen.getByLabel(/^Agent activity:/u)).toBeHidden();

  await hui.provider.release();
  await expect(marker).toBeVisible();
  await expect(replies).toHaveCount(3);
  await expect(idle).toBeVisible();
  await expect(full).toBeHidden();
});

test("on PI's worker a rewind into the kept turns keeps the summary, and one into the summarized turns restores them", { tags: ["CHAT-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { transcript, marker, idle } = chat(screen);
  const ask = "E2E_CONTEXT_HOLDS FIXTURE_SUMMARY COMPACT_ONE";

  await open(screen, hui, "Worker rewind", "pi");
  await send(screen, "COMPACT_ONE first turn");
  await send(screen, "COMPACT_TWO second turn");
  await send(screen, LONG);
  await submit(screen, "/fixture-compact");
  await expect(marker).toBeVisible();
  await transcript.getByText("Show summary").tap();
  await expect(transcript.getByText("FIXTURE_SUMMARY")).toBeVisible();

  await rewindTo(screen, hui, 2, LONG);
  await expect(marker).toBeVisible();
  await expect(transcript.getByText("COMPACT_TWO second turn")).toBeVisible();
  await submit(screen, ask);
  await expect(transcript.getByText("Earlier context: FIXTURE_SUMMARY yes, COMPACT_ONE no")).toBeVisible();
  await expect(idle).toBeVisible();

  await rewindTo(screen, hui, 1, "COMPACT_TWO second turn");
  await expect(marker).toBeHidden();
  await expect(transcript.getByText("COMPACT_ONE first turn")).toBeVisible();
  await submit(screen, ask);
  await expect(transcript.getByText("Earlier context: FIXTURE_SUMMARY no, COMPACT_ONE yes")).toBeVisible();
});

test("in a Durable session a rewind before the summary removes it, and the next request holds the turns up to there", { tags: ["CHAT-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { transcript, marker } = chat(screen);

  await open(screen, hui, "Durable rewind");
  await send(screen, "COMPACT_ONE first turn");
  await send(screen, "COMPACT_TWO second turn");
  await send(screen, LONG);
  await submit(screen, "/compact");
  await expect(marker).toBeVisible();

  await rewindTo(screen, hui, 2, LONG);
  await expect(marker).toBeHidden();
  await expect(transcript.getByText("COMPACT_TWO second turn")).toBeVisible();
  await submit(screen, "E2E_CONTEXT_HOLDS FIXTURE_SUMMARY COMPACT_ONE COMPACT_TWO");
  await expect(transcript.getByText("Earlier context: FIXTURE_SUMMARY no, COMPACT_ONE yes, COMPACT_TWO yes")).toBeVisible();
});
