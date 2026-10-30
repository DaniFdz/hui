/** Pending question, secret and suggestion cards live in gateway memory: a restart ends the waiting calls and none of the cards comes back (AGENT-021). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const ASK = `E2E_CALL:${Buffer.from(JSON.stringify({
  name: "ask_user_question",
  input: {
    questions: [{
      header: "Database",
      question: "Which database should the service use?",
      options: [{ label: "Postgres", description: "Relational, already deployed." }, { label: "SQLite", description: "One file, no server." }],
    }],
  },
})).toString("base64url")}`;

test("a gateway restart ends the waiting question, secret and suggestion cards and brings none of them back", { tags: ["AGENT-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByTestId("question-card");
  const suggestion = screen.getByText("Suggested task", { exact: false });
  const waiting = screen.getByLabel("Session status: Waiting for your answer");
  const idle = screen.getByLabel("Session status: Idle");
  const interrupted = (start: string, tool: string) =>
    transcript.getByText(new RegExp(`^${start}[\\s\\S]*Tool ${tool} was interrupted and may have partially run`, "u"));

  const question = await hui.createSession({ title: "Pending question" });
  await hui.open(`/sessions/${question.id}`);
  await hui.prompt(question, ASK);
  await expect(card.getByText("Database")).toBeVisible();
  await expect(waiting).toBeVisible();

  const secret = await hui.createSession({ title: "Pending secret" });
  await hui.open(`/sessions/${secret.id}`);
  await hui.prompt(secret, "E2E_SECRET_REQUEST");
  await expect(card.getByText("Fixture API key")).toBeVisible();
  await expect(waiting).toBeVisible();

  const suggested = await hui.createSession({ title: "Pending suggestion" });
  await hui.open(`/sessions/${suggested.id}`);
  await hui.prompt(suggested, "E2E_SUGGEST_TASK");
  await expect(suggestion).toHaveCount(1);
  await expect(transcript.getByText("I flagged two follow-ups as suggestion cards instead of doing them now.")).toBeVisible();

  await hui.restartGateway();
  await hui.reload();

  await hui.open(`/sessions/${question.id}`);
  await expect(idle).toBeVisible();
  await transcript.getByText("Used 1 tool").tap();
  const asked = transcript.getByRole("button", /^Used ask user question/u);
  await asked.tap();
  await expect(asked.getByLabel("Failed")).toBeVisible();
  await expect(interrupted("tool answered: ", "ask_user_question")).toBeVisible();
  await expect(card).toBeHidden();

  await hui.open(`/sessions/${secret.id}`);
  await expect(idle).toBeVisible();
  await transcript.getByText("Used 1 tool").tap();
  const request = transcript.getByRole("button", /^Used secret request/u);
  await request.tap();
  await expect(interrupted("No secret to use: ", "secret_request")).toBeVisible();
  await expect(card).toBeHidden();

  await hui.open(`/sessions/${suggested.id}`);
  await expect(idle).toBeVisible();
  await expect(transcript.getByText("I flagged two follow-ups as suggestion cards instead of doing them now.")).toBeVisible();
  await expect(suggestion).toHaveCount(0);
});
