/** The provider wizard signs in with a ChatGPT account, switches to a device code and verifies the chosen model (SET-034). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { ProviderLogin, ProviderModel, ProviderSnapshot } from "../../../src/api/schema/providers.ts";

const MODELS: ProviderModel[] = [
  { id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
  { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini" },
];

/**
 * The snapshot the gateway serves, with the sign-in this test drives. `configured` is false until the model is saved,
 * as it is on the gateway after a completed sign-in: only the PUT at the end of the model step makes a card.
 */
const snapshot = (providers: ProviderSnapshot["providers"], login: ProviderLogin | undefined, state: "absent" | "signed-in" | "connected") => JSON.stringify({
  providers: providers.map((provider) => provider.id === "openai-codex" && state !== "absent"
    ? { ...provider, configured: state === "connected", authenticated: true, accounts: [], selected: [], models: MODELS }
    : provider),
  ...(login ? { login } : {}),
});

/**
 * `hui.answerAll` stops by pattern source, so a standing answer spells the snapshot route with one more empty group
 * than the last one; every spelling matches the same URL and stopping one leaves the next standing.
 */
let spellings = 0;
const snapshotRoute = () => new RegExp(`\\/__hui\\/providers${"(?:)".repeat(spellings++)}$`);

test("a ChatGPT sign-in shows its browser step, restarts with a device code and verifies the chosen model", { tags: ["SET-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const real = await hui.api<ProviderSnapshot>("GET", "/__hui/providers");
  const settings = await hui.api<{ models: Record<string, unknown> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, primary: "", fallback: "", utility: "" } });
  const browserLogin: ProviderLogin = {
    id: "hui-fixture-signin", provider: "openai-codex", phase: "pending", flow: "browser",
    url: "https://example.com/sign-in", message: "Waiting for the browser sign-in.",
    prompt: { id: "hui-fixture-prompt", type: "manual_code", message: "Paste the callback address" },
  };
  const codeLogin: ProviderLogin = { ...browserLogin, flow: "device_code", url: "https://example.com/device", code: "HUI7-DEMO", message: "Enter the code in your browser." };
  try {
    await hui.open("/settings/models");
    await expect(screen.getByRole("button", "Connect a provider")).toBeVisible();
    const pending = await hui.answerAll("GET", snapshotRoute(), snapshot(real.providers, browserLogin, "absent"));
    const start = await hui.intercept("POST", /\/__hui\/providers\/openai-codex\/login$/);
    await screen.getByRole("button", "Connect a provider").tap();
    await expect(screen.getByRole("button", "Close provider dialog")).toBeVisible();
    await screen.getByRole("button", /^OpenAI /u).tap();
    await screen.getByRole("button", /^ChatGPT account Codex/u).tap();

    await start.arrived();
    expect(JSON.parse(start.request().body)).toEqual({ method: "oauth", flow: "browser" });
    await start.answer(JSON.stringify(browserLogin));
    await expect(screen.getByText("Complete sign-in in your browser, then return here.", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Open sign-in")).toBeVisible();
    await expect(screen.getByText("Use manual entry", { exact: true })).toBeVisible();
    await expect(screen.getByLabel("Select OpenAI Codex login method", { exact: true })).toHaveCount(0);

    // A reload during sign-in reopens the same pending step.
    await hui.reload();
    await expect(screen.getByText("Complete sign-in in your browser, then return here.", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Open sign-in")).toBeVisible();

    const cancel = await hui.intercept("DELETE", /\/__hui\/providers\/login\/[^/]+$/);
    const restart = await hui.intercept("POST", /\/__hui\/providers\/openai-codex\/login$/);
    const codes = await hui.answerAll("GET", snapshotRoute(), snapshot(real.providers, codeLogin, "absent"));
    await pending.stop();
    await screen.getByRole("button", "Use a code instead").tap();
    await cancel.arrived();
    expect(cancel.request().method).toBe("DELETE");
    await cancel.answer(JSON.stringify({ ok: true }));
    await restart.arrived();
    expect(JSON.parse(restart.request().body)).toMatchObject({ method: "oauth", flow: "device_code" });
    await restart.answer(JSON.stringify(codeLogin));
    await expect(screen.getByText("Enter this code at example.com/device:", { exact: true })).toBeVisible();
    await expect(screen.getByText("HUI7-DEMO", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Copy code")).toBeVisible();
    await expect(screen.getByText(/^Expires in \d+ minutes$/u)).toBeVisible();
    await expect(screen.getByText("Continue only if you started this sign-in yourself. If a website or another person gave you this code, cancel.", { exact: true })).toBeVisible();

    await hui.answerAll("GET", snapshotRoute(), snapshot(real.providers, { ...codeLogin, phase: "complete" }, "signed-in"));
    await codes.stop();
    await expect(screen.getByText("Account connected. Choose a model when you want to test a reply.", { exact: true })).toBeVisible();
    await expect(screen.getByText("Choose a model", { exact: true })).toBeVisible();
    const chosen = screen.getByLabel(/GPT-5\.1 Codex Mini/u);
    await chosen.tap();
    await expect(chosen).toBeChecked();

    const save = await hui.intercept("PUT", /\/__hui\/providers\/openai-codex$/);
    const check = await hui.intercept("POST", /\/__hui\/providers\/openai-codex\/test$/);
    await screen.getByRole("button", "Check model").tap();
    await save.arrived();
    expect(JSON.parse(save.request().body)).toEqual({ models: ["gpt-5.1-codex-mini"] });
    await save.answer(JSON.stringify({ ok: true }));
    await check.arrived();
    expect(JSON.parse(check.request().body)).toEqual({ model: "gpt-5.1-codex-mini" });
    await check.answer(JSON.stringify({ ok: true, latencyMs: 412 }));
    await expect(screen.getByText("Connection verified", { exact: true })).toBeVisible();
    await expect(screen.getByText("Verified in", { exact: true })).toBeVisible();
    await expect(screen.getByText("412 ms", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Start chatting")).toBeEnabled();
    await expect(screen.getByText("New sessions now use GPT-5.1 Codex Mini as their primary model.", { exact: true })).toBeVisible();
  } finally {
    await hui.api("PUT", "/__hui/settings", { ...settings, models: settings.models });
  }
});

test("leaving the model step after a completed sign-in saves exactly one model and shows the connection", { tags: ["SET-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const real = await hui.api<ProviderSnapshot>("GET", "/__hui/providers");
  const login: ProviderLogin = {
    id: "hui-fixture-signin", provider: "openai-codex", phase: "pending", flow: "browser",
    url: "https://example.com/sign-in", message: "Waiting for the browser sign-in.",
  };
  await hui.open("/settings/models");
  await expect(screen.getByRole("button", "Connect a provider")).toBeVisible();
  const pending = await hui.answerAll("GET", snapshotRoute(), snapshot(real.providers, login, "absent"));
  const start = await hui.intercept("POST", /\/__hui\/providers\/openai-codex\/login$/);
  await screen.getByRole("button", "Connect a provider").tap();
  await screen.getByRole("button", /^OpenAI /u).tap();
  await screen.getByRole("button", /^ChatGPT account Codex/u).tap();
  await start.arrived();
  await start.answer(JSON.stringify(login));
  await expect(screen.getByText("Complete sign-in in your browser, then return here.", { exact: true })).toBeVisible();

  const connected = await hui.answerAll("GET", snapshotRoute(), snapshot(real.providers, { ...login, phase: "complete" }, "connected"));
  await pending.stop();
  await expect(screen.getByText("Account connected. Choose a model when you want to test a reply.", { exact: true })).toBeVisible();

  const save = await hui.intercept("PUT", /\/__hui\/providers\/openai-codex$/);
  await screen.getByRole("button", "Close provider dialog").tap();
  await save.arrived();
  expect(JSON.parse(save.request().body)).toEqual({ models: ["gpt-5.1-codex"] });
  await save.answer(JSON.stringify({ ok: true }));
  await expect(screen.getByRole("button", "Close provider dialog")).toBeHidden();
  await expect(screen.getByText("OpenAI · ChatGPT account added. You can change its models any time.", { exact: true })).toBeVisible();
  await expect(screen.getByText("Provider configuration · 1 provider", { exact: true })).toBeVisible();
  await expect(screen.getByText("No model providers configured", { exact: true })).toBeHidden();
  await connected.stop();
});
