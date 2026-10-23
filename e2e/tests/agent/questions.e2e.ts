/** An agent's ask_user_question call opens one card above the composer, and what the operator picks, types or declines reaches the agent (AGENT-001, AGENT-002, AGENT-003, AGENT-004, AGENT-006, AGENT-009, AGENT-010, AGENT-011). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Question = { header: string; question: string; multiSelect?: boolean; options: { label: string; description: string; preview?: string }[] };

const ask = (...calls: Question[][]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify(calls.map((questions) => ({ name: "ask_user_question", input: { questions } })))).toString("base64url")}`;

const DATABASE: Question = {
  header: "Database",
  question: "Which database should the service use?",
  options: [
    { label: "Postgres", description: "Relational, already deployed." },
    { label: "SQLite", description: "One file, no server." },
  ],
};

const box = async (target: Locator) => (await target.boundingBox())!;

const openSession = async (hui: Hui, title: string) => {
  const session = await hui.createSession({ title });
  await hui.open(`/sessions/${session.id}`);
  return session;
};

const asked = async (hui: Hui, screen: Screen, title: string, prompt: string) => {
  const session = await openSession(hui, title);
  await expect(screen.getByLabel("Message")).toBeVisible();
  await hui.prompt(session, prompt);
};

test("one question's card takes a pick or typed text and leaves a summary", { tags: ["AGENT-001"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByTestId("question-card");
  const option = (label: string) => card.getByTestId("question-option").filter({ hasText: label });
  const submit = card.getByRole("button", "Submit");
  await asked(hui, screen, "One question", ask([DATABASE]));

  await expect(screen.getByLabel("Session status: Waiting for your answer")).toBeVisible();
  await expect(card).toHaveCount(1);
  expect((await card.boundingBox())!.y + (await card.boundingBox())!.height).toBeLessThanOrEqual((await screen.getByLabel("Message").boundingBox())!.y);
  await expect(card.getByText("Database")).toBeVisible();
  await expect(card.getByText("1/1")).toBeVisible();
  await expect(card.getByText("Which database should the service use?")).toBeVisible();
  await expect(option("Postgres").getByText("Relational, already deployed.")).toBeVisible();
  await expect(option("Postgres").getByText("1")).toBeVisible();
  await expect(option("SQLite").getByText("One file, no server.")).toBeVisible();
  await expect(option("SQLite").getByText("2")).toBeVisible();
  await expect(card.getByPlaceholder("Type something…")).toBeVisible();
  await expect(card.getByText("3")).toBeVisible();
  await expect(submit).toBeDisabled();

  await option("Postgres").tap();
  await expect(option("Postgres")).toBeChecked();
  await expect(submit).toBeEnabled();
  await option("SQLite").tap();
  await expect(option("SQLite")).toBeChecked();
  await expect(option("Postgres")).toBeChecked({ checked: false });
  await card.getByLabel("Your own answer").fill("MySQL, as the team knows it");
  await expect(option("SQLite")).toBeChecked({ checked: false });
  await submit.tap();

  await expect(card).toBeHidden();
  await expect(transcript.getByText('tool answered: User has answered your questions: "Which database should the service use?"="MySQL, as the team knows it". You can now continue with the user\'s answers in mind.')).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const summary = transcript.getByLabel("Your answers");
  await expect(summary.getByText("Database")).toBeVisible();
  await expect(summary.getByText("MySQL, as the team knows it")).toBeVisible();

  await asked(hui, screen, "Typed answer", ask([DATABASE]));
  await expect(submit).toBeDisabled();
  await card.getByLabel("Your own answer").fill("DynamoDB");
  await expect(submit).toBeEnabled();
});

const SCOPE: Question = {
  header: "Scope",
  question: "What should the first release cover?",
  options: [
    { label: "Reading", description: "List and show only." },
    { label: "Writing", description: "Create and edit too." },
  ],
};
const DEPLOY: Question = {
  header: "Deploy",
  question: "Where should it run first?",
  options: [
    { label: "Staging", description: "Behind the VPN." },
    { label: "Production", description: "Public." },
  ],
};
const NOTES: Question = {
  header: "Notes",
  question: "Anything else to keep in mind?",
  options: [
    { label: "Nothing", description: "Go ahead." },
    { label: "Later", description: "I'll say when." },
  ],
};

test("four questions share one card whose chips, Next and Back keep the answers", { tags: ["AGENT-002"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByTestId("question-card");
  const option = (label: string) => card.getByTestId("question-option").filter({ hasText: label });
  const chip = (name: string) => card.getByRole("tab", name);
  await asked(hui, screen, "Four questions", ask([SCOPE, DATABASE, DEPLOY, NOTES]));

  await expect(card.getByText("Questions")).toBeVisible();
  await expect(card.getByText("1/4")).toBeVisible();
  for (const header of ["Scope", "Database", "Deploy", "Notes"]) await expect(chip(header)).toBeVisible();
  await expect(chip("Scope")).toBeSelected();
  await expect(card.getByText("What should the first release cover?")).toBeVisible();
  await option("Writing").tap();
  await expect(chip("Scope (answered)").getByText("✓")).toBeVisible();

  await card.getByRole("button", "Next").tap();
  await expect(card.getByText("2/4")).toBeVisible();
  await expect(chip("Database")).toBeSelected();
  await card.getByLabel("Your own answer").fill("CockroachDB");
  await expect(chip("Database (answered)")).toBeVisible();
  await card.getByRole("button", "Back").tap();
  await expect(card.getByText("1/4")).toBeVisible();
  await expect(option("Writing")).toBeChecked();
  await chip("Database (answered)").tap();
  await expect(card.getByText("2/4")).toBeVisible();
  await expect(card.getByLabel("Your own answer")).toHaveValue("CockroachDB");
  await card.getByRole("button", "Next").tap();
  await expect(card.getByText("Where should it run first?")).toBeVisible();
  await chip("Notes").tap();
  await expect(card.getByText("4/4")).toBeVisible();
  await expect(card.getByRole("button", "Next")).toBeHidden();
  await card.getByRole("button", "Submit").tap();

  await expect(transcript.getByText('tool answered: User has answered your questions: "What should the first release cover?"="Writing". "Which database should the service use?"="CockroachDB". You can now continue with the user\'s answers in mind.')).toBeVisible();
  const summary = transcript.getByLabel("Your answers");
  await expect(summary.getByText("Writing")).toBeVisible();
  await expect(summary.getByText("CockroachDB")).toBeVisible();
  await expect(summary.getByText("Deploy")).toBeHidden();
  await expect(summary.getByText("Notes")).toBeHidden();
});

test("a multi-select question takes several picks and typed text", { tags: ["AGENT-003"] }, async ({ screen, hui }) => {
  const card = screen.getByTestId("question-card");
  const option = (label: string) => card.getByTestId("question-option").filter({ hasText: label });
  await asked(hui, screen, "Several answers", ask([{
    header: "Checks",
    question: "Which checks should run before merging?",
    multiSelect: true,
    options: [
      { label: "Lint", description: "Style and types." },
      { label: "Unit tests", description: "The fast suite." },
      { label: "Browser tests", description: "The slow suite." },
    ],
  }]));

  await expect(card.getByText("Choose all that apply.")).toBeVisible();
  await option("Browser tests").tap();
  await option("Lint").tap();
  await option("Unit tests").tap();
  await option("Unit tests").tap();
  await expect(option("Browser tests")).toBeChecked();
  await expect(option("Lint")).toBeChecked();
  await expect(option("Unit tests")).toBeChecked({ checked: false });
  await card.getByLabel("Your own answer").fill("A smoke run");
  await expect(option("Lint")).toBeChecked();
  await card.getByRole("button", "Submit").tap();

  await expect(screen.getByTestId("transcript").getByText('tool answered: User has answered your questions: "Which checks should run before merging?"="Lint, Browser tests, A smoke run". You can now continue with the user\'s answers in mind.')).toBeVisible();
});

test("the focused option's preview shows beside the options, under them on a phone, and reaches the agent", { tags: ["AGENT-004"], platforms: ["web"] }, async ({ screen, hui }) => {
  const card = screen.getByTestId("question-card");
  const option = (label: string) => card.getByTestId("question-option").filter({ hasText: label });
  const preview = card.getByLabel("Preview");
  await asked(hui, screen, "Previews", ask([{
    header: "Layout",
    question: "Which layout should the settings page use?",
    options: [
      { label: "Sidebar", description: "Sections in a left column.", preview: "Sections on the left.\n\n**Sidebar layout**" },
      { label: "Tabs", description: "Sections as tabs.", preview: `Tabs across the top.\n\n**Tabs layout**\n\n${Array.from({ length: 40 }, (_, index) => `- Tab line ${index + 1}`).join("\n")}` },
    ],
  }]));

  await expect(preview.getByText("Sidebar layout")).toBeVisible();
  expect((await box(preview)).x).toBeGreaterThanOrEqual((await box(option("Sidebar"))).x + (await box(option("Sidebar"))).width);
  await option("Tabs").tap();
  await expect(preview.getByText("Tabs layout")).toBeVisible();
  await expect(preview.getByText("Sidebar layout")).toBeHidden();
  const last = preview.getByText("Tab line 40");
  expect((await box(last)).y).toBeGreaterThan((await box(preview)).y + (await box(preview)).height);
  await last.scrollIntoView();
  expect((await box(last)).y + (await box(last)).height).toBeLessThanOrEqual((await box(preview)).y + (await box(preview)).height);

  await hui.phoneScreen();
  await expect(preview.getByText("Tabs layout")).toBeVisible();
  const typed = card.getByPlaceholder("Type something…");
  expect((await box(preview)).y).toBeGreaterThanOrEqual((await box(typed)).y + (await box(typed)).height);
  await card.getByRole("button", "Submit").tap();
  await expect(screen.getByTestId("transcript").getByText('"Which layout should the settings page use?"="Tabs". selected preview: Tabs across the top.', { exact: false })).toBeVisible();
});

test("Cancel declines the questions and the agent goes on", { tags: ["AGENT-006"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByTestId("question-card");
  await asked(hui, screen, "Declined questions", ask([DATABASE]));
  await card.getByRole("button", "Cancel").tap();

  await expect(card).toBeHidden();
  await expect(transcript.getByText("tool answered: User declined to answer questions")).toBeVisible();
  await expect(transcript.getByLabel("Your answers").getByText("You declined to answer.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});

test("parallel question calls show one card at a time, each answered on its own", { tags: ["AGENT-009"], platforms: ["web"] }, async ({ screen, hui }) => {
  const card = screen.getByTestId("question-card");
  const options = card.getByTestId("question-option");
  const questions = ["Which database should the service use?", "Where should it run first?"];
  await asked(hui, screen, "Parallel questions", ask([DATABASE], [DEPLOY]));

  const shown = card.getByText(new RegExp(`^(${questions.map((question) => question.replace("?", "\\?")).join("|")})$`, "u"));
  await expect(shown).toBeVisible();
  const first = (await shown.textContent())!;
  await expect(card).toHaveCount(1);
  await expect(options.first()).toBeFocused();
  await options.last().tap();
  await card.getByRole("button", "Submit").tap();

  await expect(card.getByText(questions.find((question) => question !== first)!)).toBeVisible();
  await expect(card).toHaveCount(1);
  await expect(options.first()).toBeFocused();
  await expect(options.first()).toBeChecked({ checked: false });
  await expect(options.last()).toBeChecked({ checked: false });
  await expect(card.getByRole("button", "Submit")).toBeDisabled();
  await options.last().tap();
  await card.getByRole("button", "Submit").tap();

  await expect(screen.getByTestId("transcript").getByText('tool answered: User has answered your questions: "Which database should the service use?"="SQLite". You can now continue with the user\'s answers in mind. | User has answered your questions: "Where should it run first?"="Production". You can now continue with the user\'s answers in mind.')).toBeVisible();
});

test("a call the card can't show opens no card and fails back to the agent with its reason", { tags: ["AGENT-010"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const two = DATABASE.options;
  await asked(hui, screen, "Invalid questions", ask(
    [SCOPE, DATABASE, DEPLOY, NOTES, { header: "Extra", question: "One too many?", options: two }],
    [{ ...DATABASE, options: [two[0]!, { label: "Other", description: "Something else." }] }],
    [{ ...DATABASE, options: [two[0]!, two[0]!] }],
    [{ ...DATABASE, header: "A header far too long" }],
    [{ ...DATABASE, multiSelect: true, options: [{ ...two[0]!, preview: "**Postgres**" }, two[1]!] }],
  ));

  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText(/^tool answered: /u));
  await expect(transcript.getByText(/^tool answered: /u)).toBeVisible();
  await expect(screen.getByTestId("question-card")).toBeHidden();
  await hui.scrollTo(transcript, transcript.getByText("Ran 1 command").nth(4));
  for (const group of await transcript.getByText("Ran 1 command").all()) await group.tap();
  await expect(transcript.getByText("Failed")).toHaveCount(5);
  for (let index = 4; index >= 0; index--) await transcript.getByText("Failed", { exact: true }).nth(index).tap({ position: { x: 4, y: 4 } });
  for (const reason of [
    '<harness> [error] Validation failed for tool "ask_user_question": - questions: must not have more than 4 items',
    '<harness> [error] questions[0].options[1].label "Other" is reserved: the card already offers a free-text answer. </harness>',
    "<harness> [error] questions[0].options must have unique labels. </harness>",
    '<harness> [error] Validation failed for tool "ask_user_question": - questions.0.header: must not have more than 16 characters',
    "<harness> [error] questions[0]: previews are for single-select questions only. </harness>",
  ]) {
    const shown = transcript.getByText(reason, { exact: !reason.includes("Validation failed") });
    await hui.scrollTo(transcript, shown);
    await expect(shown).toBeVisible();
  }
});

test("question text from the agent shows as text, wraps and keeps the card's actions in reach", { tags: ["AGENT-011"], platforms: ["web"] }, async ({ screen, hui }) => {
  const card = screen.getByTestId("question-card");
  const word = "Unbroken".repeat(40);
  await asked(hui, screen, "Untrusted question", ask([{
    header: "<b>Bold</b>",
    question: `<img src=x onerror="document.title='owned'"> ${word}?`,
    options: [
      { label: "<i>Italic</i>", description: "<script>document.title='owned'</script>", preview: `Safe **bold** text.\n\n<img src=x onerror="document.title='owned'">\n\n<script>document.title='owned'</script>\n\n${"Long preview line.\n\n".repeat(30)}` },
      { label: "Plain", description: "Nothing odd.".repeat(30) },
      { label: "Third", description: "Another option.".repeat(30) },
      { label: "Fourth", description: "One more option.".repeat(30) },
    ],
  }]));

  await expect(card.getByText("<b>Bold</b>")).toBeVisible();
  await expect(card.getByText(`<img src=x onerror="document.title='owned'"> ${word}?`)).toBeVisible();
  await expect(card.getByText("<i>Italic</i>")).toBeVisible();
  await expect(card.getByText("<script>document.title='owned'</script>")).toBeVisible();
  const preview = card.getByLabel("Preview");
  await expect(preview.getByText("bold")).toBeVisible();
  await expect(preview.getByText(`<img src=x onerror="document.title='owned'"> <script>document.title='owned'</script>`, { exact: false })).toBeVisible();

  const cardBox = await box(card);
  const question = await box(card.getByText(`<img src=x onerror="document.title='owned'"> ${word}?`));
  expect(question.x + question.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  const fourth = await box(card.getByTestId("question-option").filter({ hasText: "Fourth" }));
  expect(fourth.y + fourth.height).toBeGreaterThan(cardBox.y + cardBox.height);
  for (const action of ["Cancel", "Submit"]) {
    const button = await box(card.getByRole("button", action));
    expect(button.y).toBeGreaterThanOrEqual(cardBox.y);
    expect(button.y + button.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
  }
});
