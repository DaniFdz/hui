/** Named subagent routes save their editable settings and resolve real spawns without changing the parent's model (SET-078, SET-079). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Subagent routes keep edits, reject invalid names, and remove saved rows", { tags: ["SET-078"], platforms: ["web"] }, async ({ screen, hui }) => {
  const settings = await hui.api<Record<string, unknown>>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { primary: "hui-e2e/fixture", fallback: "", utility: "", routes: [] } });
  const rename = async (from: string, to: string) => {
    const name = screen.getByLabel(`Route name: ${from}`, { exact: true });
    await name.fill(to);
    await name.press("Tab");
  };

  await hui.open("/settings/models");
  await expect(screen.getByText("Subagent routes", { exact: true })).toBeVisible();
  await expect(screen.getByText("No routes yet", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Add route").tap();
  await rename("route", "fast");
  const route = screen.getByLabel("Route fast", { exact: true });
  for (const label of ["Name", "Description", "Model", "Thinking"]) {
    await expect(route.getByText(label, { exact: true })).toBeVisible();
  }
  await screen.getByLabel("Description of fast").fill("Quick lookups");
  await screen.getByLabel("Description of fast").press("Tab");
  await expect(screen.getByRole("button", "Model for fast: HUI SDK Fixture")).toBeVisible();
  await screen.getByRole("button", "Thinking for fast: Inherit parent").tap();
  await screen.getByLabel("Thinking for fast", { exact: true }).getByText("low", { exact: true }).tap();

  await screen.getByRole("button", "Add route").tap();
  await rename("route", "deep");
  await screen.getByLabel("Description of deep").fill("Careful debugging");
  await screen.getByLabel("Description of deep").press("Tab");
  await screen.getByRole("button", "Model for deep: HUI SDK Fixture").tap();
  await screen.getByLabel("Model for deep", { exact: true }).getByText("HUI Route Fixture", { exact: true }).tap();
  await screen.getByRole("button", "Thinking for deep: Inherit parent").tap();
  await screen.getByLabel("Thinking for deep", { exact: true }).getByText("high", { exact: true }).tap();

  for (const invalid of ["", "two words", "fast"]) {
    await rename("deep", invalid);
    await expect(screen.getByLabel("Route name: deep", { exact: true })).toHaveValue("deep");
    await expect(screen.getByLabel("Route name: fast", { exact: true })).toHaveCount(1);
  }
  await hui.reload();
  for (const [name, description, model, thinking] of [
    ["fast", "Quick lookups", "HUI SDK Fixture", "low"],
    ["deep", "Careful debugging", "HUI Route Fixture", "high"],
  ] satisfies [string, string, string, string][]) {
    await expect(screen.getByLabel(`Route name: ${name}`, { exact: true })).toHaveValue(name);
    await expect(screen.getByLabel(`Description of ${name}`)).toHaveValue(description);
    await expect(screen.getByRole("button", `Model for ${name}: ${model}`)).toBeVisible();
    await expect(screen.getByRole("button", `Thinking for ${name}: ${thinking}`)).toBeVisible();
  }

  await screen.getByRole("button", "Thinking for fast: low").tap();
  await screen.getByLabel("Thinking for fast", { exact: true }).getByText("Inherit parent", { exact: true }).tap();
  await screen.getByRole("button", "Remove route deep").tap();
  await expect(screen.getByLabel("Route name: deep", { exact: true })).toBeHidden();
  await hui.reload();
  await expect(screen.getByRole("button", "Thinking for fast: Inherit parent")).toBeVisible();
  await expect(screen.getByLabel(/^Route name:/u)).toHaveCount(1);
  await screen.getByRole("button", "Remove route fast").tap();
  await expect(screen.getByText("No routes yet", { exact: true })).toBeVisible();
  await hui.reload();
  await expect(screen.getByText("No routes yet", { exact: true })).toBeVisible();
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
