/** An agent's secret_request opens a masked card; a provided value reaches the agent only as a file and is kept out of every record, and Cancel ends the request without one (AGENT-015, AGENT-016, AGENT-017, AGENT-018). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const LABEL = "Fixture API key";
const REASON = "The fixture proves an agent can use a secret without seeing it.";

const requestSecret = async (hui: Hui, screen: Screen, title: string, tool?: "pi") => {
  const session = await hui.createSession({ title, tool });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill("E2E_SECRET_REQUEST");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("question-card").getByText(LABEL)).toBeVisible();
  return session;
};

test("a secret request opens a masked card and the agent gets a file it uses", { tags: ["AGENT-015", "AGENT-016"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByTestId("question-card");
  const value = `sk-e2e-${crypto.randomUUID()}`;
  const before = await hui.secretDirectories();
  const session = await requestSecret(hui, screen, "Provided secret");

  await expect(card.getByText("Secret")).toBeVisible();
  await expect(card.getByText("1/1")).toBeVisible();
  await expect(card.getByText(REASON)).toBeVisible();
  await expect(card.getByText("Kept out of the conversation: the agent gets a temporary file, never the value.")).toBeVisible();
  const field = card.getByLabel("Value");
  await expect(field).toBeFocused();
  expect(await field.inputValue().catch((error: { code?: string }) => error.code)).toBe("POLICY_DENIED");
  await expect(card.getByRole("button", "Cancel")).toBeVisible();
  await expect(screen.getByLabel("Session status: Waiting for your answer")).toBeVisible();
  await expect(screen.getByTestId("session-row").getByLabel("Provided secret, status waiting", { exact: false })).toBeVisible();
  await field.fill(value);
  await card.getByRole("button", "Submit").tap();

  await expect(card).toBeHidden();
  await expect(transcript.getByText("I used the secret in a command without seeing it, then deleted its file.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  expect((await hui.secretDirectories()).filter((name) => !before.includes(name))).toHaveLength(1);
  for (const pass of ["live", "reloaded"]) {
    if (pass === "reloaded") await hui.reload();
    await transcript.getByText("Ran 2 commands").tap();
    await transcript.getByText("Completed").tap();
    await expect(transcript.getByText(new RegExp(`"label": "${LABEL}",\\s+"reason": "${REASON}"`, "u"))).toBeVisible();
    await expect(transcript.getByText(new RegExp(`^The operator provided "${LABEL}"\\. It is in /tmp/hui-secret-\\d+-\\w+/secret until \\S+\\. Use it without printing it and delete the file when done\\.$`, "u"))).toBeVisible();
    await transcript.getByRole("button", /^printf 'Secret length/u).tap();
    await expect(transcript.getByText(`Secret length: ${value.length}`)).toBeVisible();
    await expect(transcript.getByText(value, { exact: false })).toBeHidden();
  }

  const pi = await requestSecret(hui, screen, "Provided secret on PI", "pi");
  await field.fill(value);
  await card.getByRole("button", "Submit").tap();
  await expect(transcript.getByText("I used the secret in a command without seeing it, then deleted its file.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  const records = JSON.stringify(await Promise.all([
    hui.api("POST", `/__hui/sessions/${session.id}/open`),
    hui.api("POST", `/__hui/sessions/${pi.id}/open`),
    hui.api("GET", "/__hui/sessions"),
    hui.api("GET", `/__hui/sessions/search?q=${encodeURIComponent(value)}`),
    hui.api("GET", "/__hui/diagnostics/export"),
    hui.api("GET", "/__hui/settings"),
  ]));
  expect(records).toContain(LABEL);
  expect(records).toContain(REASON);
  expect(records).not.toContain(value);
  expect(await hui.stored(LABEL)).toEqual(expect.arrayContaining([expect.stringMatching(/^config\/hui\/durable\//u), expect.stringMatching(/^agent\/sessions\//u)]));
  expect(await hui.stored(value)).toEqual([]);
});

test("Cancel ends a secret request without a file", { tags: ["AGENT-017"], platforms: ["web"] }, async ({ screen, hui }) => {
  const card = screen.getByTestId("question-card");
  const before = await hui.secretDirectories();
  await requestSecret(hui, screen, "Cancelled secret");
  await card.getByRole("button", "Cancel").tap();

  await expect(card).toBeHidden();
  await expect(screen.getByTestId("transcript").getByText(`No secret to use: The operator cancelled the request for "${LABEL}".`)).toBeVisible();
  expect((await hui.secretDirectories()).filter((name) => !before.includes(name))).toEqual([]);
});

test("Escape in the secret field leaves the request waiting", { tags: ["AGENT-018"], platforms: ["web"] }, async ({ screen, hui }) => {
  const card = screen.getByTestId("question-card");
  const field = card.getByLabel("Value");
  await requestSecret(hui, screen, "Escape in a secret");
  await field.press("Escape");
  await field.press("Escape");
  await field.fill("sk-e2e-escape");
  await card.getByRole("button", "Submit").tap();

  await expect(screen.getByTestId("transcript").getByText("I used the secret in a command without seeing it, then deleted its file.")).toBeVisible();
});
