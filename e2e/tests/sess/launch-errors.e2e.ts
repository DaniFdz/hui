/** A session that cannot start explains why and keeps its draft, and PI's rejection of a first prompt shows in the chat (SESS-002, SESS-062). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Listed = { groups: { sessions: { title: string }[] }[] };

test("starting in a missing directory explains why, keeps the draft and starts once corrected", { tags: ["SESS-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  const titles = async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap(({ sessions }) => sessions.map(({ title }) => title));
  const before = await titles();
  const missing = `${hui.workspace}/missing-project`;
  const directory = screen.getByLabel("Project directory");
  const message = screen.getByPlaceholder("What should this session work on?");
  const start = screen.getByRole("button", "Start session");
  const transcript = screen.getByTestId("transcript");

  await hui.open("/");
  await directory.fill(missing);
  await message.fill("Ping the project");
  await start.tap();

  await expect(screen.getByText("Could not start session")).toBeVisible();
  await expect(screen.getByText(`No such directory: ${missing}`)).toBeVisible();
  expect(await titles()).toEqual(before);
  await expect(message).toHaveValue("Ping the project");
  await expect(message).toBeEnabled();

  await directory.fill(hui.workspace);
  await start.tap();
  await expect(transcript.getByText("Ping the project")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  expect(await titles()).toHaveLength(before.length + 1);
});

test("PI's rejection of a new session's first prompt shows in the chat and the session returns to Idle", { tags: ["SESS-062"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "No credential", model: "anthropic/claude-sonnet-4-5" });

  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill("Hello without a key");
  await screen.getByRole("button", "Send message").tap();

  await expect(screen.getByTestId("transcript").getByText("Hello without a key")).toBeVisible();
  await expect(screen.getByText("Provider is not configured: anthropic", { exact: true, visible: true })).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
