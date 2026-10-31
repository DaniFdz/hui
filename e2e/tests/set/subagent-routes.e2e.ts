/** Named subagent routes save their editable settings and resolve real spawns without changing the parent's model (SET-078, SET-079). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { Settings } from "../../../src/api/schema/settings.ts";

test("Subagent routes show summaries and use a modal for creating and editing", { tags: ["SET-078"], platforms: ["web"] }, async ({ screen, hui }) => {
  const settings = await hui.api<Settings>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { primary: "hui-e2e/fixture-deep", fallback: "", utility: "", routes: [] } });
  const savedRoutes = async () => (await hui.api<Settings>("GET", "/__hui/settings")).models.routes;
  const edit = (name: string) => screen.getByRole("button", `Edit route ${name}`);
  const add = screen.getByRole("button", "Add route");
  const dialog = screen.getByLabel("Add route", { exact: true });
  const name = dialog.getByLabel("Name", { exact: true });
  const editDialog = screen.getByLabel("Edit route", { exact: true });
  const editName = editDialog.getByLabel("Name", { exact: true });

  await hui.open("/settings/models");
  await expect(screen.getByText("Subagent routes", { exact: true })).toBeVisible();
  await expect(screen.getByText("No routes yet", { exact: true })).toBeVisible();
  await add.tap();
  await expect(dialog).toBeVisible();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("");
  await expect(dialog.getByRole("button", "Model: HUI Route Fixture")).toBeVisible();
  await expect.poll(savedRoutes).toEqual([]);
  await name.fill("discarded");
  await dialog.getByRole("button", "Cancel").tap();
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
  await expect.poll(savedRoutes).toEqual([]);

  await add.tap();
  await expect(name).toHaveValue("");
  await name.fill("discarded");
  await name.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
  await expect(screen.getByText("Subagent routes", { exact: true })).toBeVisible();
  await expect.poll(savedRoutes).toEqual([]);

  await add.tap();
  for (const invalid of ["", "two words"]) {
    await name.fill(invalid);
    await dialog.getByRole("button", "Add route").tap();
    await expect(dialog).toBeVisible();
    await expect.poll(savedRoutes).toEqual([]);
  }
  await name.fill(" fast ");
  await dialog.getByLabel("Description", { exact: true }).fill("Quick lookups");
  await dialog.getByRole("button", "Model: HUI Route Fixture").tap();
  await dialog.getByLabel("Model", { exact: true }).getByText("HUI SDK Fixture", { exact: true }).tap();
  await dialog.getByRole("button", "Thinking: Inherit parent").tap();
  await dialog.getByLabel("Thinking", { exact: true }).getByText("low", { exact: true }).tap();
  await dialog.getByRole("button", "Add route").tap();
  await expect(dialog).toBeHidden();
  const route = screen.getByLabel("Route fast", { exact: true });
  await expect(route.getByText("Quick lookups", { exact: true })).toBeVisible();
  await expect(route.getByText("HUI SDK Fixture · low", { exact: true })).toBeVisible();
  await expect(route.getByRole("textbox")).toHaveCount(0);
  await expect(edit("fast")).toBeVisible();

  await add.tap();
  await name.fill("fast");
  await dialog.getByRole("button", "Add route").tap();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("That route name is already in use.", { exact: true })).toBeVisible();
  await expect.poll(async () => (await savedRoutes()).map((route) => route.name)).toEqual(["fast"]);
  await name.fill("deep");
  await dialog.getByLabel("Description", { exact: true }).fill("Careful debugging");
  await expect(dialog.getByRole("button", "Model: HUI Route Fixture")).toBeVisible();
  await dialog.getByRole("button", "Thinking: Inherit parent").tap();
  await dialog.getByLabel("Thinking", { exact: true }).getByText("high", { exact: true }).tap();
  await dialog.getByRole("button", "Add route").tap();
  await expect(dialog).toBeHidden();

  await edit("fast").tap();
  await expect(editName).toBeFocused();
  await expect(editName).toHaveValue("fast");
  await expect(editDialog.getByLabel("Description", { exact: true })).toHaveValue("Quick lookups");
  await expect(editDialog.getByRole("button", "Model: HUI SDK Fixture")).toBeVisible();
  await expect(editDialog.getByRole("button", "Thinking: low")).toBeVisible();
  await editName.fill("discarded");
  await editDialog.getByLabel("Description", { exact: true }).fill("Discarded changes");
  await expect.poll(async () => (await savedRoutes()).map(({ name, description }) => ({ name, description }))).toEqual([
    { name: "fast", description: "Quick lookups" }, { name: "deep", description: "Careful debugging" },
  ]);
  await editDialog.getByRole("button", "Cancel").tap();
  await expect(editDialog).toBeHidden();
  await expect(edit("fast")).toBeFocused();
  await expect(route.getByText("Quick lookups", { exact: true })).toBeVisible();

  await edit("fast").tap();
  await expect(editName).toHaveValue("fast");
  await editName.fill("discarded");
  await editName.press("Escape");
  await expect(editDialog).toBeHidden();
  await expect(edit("fast")).toBeFocused();

  await edit("fast").tap();
  await editDialog.getByLabel("Description", { exact: true }).fill("Quick tasks");
  await editDialog.getByRole("button", "Save changes").tap();
  await expect(editDialog).toBeHidden();
  await expect(edit("fast")).toBeFocused();
  await expect(route.getByText("Quick tasks", { exact: true })).toBeVisible();

  await edit("deep").tap();
  await expect(editDialog.getByRole("button", "Model: HUI Route Fixture")).toBeVisible();
  await expect(editDialog.getByRole("button", "Thinking: high")).toBeVisible();
  for (const invalid of ["", "two words", "fast"]) {
    await editName.fill(invalid);
    await editDialog.getByRole("button", "Save changes").tap();
    await expect(editDialog).toBeVisible();
    await expect.poll(async () => (await savedRoutes()).map((route) => route.name)).toEqual(["fast", "deep"]);
  }
  await editName.fill("expert");
  await editDialog.getByLabel("Description", { exact: true }).fill("Careful debugging and design work");
  await editDialog.getByRole("button", "Model: HUI Route Fixture").tap();
  await editDialog.getByLabel("Model", { exact: true }).getByText("HUI SDK Fixture", { exact: true }).tap();
  await editDialog.getByRole("button", "Thinking: high").tap();
  await editDialog.getByLabel("Thinking", { exact: true }).getByText("Inherit parent", { exact: true }).tap();
  await editDialog.getByRole("button", "Save changes").tap();
  await expect(editDialog).toBeHidden();
  await expect(edit("expert")).toBeFocused();
  await expect(screen.getByLabel("Route deep", { exact: true })).toBeHidden();
  await expect.poll(async () => (await savedRoutes()).map((route) => route.name)).toEqual(["fast", "expert"]);

  await hui.reload();
  for (const [name, description, configuration] of [
    ["fast", "Quick tasks", "HUI SDK Fixture · low"],
    ["expert", "Careful debugging and design work", "HUI SDK Fixture · Inherit parent"],
  ] satisfies [string, string, string][]) {
    const row = screen.getByLabel(`Route ${name}`, { exact: true });
    await expect(row.getByText(description, { exact: true })).toBeVisible();
    await expect(row.getByText(configuration, { exact: true })).toBeVisible();
    await expect(row.getByRole("textbox")).toHaveCount(0);
    await expect(edit(name)).toBeVisible();
  }
  await edit("expert").tap();
  await expect(editName).toHaveValue("expert");
  await expect(editDialog.getByLabel("Description", { exact: true })).toHaveValue("Careful debugging and design work");
  await expect(editDialog.getByRole("button", "Model: HUI SDK Fixture")).toBeVisible();
  await expect(editDialog.getByRole("button", "Thinking: Inherit parent")).toBeVisible();
  await editDialog.getByRole("button", "Cancel").tap();
  await expect(editDialog).toBeHidden();
  await screen.getByRole("button", "Remove route expert").tap();
  await expect(screen.getByLabel("Route expert", { exact: true })).toBeHidden();
  await hui.reload();
  await expect(route.getByText("Quick tasks", { exact: true })).toBeVisible();
  await expect.poll(async () => (await savedRoutes()).map((route) => route.name)).toEqual(["fast"]);
  await screen.getByRole("button", "Remove route fast").tap();
  await expect(screen.getByText("No routes yet", { exact: true })).toBeVisible();
  await hui.reload();
  await expect(screen.getByText("No routes yet", { exact: true })).toBeVisible();

  const capped = Array.from({ length: 50 }, (_, index) => ({ name: `retired-${index}`, description: "Saved configuration", model: "retired/model" }));
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, routes: capped } });
  await hui.reload();
  await expect(add).toBeDisabled();
  await edit("retired-0").tap();
  await expect(editDialog.getByRole("button", "Model: retired/model")).toBeVisible();
  await editDialog.getByLabel("Description", { exact: true }).fill("Updated without changing the unavailable model");
  await editDialog.getByRole("button", "Save changes").tap();
  await expect(editDialog).toBeHidden();
  await expect.poll(async () => (await savedRoutes())[0]).toEqual({ ...capped[0], description: "Updated without changing the unavailable model" });
  await expect.poll(async () => (await savedRoutes()).length).toBe(50);
});

test("a routed spawn uses its model and thinking; invalid routes create no children", { tags: ["SET-079"], platforms: ["web"] }, async ({ screen, hui }) => {
  const settings = await hui.api<Record<string, unknown>>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: {
    primary: "hui-e2e/fixture", fallback: "", utility: "",
    routes: [
      { name: "fast", description: "Quick lookups", model: "hui-e2e/fixture" },
      { name: "deep", description: "Careful debugging", model: "hui-e2e/fixture-deep", thinking: "low" },
    ],
  } });
  const session = await hui.createSession({ title: "Route parent" });
  const transcript = screen.getByTestId("transcript");
  const sessions = screen.getByLabel(/, tool durable, stage investigation/u);
  const expand = screen.getByRole("button", "Expand subagents of Route parent");
  const send = async (input: Record<string, unknown>) => {
    await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
    await screen.getByLabel("Message").fill(`E2E_CALL:${Buffer.from(JSON.stringify({ name: "sessions_spawn", input })).toString("base64url")}`);
    await screen.getByRole("button", "Send message").tap();
  };

  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Model: HUI SDK Fixture", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Thinking: high", { exact: true })).toBeVisible();
  await expect(sessions).toHaveCount(1);
  await send({ task: "E2E_SUBAGENT_CHILD unknown", label: "Unknown worker", route: "no-such-route" });
  await expect(transcript.getByText(/^tool answered:.*Unknown route: no-such-route\. Configured routes are fast, deep\./su)).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(expand).toBeHidden();

  await send({ task: "E2E_SUBAGENT_CHILD conflicting", label: "Conflicting worker", route: "deep", model: "hui-e2e/fixture" });
  await expect(transcript.getByText(/^tool answered:.*Pass route or model, not both: a route already names a model\./su)).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(expand).toBeHidden();

  await send({ task: "E2E_SUBAGENT_CHILD routed", label: "Routed worker", route: "deep" });
  await expand.tap();
  const child = screen.getByLabel(/^Routed worker, status idle,/u);
  await expect(child).toBeVisible();
  await expect(sessions).toHaveCount(2);
  await expect(screen.getByLabel("Model: HUI SDK Fixture", { exact: true })).toBeVisible();
  await child.tap();
  await expect(screen.getByLabel("Model: HUI Route Fixture", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Thinking: low", { exact: true })).toBeVisible();
  await expect(transcript.getByText("Subagent child result: the fixture contract is working.", { exact: true, visible: true })).toBeVisible();
  await screen.getByLabel(/^Route parent, status idle,/u).tap();
  await expect(screen.getByLabel("Model: HUI SDK Fixture", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Thinking: high", { exact: true })).toBeVisible();
});
