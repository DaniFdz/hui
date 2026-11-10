/** A new session opens at once under its first prompt line and then takes a three-to-six-word generated title in the document title, its sidebar row and the chat heading, while a slow utility model holds the naming and never blocks the session (SESS-015). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const prompt = "Rework the launch form for phones E2E_HOLD_NAMING";

test("a new session opens under its first prompt line and takes a generated title in the document title, row and heading while the utility model is still naming it", { tags: ["SESS-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  // Titles come from the utility model, which no fixture configures by default.
  const settings = await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });
  const directory = screen.getByLabel("Project directory");
  const message = screen.getByPlaceholder("What should this session work on?");
  const transcript = screen.getByTestId("transcript");
  const heading = screen.getByTestId("session-title", { visible: true });
  const rows = screen.getByTestId("session-row");
  const named = rows.filter({ hasText: "Improve session naming" });

  await hui.open("/");
  await directory.fill(hui.workspace);
  await message.fill(prompt);
  await screen.getByRole("button", "Start session").tap();

  // The session opens under its first prompt line before anything names it.
  await expect(transcript.getByText(prompt)).toBeVisible();
  await hui.provider.held();
  await expect(heading).toHaveText(prompt);
  expect(await hui.documentTitle()).toBe(`${prompt} · HUI`);
  await hui.sessionList();
  await expect(rows.filter({ hasText: prompt })).toHaveCount(1);

  // The held naming call never blocks the turn: the session answers and settles while it is still running.
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByText(/timed out|timeout/iu)).toHaveCount(0);
  await expect(named).toHaveCount(0);

  await hui.provider.release();
  await expect(heading).toHaveText("Improve session naming");
  expect(await hui.documentTitle()).toBe("Improve session naming · HUI");
  const words = (await hui.documentTitle()).split(" · ")[0]!.split(" ");
  expect(words.length).toBeGreaterThanOrEqual(3);
  expect(words.length).toBeLessThanOrEqual(6);
  await hui.sessionList();
  await expect(named).toHaveCount(1);
  await expect(rows.filter({ hasText: prompt })).toHaveCount(0);
  // One Start made exactly one session, named in place without a reload.
  const listed = await hui.api<{ groups: { sessions: { title: string }[] }[] }>("GET", "/__hui/sessions");
  expect(listed.groups.flatMap((group) => group.sessions).filter(({ title }) => title === "Improve session naming")).toHaveLength(1);
});
