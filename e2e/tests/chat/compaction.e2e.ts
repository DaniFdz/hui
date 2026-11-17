/**
 * /compact and Compact now summarize a Durable session beside the conversation, which stays Idle (CHAT-036, CHAT-039),
 * and CHAT-039 reads the meter's Session total as the ledger of model calls does: none recorded yet on a fresh session,
 * the calls a streaming run already committed, and the whole conversation once it settles.
 */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const LONG = `COMPACT_THREE ${"kept ".repeat(400)}`;

const chat = (screen: Screen) => ({
  message: screen.getByLabel("Message"),
  send: screen.getByRole("button", "Send message"),
  transcript: screen.getByTestId("transcript"),
  idle: screen.getByLabel("Session status: Idle"),
  compacted: screen.getByLabel(/^Context compacted, from \S+ tokens$/u),
});

async function startSession(screen: Screen, hui: Hui, title: string, turns: string[]) {
  const session = await hui.createSession({ title });
  for (const turn of turns) await hui.prompt(session, turn);
  await hui.open(`/sessions/${session.id}`);
  await expect(chat(screen).transcript.getByText("Fixture response.")).toHaveCount(turns.length);
  await expect(chat(screen).idle).toBeVisible();
  return session;
}

async function send(screen: Screen, text: string) {
  await chat(screen).message.fill(text);
  await chat(screen).send.tap();
}

test("/compact with focus text adds a Context compacted divider after the last turn, keeps every turn above it and shows the summary, while the session stays Idle; with attachments it is refused", { tags: ["CHAT-036"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { message, transcript, idle, compacted } = chat(screen);
  await startSession(screen, hui, "Compact a session", ["COMPACT_ONE first turn E2E_SLOW_COMPACT", "COMPACT_TWO second turn", LONG]);

  await message.fill("/compact keep the API decisions");
  await hui.attach(screen.getByLabel("Choose files"), ["notes.txt"]);
  await chat(screen).send.tap();
  await expect(screen.getByText("Use /compact without attachments.")).toBeVisible();
  await expect(message).toHaveValue("/compact keep the API decisions");
  await screen.getByRole("button", "Remove notes.txt").tap();

  await chat(screen).send.tap();
  await hui.provider.held();
  await expect(screen.getByLabel("Compacting context…")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeHidden();
  await hui.provider.release();
  await expect(compacted).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(transcript).toHaveText(/COMPACT_ONE first turn.*COMPACT_TWO second turn.*COMPACT_THREE.*Fixture response\..*Context compacted · from \S+ tokens\s*Show summary\s*$/su);
  await expect(transcript.getByText("FIXTURE_SUMMARY")).toBeHidden();
  await transcript.getByText("Show summary").tap();
  await expect(transcript.getByText("FIXTURE_SUMMARY")).toBeVisible();
});

test("The context ring opens Context usage with occupancy over the estimate of what it carries, the latest run's tokens, cost and Compact now, disabled while busy and absent in a bot's chat; with nothing new to summarize a Compaction failed divider stays until the next turn", { tags: ["CHAT-039"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { transcript, idle } = chat(screen);
  const ring = screen.getByLabel(/^Context window: \d+% used$/u);
  const usage = screen.getByLabel("Context usage");
  const compactNow = usage.getByRole("button", "Compact now");
  const failed = screen.getByLabel("Compaction failed");

  // A session that has made no model call says so instead of reading as a zero total: its ledger is empty, and the
  // latest run's figures are not the total. Its ring has no occupancy to show yet, so it names its window alone.
  const fresh = await hui.createSession({ title: "Nothing spent yet" });
  await hui.open(`/sessions/${fresh.id}`);
  const emptyRing = screen.getByLabel(/^Context window: .*usage unavailable$/u);
  await expect(emptyRing).toBeVisible();
  await emptyRing.tap();
  await expect(usage).toBeVisible();
  await expect(usage).toContainText(/Session total All model calls No calls recorded yet Checked (?:just now|\d+[sm] ago)/iu);
  await expect(usage).not.toContainText(/\b0 tokens/u);
  await expect(usage).not.toContainText("Latest run tokens");
  await emptyRing.tap();
  await expect(usage).toBeHidden();

  const session = await startSession(screen, hui, "Check context usage", ["A short turn"]);

  await ring.tap();
  await expect(usage).toHaveText(/Context window\s*\S+ \/ \S+ · \d+%.*System prompt\s+\S+\s+\d+%.*Tool definitions\s+\d[\d,]* tools\s+\S+\s+\d+%.*Conversation\s+\d+ messages\s+\S+\s+\d+%.*Category breakdown is estimated.*Session total\s*All model calls\s*\S+ tokens · \$\d+\.\d\d\s*Checked\s*.+?\s*Compact now/isu);
  await expect(compactNow).toBeEnabled();
  await compactNow.tap();
  await expect(chat(screen).compacted).toBeVisible();
  await ring.tap();
  await compactNow.tap();
  await expect(failed).toBeVisible();
  await expect(transcript).toHaveText(/Compaction failed\s*Nothing to compact \(session too small\)\s*$/su);
  await expect(idle).toBeVisible();

  await send(screen, "E2E_REPLAY");
  await hui.provider.held();
  await expect(screen.getByRole("button", "Stop")).toBeVisible();
  await expect(failed).toBeHidden();
  await ring.tap();
  await expect(compactNow).toBeDisabled();
  await ring.tap();
  await hui.provider.release();
  await expect(idle).toBeVisible();

  // The ledger's total shows what this run already committed while its tool is still running, not only once it settles.
  const held = await hui.holdTool(session, "fixture_echo", { text: "held for the meter" });
  await expect(screen.getByRole("button", "Stop")).toBeVisible();
  await ring.tap();
  await expect(usage).toBeVisible();
  await expect(usage).toContainText(/Session total All model calls \S+ tokens · \$0\.00 Checked (?:just now|\d+[sm] ago)/iu);
  await expect(usage).not.toContainText("No calls recorded yet");
  await expect(usage).not.toContainText("unpriced");
  await expect(compactNow).toBeDisabled();
  await held.release();
  await expect(idle).toBeVisible();

  const { bot } = await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Meter Bot", soul: "A test bot." });
  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByText("Say hi to Meter Bot")).toBeVisible();
  await screen.getByLabel(/^Context (window: |usage unavailable)/u).tap();
  await expect(usage.getByText("Context window")).toBeVisible();
  await expect(compactNow).toBeHidden();
  await expect(usage).toHaveText(/Bot cost\s*(Chat, subagents and memory|Includes .*|Kept on|Reading|Could not read)\s*(Not reported|\$\d+\.\d\d|cost…|Unavailable)/iu);
});
