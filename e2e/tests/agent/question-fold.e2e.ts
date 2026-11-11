/** The web question card folds to one row so the operator can read the conversation it covers, and opens again at the same question with every pick (AGENT-063). */
import { expect, type Locator } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Question = { header: string; question: string; options: { label: string; description: string }[] };

const ask = (...questions: Question[]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify({ name: "ask_user_question", input: { questions } })).toString("base64url")}`;

const SLICE: Question = {
  header: "First scope",
  question: "Which slice should I build first?",
  options: [
    { label: "OAuth image tool", description: "Reuses HUI's existing OAuth credentials and returns results through presented-media." },
    { label: "Skill only", description: "Documents the provider keys and the fetch recipe, with no new authentication surface." },
    { label: "API-key tool", description: "Calls the image and video APIs with the operator's own key." },
    { label: "Both in one PR", description: "One tool with both providers behind a registry." },
  ],
};
const MODELS: Question = {
  header: "Models",
  question: "Which models should the tool offer?",
  options: [
    { label: "gpt-image-1", description: "The default." },
    { label: "gpt-image-1-mini", description: "Cheaper and faster." },
    { label: "Whatever the key allows", description: "Read the key's model list." },
  ],
};
const VIDEO: Question = {
  header: "Video",
  question: "Should the first slice record video?",
  options: [
    { label: "Image only", description: "Decide video after the shape is proven." },
    { label: "Veo 3 too", description: "A long-running job with polling." },
  ],
};

const box = async (target: Locator) => (await target.boundingBox())!;
const asked = async (hui: Hui, prompt: string) => {
  const session = await hui.createSession({ title: "Folded questions" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, prompt);
};

test("the question card folds to one row to show the conversation, and opens again with its picks", { tags: ["AGENT-063"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByTestId("question-card");
  const message = screen.getByLabel("Message");
  const option = (label: string) => card.getByTestId("question-option").filter({ hasText: label });
  const fold = card.getByTestId("question-fold");
  const bar = card.getByTestId("question-unfold");
  await asked(hui, ask(SLICE, MODELS, VIDEO));

  await expect(card.getByText("STEP 1 OF 3")).toBeVisible();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  // The open card covers a good part of the conversation, which is why it folds.
  expect((await box(card)).height).toBeGreaterThan(300);
  const openTranscript = (await box(transcript)).height;
  await option("API-key tool").tap();
  await expect(option("API-key tool")).toBeChecked();

  await fold.tap();
  await expect(bar).toBeVisible();
  await expect(bar).toBeFocused();
  await expect(bar).toHaveAttribute("aria-expanded", "false");
  await expect(card.getByText("1 answered")).toBeVisible();
  await expect(card.getByText("1/3")).toBeVisible();
  await expect.poll(async () => (await box(card)).height).toBeLessThanOrEqual(60);
  // The conversation takes back the room the card was covering.
  await expect.poll(async () => (await box(transcript)).height).toBeGreaterThanOrEqual(openTranscript + 200);

  // It stays folded while the operator writes in the composer.
  await message.fill("a draft waiting for the answer");
  await expect(bar).toBeVisible();
  await expect(card.getByText("Which slice should I build first?")).toBeHidden();
  await message.fill("");

  // Escape opens the card again instead of declining the questions, where the operator left it.
  await bar.press("Escape");
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByText("STEP 1 OF 3")).toBeVisible();
  await expect(option("API-key tool")).toBeChecked();
  await expect(transcript.getByText("You declined to answer.")).toBeHidden();

  // So does the bar itself, from the keyboard.
  await fold.tap();
  await expect(bar).toBeVisible();
  await bar.press("Enter");
  await expect(card.getByText("Which slice should I build first?")).toBeVisible();
  await expect(option("API-key tool")).toBeChecked();

  // Folding between questions keeps every answer and the position.
  await card.getByRole("button", "Next").tap();
  await expect(card.getByText("STEP 2 OF 3")).toBeVisible();
  await option("gpt-image-1-mini").tap();
  await fold.tap();
  await expect(card.getByText("2 answered")).toBeVisible();
  await expect(card.getByText("2/3")).toBeVisible();
  await bar.tap();
  await expect(card.getByText("STEP 2 OF 3")).toBeVisible();
  await expect(option("gpt-image-1-mini")).toBeChecked();
  await card.getByRole("button", "Next").tap();
  await option("Image only").tap();
  await fold.tap();
  await expect(card.getByText("3 answered")).toBeVisible();
  await bar.tap();
  await card.getByRole("button", "Submit").tap();

  await expect(transcript.getByText('tool answered: User has answered your questions: "Which slice should I build first?"="API-key tool". "Which models should the tool offer?"="gpt-image-1-mini". "Should the first slice record video?"="Image only". You can now continue with the user\'s answers in mind.')).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
