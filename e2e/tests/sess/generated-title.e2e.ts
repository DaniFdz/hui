/** A new session opens at once under its first prompt line and takes the utility model's generated title in the sidebar
 * row and the chat heading without a reload, while a held naming call leaves the conversation free to answer and one
 * Start draws exactly one row (SESS-015). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a started session opens under its first prompt line and takes the generated title at once, while a slow naming call never blocks it or doubles its row", { tags: ["SESS-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  const directory = screen.getByLabel("Project directory");
  const message = screen.getByPlaceholder("What should this session work on?");
  const start = screen.getByRole("button", "Start session");
  const transcript = screen.getByTestId("transcript");
  const heading = screen.getByTestId("session-title", { visible: true });
  const rows = screen.getByTestId("session-row");
  const row = (title: string) => screen.getByLabel(new RegExp(`^${title}, status `, "u"));
  // The fixture's utility model holds the title call until the replay is released, so the prompt line is read while
  // naming is still in flight.
  const prompt = "Stop new sessions timing out E2E_HOLD_NAMING";
  // HUI names a session with the utility model; this instance points it at the fixture, as the launcher's own profile does.
  const settings = await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });

  await hui.open("/");
  await expect(rows).toHaveCount(0);
  await directory.fill(hui.workspace);
  await message.fill(prompt);
  await start.tap();

  // The session opens and answers under the provisional title, which is the prompt's first line.
  await hui.provider.held();
  await expect(heading).toHaveText(prompt);
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.sessionList();
  await expect(row(prompt)).toBeVisible();
  await expect(rows).toHaveCount(1);

  // The generated title replaces it in the row and the heading, without a reload.
  await hui.provider.release();
  await expect(heading).toHaveText("Improve session naming");
  await hui.sessionList();
  await expect(row("Improve session naming")).toBeVisible();
  await expect(screen.getByTestId("session-row").filter({ hasText: "Improve session naming" })).toHaveCount(1);
  await expect(rows).toHaveCount(1);
});
