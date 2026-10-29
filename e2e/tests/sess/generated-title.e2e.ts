/** A new session opens under its first prompt line while the utility model names it, then takes that 3-6 word title in the message's language everywhere without a reload (SESS-015). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a new session takes its generated title in the document title, sidebar row and heading without a reload", { tags: ["SESS-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  const settings = await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { primary: "hui-e2e/fixture", fallback: "", utility: "hui-e2e/anthropic/claude-opus-5-5" } });
  const message = "Planear las notas de la versión E2E_HOLD_NAMING";
  const generated = "Mejorar los nombres de sesión";
  const heading = screen.getByTestId("session-title", { visible: true });
  const transcript = screen.getByTestId("transcript");
  const composer = screen.getByLabel("Message");
  const row = (title: string) => screen.getByLabel(new RegExp(`^${title}, status `, "u"));

  await hui.open("/");
  await screen.getByLabel("Project directory").fill(hui.workspace);
  await screen.getByPlaceholder("What should this session work on?").fill(message);
  await screen.getByRole("button", "Start session").tap();

  await expect(heading).toHaveText(message);
  await expect(row(message)).toBeVisible();
  await expect(screen.getByTestId("session-row")).toHaveCount(1);
  await expect.poll(() => hui.documentTitle()).toBe(`${message} · HUI`);

  await hui.provider.held();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await composer.fill("A draft kept while the model names the session");
  await expect(composer).toBeFocused();

  await hui.provider.release();
  await expect(heading).toHaveText(generated);
  await expect(row(generated)).toBeVisible();
  await expect.poll(() => hui.documentTitle()).toBe(`${generated} · HUI`);
  await expect(composer).toHaveValue("A draft kept while the model names the session");
  await expect(composer).toBeFocused();
  const words = (await heading.textContent())?.trim().split(/\s+/u) ?? [];
  expect(words.length).toBeGreaterThanOrEqual(3);
  expect(words.length).toBeLessThanOrEqual(6);
});
