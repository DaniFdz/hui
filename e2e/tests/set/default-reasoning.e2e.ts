/** New Session starts on the default reasoning chosen in Models, and a session created without a level takes it too (SET-087). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Listed = { groups: { sessions: { id: string; thinking?: string }[] }[] };

test("New Session starts on the default reasoning chosen in Models", { tags: ["SET-087"], platforms: ["web"] }, async ({ screen, hui }) => {
  const sessions = async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  const before = new Set((await sessions()).map((session) => session.id));

  await hui.open("/settings/models");
  await expect(screen.getByText("Saved by HUI and applied to new sessions.")).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText(/^Default reasoning$/u)).toBeVisible();
  await screen.getByLabel("Default reasoning: PI default").tap();
  await screen.getByLabel("Thinking effort").fill("2");
  await expect(screen.getByLabel("Default reasoning: Low")).toBeVisible();
  await expect.poll(async () => (await hui.api<{ models: { thinking: string } }>("GET", "/__hui/settings")).models.thinking).toBe("low");

  await hui.open("/");
  await screen.getByPlaceholder("~/").fill(hui.workspace);
  await screen.getByPlaceholder("What should this session work on?").fill("Low effort, please");
  await expect(screen.getByLabel("Thinking: low")).toBeVisible();
  await screen.getByRole("button", "Start session").tap();
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Thinking: low")).toBeVisible();

  const started = (await sessions()).find((session) => !before.has(session.id));
  expect(started?.thinking).toBe("low");

  await hui.createSession({ title: "A session without a level" });
  const created = (await sessions()).find((session) => !before.has(session.id) && session.id !== started?.id);
  expect(created?.thinking).toBe("low");

  const settings = await hui.api<{ models: Record<string, unknown> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, thinking: "" } });
});
