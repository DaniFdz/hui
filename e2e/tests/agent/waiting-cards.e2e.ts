/** A question or secret card that waits for the operator ends with Stop and survives a reload (AGENT-007, AGENT-008). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const QUESTIONS = `E2E_CALL:${Buffer.from(JSON.stringify({ name: "ask_user_question", input: { questions: [
  { header: "Scope", question: "What should the first release cover?", options: [{ label: "Reading", description: "List and show only." }, { label: "Writing", description: "Create and edit too." }] },
  { header: "Deploy", question: "Where should it run first?", options: [{ label: "Staging", description: "Behind the VPN." }, { label: "Production", description: "Public." }] },
] } })).toString("base64url")}`;

const send = async (hui: Hui, screen: Screen, title: string, prompt: string) => {
  const session = await hui.createSession({ title });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill(prompt);
  await screen.getByRole("button", "Send message").tap();
};

test("Stop closes a waiting question or secret card and leaves the session idle", { tags: ["AGENT-007"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByTestId("question-card");
  const idle = screen.getByLabel("Session status: Idle");
  const before = await hui.secretDirectories();

  for (const [title, prompt, shown, tool] of [
    ["Question stopped", QUESTIONS, "What should the first release cover?", "ask_user_question"],
    ["Secret stopped", "E2E_SECRET_REQUEST", "Fixture API key", "secret_request"],
  ] as const) {
    await send(hui, screen, title, prompt);
    await expect(card.getByText(shown)).toBeVisible();
    await screen.getByRole("button", "Stop").tap();
    await expect(idle).toBeVisible();
    await expect(card).toBeHidden();
    await hui.reload();
    await expect(idle).toBeVisible();
    await expect(card).toBeHidden();
    await transcript.getByText("Ran 1 command").tap();
    await transcript.getByText("Failed").tap();
    await expect(transcript.getByText(`<harness> [error] Tool ${tool} was aborted </harness>`)).toBeVisible();
  }
  expect((await hui.secretDirectories()).filter((name) => !before.includes(name))).toEqual([]);
});

test("a reload shows the waiting question card from its first question, and the secret card again", { tags: ["AGENT-008"], platforms: ["web"] }, async ({ screen, hui }) => {
  const card = screen.getByTestId("question-card");
  const waiting = screen.getByLabel("Session status: Waiting for your answer");

  await send(hui, screen, "Question reloaded", QUESTIONS);
  await card.getByTestId("question-option").filter({ hasText: "Writing" }).tap();
  await card.getByRole("button", "Next").tap();
  await expect(card.getByText("Where should it run first?")).toBeVisible();
  await hui.reload();
  await expect(card.getByText("What should the first release cover?")).toBeVisible();
  await expect(card.getByText("1/2")).toBeVisible();
  await expect(waiting).toBeVisible();

  await send(hui, screen, "Secret reloaded", "E2E_SECRET_REQUEST");
  await expect(card.getByText("Fixture API key")).toBeVisible();
  await hui.reload();
  await expect(card.getByText("Fixture API key")).toBeVisible();
  await expect(card.getByLabel("Value")).toBeVisible();
  await expect(waiting).toBeVisible();
});
