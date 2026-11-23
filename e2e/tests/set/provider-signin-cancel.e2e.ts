/** Cancelling a provider sign-in through its button or by closing the waiting dialog adds no card (SET-035). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { ProviderLogin, ProviderSnapshot } from "../../../src/api/schema/providers.ts";

const snapshot = (providers: ProviderSnapshot["providers"], login: ProviderLogin) => JSON.stringify({ providers, login });

/**
 * `hui.answerAll` stops by pattern source, so a standing answer spells the snapshot route with one more empty group
 * than the last one; every spelling matches the same URL and stopping one leaves the next standing.
 */
let spellings = 0;
const snapshotRoute = () => new RegExp(`\\/__hui\\/providers${"(?:)".repeat(spellings++)}$`);

test("cancelling a ChatGPT sign-in, or closing its waiting dialog, adds no card", { tags: ["SET-035"], platforms: ["web"] }, async ({ screen, hui }) => {
  const real = await hui.api<ProviderSnapshot>("GET", "/__hui/providers");
  const login: ProviderLogin = {
    id: "hui-fixture-signin", provider: "openai-codex", phase: "pending", flow: "browser",
    url: "https://example.com/sign-in", message: "Waiting for the browser sign-in.",
  };
  const stopped: ProviderLogin = { ...login, phase: "cancelled", reason: "cancelled" };
  const waiting = () => expect(screen.getByText(/^Waiting for sign-in…/u)).toBeVisible();
  const startSignIn = async () => {
    const start = await hui.intercept("POST", /\/__hui\/providers\/openai-codex\/login$/);
    await screen.getByRole("button", "Connect a provider").tap();
    await screen.getByRole("button", /^OpenAI /u).tap();
    await screen.getByRole("button", /^ChatGPT account Codex/u).tap();
    await start.arrived();
    await start.answer(JSON.stringify(login));
    await waiting();
  };

  await hui.open("/settings/models");
  await expect(screen.getByText("No model providers configured", { exact: true })).toBeVisible();
  let pending = await hui.answerAll("GET", snapshotRoute(), snapshot(real.providers, login));
  await startSignIn();

  const cancel = await hui.intercept("DELETE", /\/__hui\/providers\/login\/[^/]+$/);
  await screen.getByRole("button", "Cancel sign-in").tap();
  await cancel.arrived();
  expect(cancel.request().url).toContain("/__hui/providers/login/hui-fixture-signin");
  const cancelled = await hui.answerAll("GET", snapshotRoute(), snapshot(real.providers, stopped));
  await pending.stop();
  await cancel.answer(JSON.stringify({ ok: true }));
  await expect(screen.getByText("Sign-in cancelled", { exact: true })).toBeVisible();
  await expect(screen.getByText("Sign-in stopped before it finished. Start again when you are ready.", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Close provider dialog").tap();
  await expect(screen.getByText("No model providers configured", { exact: true })).toBeVisible();
  await expect(screen.getByText("Provider configuration · 0 providers", { exact: true })).toBeHidden();
  await expect(screen.getByText("OpenAI · ChatGPT account", { exact: true })).toBeHidden();
  await cancelled.stop();

  pending = await hui.answerAll("GET", snapshotRoute(), snapshot(real.providers, login));
  await startSignIn();
  await screen.getByRole("button", "Close provider dialog").tap();
  await expect(screen.getByText("Sign-in is still waiting. Close and cancel it?", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Close provider dialog")).toBeVisible();
  await screen.getByRole("button", "Keep waiting").tap();
  await expect(screen.getByText("Sign-in is still waiting. Close and cancel it?", { exact: true })).toBeHidden();
  await waiting();

  await screen.getByRole("button", "Close provider dialog").tap();
  const confirm = await hui.intercept("DELETE", /\/__hui\/providers\/login\/[^/]+$/);
  await screen.getByRole("button", "Cancel sign-in").tap();
  await confirm.arrived();
  expect(confirm.request().url).toContain("/__hui/providers/login/hui-fixture-signin");
  const closed = await hui.answerAll("GET", snapshotRoute(), snapshot(real.providers, stopped));
  await pending.stop();
  await confirm.answer(JSON.stringify({ ok: true }));
  await expect(screen.getByRole("button", "Close provider dialog")).toBeHidden();
  await expect(screen.getByText("No model providers configured", { exact: true })).toBeVisible();
  await expect(screen.getByText("OpenAI · ChatGPT account", { exact: true })).toBeHidden();
  await closed.stop();
});
