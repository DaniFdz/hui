/** The command palette opens and closes on its chord or Escape, moves with the arrow keys, and searches sessions, pages and Settings pages, best matches first, to jump to the one chosen (SHELL-018, SHELL-019). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("⌘K or Ctrl+K opens the palette's default list, the arrow keys move through it and Enter opens the highlighted one, and the chord or Escape closes it back to the focused control", { tags: ["SHELL-018"], platforms: ["web"] }, async ({ screen, hui }) => {
  const input = screen.getByPlaceholder("Search or jump to…");
  const prompt = screen.getByPlaceholder("What should this session work on?");
  const option = (name: RegExp) => screen.getByRole("option", { name, selected: true });

  await hui.open("/");
  await prompt.press("End");
  await expect(prompt).toBeFocused();
  await hui.paletteChord();
  await expect(input).toBeFocused();
  await expect(screen.getByRole("option")).toHaveText([/^New Session/u, /^Sessions/u, /^Automations/u, /^Plugins/u, /^Settings/u]);
  await hui.paletteChord();
  await expect(prompt).toBeFocused();
  await expect(input).toBeHidden();

  await hui.paletteChord();
  await expect(option(/^New Session/u)).toBeVisible();
  await input.press("Escape");
  await expect(prompt).toBeFocused();
  await expect(input).toBeHidden();

  await hui.paletteChord();
  await input.press("ArrowDown");
  await expect(option(/^Sessions/u)).toBeVisible();
  await input.press("ArrowDown");
  await expect(option(/^Automations/u)).toBeVisible();
  await input.press("ArrowUp");
  await expect(option(/^Sessions/u)).toBeVisible();
  await input.press("Enter");
  await expect(screen.getByTestId("page-title")).toHaveText("Sessions");
  await expect(input).toBeHidden();
  expect(await hui.url()).toMatch(/\/sessions$/u);
});

test("typing a search lists matching chats, pages and Settings pages under their headings, best matches first, says No results, and choosing one opens it", { tags: ["SHELL-019"], platforms: ["web"] }, async ({ screen, hui }) => {
  const input = screen.getByPlaceholder("Search or jump to…");
  const results = screen.getByTestId("command-palette-results");
  const session = await hui.createSession({ title: "A model review" });
  await hui.createSession({ title: "Model notes" });

  await hui.open("/");
  await expect(screen.getByLabel(/^Model notes, status idle/u)).toBeVisible();
  await hui.paletteChord();
  await input.fill("model");
  await expect(results).toContainText(/^Navigation\s*Model Providers.*Model Setup.*Usage.*Settings\s*Models.*Chats\s*Model notes.*A model review/iu);
  await input.fill("no such thing anywhere");
  await expect(results).toHaveText("No results");

  await input.fill("a model review");
  await results.getByText("A model review", { exact: true }).tap();
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("A model review");
  await expect(input).toBeHidden();
  expect(await hui.url()).toMatch(new RegExp(`/sessions/${session.id}$`, "u"));

  await hui.paletteChord();
  await input.fill("usage");
  await results.getByText("Usage", { exact: true }).tap();
  await expect(screen.getByTestId("page-title")).toHaveText("Usage");
  await expect(input).toBeHidden();

  await hui.paletteChord();
  await input.fill("diagnostics");
  await results.getByText("Diagnostics", { exact: true }).tap();
  await expect(screen.getByTestId("settings-page-title")).toHaveText("Diagnostics");
  await expect(input).toBeHidden();
});
