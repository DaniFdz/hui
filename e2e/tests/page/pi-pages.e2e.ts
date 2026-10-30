/** Config splits HUI-owned from PI-owned settings and opens the Settings pages it names, Model Providers and Model Setup show PI's defaults, providers and catalogue, and Skill Workshop says creating skills stays disabled and lists PI's read-only skill roots (PAGE-028, PAGE-029, PAGE-030, PAGE-043). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Pi = {
  settings: { path: string; exists: boolean; skillRoots: string[] };
  model: { defaultProvider: string; defaultModel: string; thinking: string | null; enabled: string[]; authenticated: string[]; catalog: { provider: string; id: string; name: string }[] };
};

const withModel = (pi: Pi, model: Partial<Pi["model"]>) => JSON.stringify({ ...pi, model: { ...pi.model, ...model } });

test("Config splits HUI-owned settings from PI-owned ones, shows PI's settings file and opens Appearance, Skills, Plugins and Models", { tags: ["PAGE-028"], platforms: ["web"] }, async ({ screen, hui }) => {
  const pi = await hui.api<Pi>("GET", "/__hui/pi");

  await hui.open("/config");
  await expect(screen.getByText("HUI-owned", { exact: true })).toBeVisible();
  await expect(screen.getByText("PI-owned", { exact: true })).toBeVisible();
  await expect(screen.getByText(pi.settings.path, { exact: true })).toBeVisible();
  await expect(screen.getByText(pi.settings.exists ? "PI settings file detected." : "PI is using defaults.", { exact: true })).toBeVisible();

  for (const [button, opened] of [["Open Appearance", "Appearance"], ["Open Skills", "Skills"], ["Open Plugins", "Plugins"], ["Open Models", "Models"]] as const) {
    await hui.open("/config");
    await screen.getByRole("button", button).first().tap();
    await expect(screen.getByTestId("settings-page-title")).toHaveText(opened);
  }
});

const providersOf = (pi: Pi) => [...new Set([
  ...pi.model.catalog.map((entry) => entry.provider),
  ...pi.model.authenticated,
  ...(pi.model.defaultProvider ? [pi.model.defaultProvider] : []),
])].toSorted();
const modelsOf = (pi: Pi, provider: string) => pi.model.catalog.filter((entry) => entry.provider === provider).length;
const countLabel = (count: number, provider: string, pi: Pi) => `${count} model${count === 1 ? "" : "s"}${provider === pi.model.defaultProvider ? " · default" : ""}`;

test("Model Providers shows PI's primary model, thinking level, available models and each provider with its count, default and credential state, says No providers with none and never shows a credential value", { tags: ["PAGE-029"], platforms: ["web"] }, async ({ screen, hui }) => {
  const pi = await hui.api<Pi>("GET", "/__hui/pi");
  const providers = providersOf(pi);
  const real = await hui.intercept("GET", /\/__hui\/pi$/u);

  await hui.open("/model-providers");
  await real.arrived();
  await real.deliver();
  await expect(screen.getByText("Primary", { exact: true })).toBeVisible();
  await expect(screen.getByText(`${pi.model.defaultProvider}/${pi.model.defaultModel}`, { exact: true })).toBeVisible();
  await expect(screen.getByText(pi.model.thinking ?? "PI default", { exact: true })).toBeVisible();
  await expect(screen.getByText(String(pi.model.catalog.length), { exact: true })).toBeVisible();
  for (const provider of providers) {
    await expect(screen.getByText(provider, { exact: true })).toBeVisible();
    await expect(screen.getByText(countLabel(modelsOf(pi, provider), provider, pi), { exact: true })).toBeVisible();
  }
  const configured = (provider: string) => pi.model.authenticated.includes(provider);
  await expect(screen.getByText("Credential configured", { exact: true })).toHaveCount(providers.filter(configured).length);
  await expect(screen.getByText("Available", { exact: true })).toHaveCount(providers.filter((provider) => !configured(provider) && modelsOf(pi, provider) > 0).length);
  await expect(screen.getByText("Needs setup", { exact: true })).toHaveCount(providers.filter((provider) => !configured(provider) && modelsOf(pi, provider) === 0).length);
  await expect(screen.getByText(/e2e-not-a-secret/u)).toBeHidden();

  const mixed = await hui.intercept("GET", /\/__hui\/pi$/u);
  await hui.reload();
  await mixed.arrived();
  await mixed.answer(withModel(pi, { defaultProvider: "gamma", defaultModel: "", authenticated: ["alpha"], catalog: [{ provider: "alpha", id: "one", name: "one" }, { provider: "beta", id: "two", name: "two" }] }));
  await expect(screen.getByText("0 models · default", { exact: true })).toBeVisible();
  await expect(screen.getByText("Credential configured", { exact: true })).toBeVisible();
  await expect(screen.getByText("Available", { exact: true })).toBeVisible();
  await expect(screen.getByText("Needs setup", { exact: true })).toBeVisible();

  const none = await hui.intercept("GET", /\/__hui\/pi$/u);
  await hui.reload();
  await none.arrived();
  await none.answerEvery(withModel(pi, { defaultProvider: "", defaultModel: "", authenticated: [], catalog: [] }));
  await expect(screen.getByText("No providers", { exact: true })).toBeVisible();
  await expect(screen.getByText("Credential configured", { exact: true })).toBeHidden();
});

test("Model Setup shows the configured primary model and thinking level, the providers and every catalogue model as provider/id Available, and changes no PI configuration", { tags: ["PAGE-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  const pi = await hui.api<Pi>("GET", "/__hui/pi");
  const providers = providersOf(pi);
  const codes = pi.model.catalog.map((entry) => `${entry.provider}/${entry.id}`);
  const primary = `${pi.model.defaultProvider}/${pi.model.defaultModel}`;
  const escape = (code: string) => code.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const before = JSON.stringify({ settings: pi.settings, model: pi.model });
  const real = await hui.intercept("GET", /\/__hui\/pi$/u);

  await hui.open("/model-setup");
  await real.arrived();
  await real.deliver();
  await expect(screen.getByTestId("page-title")).toHaveText("Model Setup");
  await expect(screen.getByText("Primary", { exact: true })).toBeVisible();
  await expect(screen.getByText(primary, { exact: true }).first()).toBeVisible();
  await expect(screen.getByText(pi.model.thinking ?? "PI default", { exact: true })).toBeVisible();
  await expect(screen.getByText(String(pi.model.catalog.length), { exact: true })).toBeVisible();
  for (const provider of providers) {
    await expect(screen.getByText(provider, { exact: true })).toBeVisible();
    await expect(screen.getByText(countLabel(modelsOf(pi, provider), provider, pi), { exact: true })).toBeVisible();
  }
  await expect(screen.getByText("Model catalog", { exact: true })).toBeVisible();
  await expect(screen.getByText("Candidates returned by PI. Choose a model per session from the chat composer.", { exact: true })).toBeVisible();
  await expect(screen.getByText(new RegExp(`^(${codes.map(escape).join("|")})$`, "u"))).toHaveCount(codes.length + (codes.includes(primary) ? 1 : 0));
  await expect(screen.getByText("Available", { exact: true })).toHaveCount(pi.model.catalog.length + providers.filter((provider) => !pi.model.authenticated.includes(provider) && modelsOf(pi, provider) > 0).length);
  const after = await hui.api<Pi>("GET", "/__hui/pi");
  expect(JSON.stringify({ settings: after.settings, model: after.model })).toEqual(before);
});

test("Skill Workshop says creating, revising and publishing skills stays disabled and lists PI's skill roots as read-only Discovered sources", { tags: ["PAGE-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const pi = await hui.api<Pi>("GET", "/__hui/pi");

  await hui.open("/skill-workshop");
  await expect(screen.getByText("Creating, revising and publishing skills stays disabled until HUI has an explicit storage, review and rollback contract.", { exact: true })).toBeVisible();
  await expect(screen.getByText("Skill sources", { exact: true })).toBeVisible();
  await expect(screen.getByText("Current PI roots remain the source of truth.", { exact: true })).toBeVisible();
  for (const root of pi.settings.skillRoots) await expect(screen.getByText(root, { exact: true })).toBeVisible();
  await expect(screen.getByText("Read-only skill root", { exact: true })).toHaveCount(pi.settings.skillRoots.length);
  await expect(screen.getByText("Discovered", { exact: true })).toHaveCount(pi.settings.skillRoots.length);
  await expect(screen.getByRole("button", "Install skill")).toBeHidden();
});
