/** The question card answers from the keyboard, and Escape declines it without stopping the run (AGENT-005). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const ask = (questions: { header: string; question: string; multiSelect?: boolean; options: string[] }[]) => `E2E_CALL:${Buffer.from(JSON.stringify({
  name: "ask_user_question",
  input: { questions: questions.map(({ options, ...question }) => ({ ...question, options: options.map((label) => ({ label, description: `${label}, described.` })) })) },
})).toString("base64url")}`;

test("number keys, arrows, Space and Enter answer the card, and Escape declines it", { tags: ["AGENT-005"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByTestId("question-card");
  const row = (role: "radio" | "checkbox", label: string) => card.getByRole(role, new RegExp(`^${label} `, "u"));
  const typed = card.getByRole("textbox", "Your own answer");
  const session = await hui.createSession({ title: "Keyboard answers" });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill(ask([
    { header: "Scope", question: "What should the first release cover?", options: ["Reading", "Writing"] },
    { header: "Checks", question: "Which checks should run?", multiSelect: true, options: ["Lint", "Unit tests", "Browser tests"] },
    { header: "Deploy", question: "Where should it run first?", options: ["Staging", "Production"] },
  ]));
  await screen.getByRole("button", "Send message").tap();

  await expect(row("radio", "Reading")).toBeFocused();
  await row("radio", "Reading").press("2");
  await expect(row("radio", "Writing")).toBeChecked();
  await expect(row("radio", "Writing")).toBeFocused();
  await row("radio", "Writing").press("3");
  await expect(typed).toBeFocused();
  await typed.press("ArrowUp");
  await expect(row("radio", "Writing")).toBeFocused();
  await row("radio", "Writing").press("ArrowUp");
  await expect(row("radio", "Reading")).toBeFocused();
  await expect(row("radio", "Writing")).toBeChecked();
  await row("radio", "Reading").press("ArrowRight");
  await expect(card.getByText("2/3")).toBeVisible();
  await expect(row("checkbox", "Lint")).toBeFocused();
  await row("checkbox", "Lint").press("Space");
  await row("checkbox", "Lint").press("ArrowDown");
  await expect(row("checkbox", "Unit tests")).toBeFocused();
  await row("checkbox", "Unit tests").press("Space");
  await expect(row("checkbox", "Unit tests")).toBeChecked();
  await row("checkbox", "Unit tests").press("Space");
  await expect(row("checkbox", "Unit tests")).toBeChecked({ checked: false });
  await expect(row("checkbox", "Lint")).toBeChecked();
  await row("checkbox", "Unit tests").press("ArrowLeft");
  await expect(card.getByText("1/3")).toBeVisible();
  await expect(row("radio", "Writing")).toBeFocused();
  await row("radio", "Writing").press("Enter");
  await expect(card.getByText("2/3")).toBeVisible();
  await expect(row("checkbox", "Lint")).toBeFocused();
  await card.getByRole("button", "Back").press("ControlOrMeta+Enter");
  await expect(card.getByText("3/3")).toBeVisible();
  await expect(row("radio", "Staging")).toBeFocused();
  await row("radio", "Staging").press("ArrowDown");
  await expect(row("radio", "Production")).toBeFocused();
  await row("radio", "Production").press("Enter");
  await expect(card).toBeHidden();
  await expect(transcript.getByText('tool answered: User has answered your questions: "What should the first release cover?"="Writing". "Which checks should run?"="Lint". "Where should it run first?"="Production". You can now continue with the user\'s answers in mind.')).toBeVisible();

  await screen.getByLabel("Message").fill(ask([{ header: "Scope", question: "What should the next release cover?", options: ["Reading", "Writing"] }]));
  await screen.getByRole("button", "Send message").tap();
  await typed.fill("Only the API");
  await typed.press("Escape");
  await expect(row("radio", "Reading")).toBeFocused();
  await expect(card.getByText("What should the next release cover?")).toBeVisible();
  await row("radio", "Reading").press("Escape");
  await expect(card).toBeHidden();
  await expect(transcript.getByText("tool answered: User declined to answer questions")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
