/** `/update` is an HUI command, not a model one: the composer offers it before any session exists, sending it opens the HUI update session and the Update HUI dialog, `--check` only reports, and any other argument or an attachment is refused (SHELL-035 to SHELL-037). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const refused = "Use /update or /update --check, without attachments. This command is handled by HUI, not the model.";
const developmentServer = "This is the development server. Update the source checkout through Git; installed HUI packages can update from GitHub Releases.";

test("/upd offers /update in the New Session composer, and sending it creates the HUI update session in OTHER with /update kept and opens the dialog without reaching the model", { tags: ["SHELL-035"], platforms: ["web"] }, async ({ screen, hui }) => {
  const directory = screen.getByLabel("Project directory");
  const message = screen.getByPlaceholder("What should this session work on?");
  const commands = screen.getByLabel("Commands and paths");

  await hui.open("/");
  await message.fill("/upd");
  await expect(commands.getByText("/update", { exact: true })).toBeVisible();
  await expect(commands.getByText("Check for HUI updates and install the latest release")).toBeVisible();

  await directory.fill(hui.workspace);
  await message.fill("/update");
  await screen.getByRole("button", "Start session").tap();

  await expect(screen.getByText("Update HUI", { exact: true })).toBeVisible();
  expect(new URL(await hui.url()).pathname).toMatch(/^\/sessions\/[^/]+$/u);
  await expect(screen.getByTestId("session-row").filter({ hasText: "HUI update" })).toHaveCount(1);
  const listed = await hui.api<{ groups: { label: string; sessions: { title: string; group: string }[] }[] }>("GET", "/__hui/sessions");
  const ungrouped = listed.groups.find((group) => group.label === "ungrouped");
  expect(ungrouped?.sessions.filter((session) => session.title === "HUI update").map((session) => session.group)).toEqual([""]);
  expect(await hui.providerRequests()).toBe(0);

  await screen.getByRole("button", "Close").tap();
  await expect(screen.getByText("Update HUI", { exact: true })).toBeHidden();
  await expect(screen.getByLabel("Message")).toHaveValue("/update");
});

test("/update --check opens the dialog with what the check found, says it only checks and offers no install", { tags: ["SHELL-036"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Check for updates" });

  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill("/update --check");
  await screen.getByRole("button", "Send message").tap();

  await expect(screen.getByText("Update HUI", { exact: true })).toBeVisible();
  await expect(screen.getByText(developmentServer)).toBeVisible();
  await expect(screen.getByText("Check only. Run /update to install an available release.")).toBeVisible();
  await expect(screen.getByRole("button", /^Update to /u)).toHaveCount(0);
  expect(await hui.providerRequests()).toBe(0);
  await screen.getByRole("button", "Close").tap();
  await expect(screen.getByLabel("Message", { visible: true })).toHaveValue("/update --check");
});

test("an argument or an attachment on /update is refused with the error toast, and nothing reaches the model", { tags: ["SHELL-037"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Refuse the update" });
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");

  await hui.open(`/sessions/${session.id}`);
  await message.fill("/update now");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText(refused)).toBeVisible();
  await expect(transcript.getByText("/update now")).toBeHidden();
  expect(await hui.providerRequests()).toBe(0);

  await screen.getByRole("button", "Dismiss notification").tap();
  await expect(screen.getByText(refused)).toBeHidden();
  await message.fill("/update");
  await screen.getByLabel("Add attachment").first().tap();
  await hui.attach(screen.getByLabel("Choose files"), ["notes.txt"]);
  await expect(screen.getByLabel("Attached files").getByText("notes.txt")).toBeVisible();
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText(refused)).toBeVisible();
  await expect(screen.getByLabel("Attached files").getByText("notes.txt")).toBeVisible();
  await expect(message).toHaveValue("/update");
  expect(await hui.providerRequests()).toBe(0);
});