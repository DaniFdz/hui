/** Settings → Privacy & Security shows the access model, the API guard, the transport, the credential sources with their values redacted and what diagnostics exclude and keep, and says why a read of PI or the gateway failed (SET-073). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Privacy & Security shows its boundaries, and a failed read of PI or the gateway shows the reason with Retry", { tags: ["SET-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const pi = await hui.api<{ model: { authenticated: string[] } }>("GET", "/__hui/pi");
  const health = await hui.api<{ transport: string }>("GET", "/__hui/health");
  const { retention } = await hui.api<{ retention: { maximum: number } }>("GET", "/__hui/observability");
  const sources = pi.model.authenticated.length ? pi.model.authenticated.join(", ") : "No provider names reported.";
  const retry = screen.getByRole("button", "Retry");

  const piRead = await hui.intercept("GET", /\/__hui\/pi$/u);
  await hui.open("/settings/security");
  await piRead.reject(500, "PI settings are unreadable");
  await expect(screen.getByText(/^PI settings are unreadable/u)).toBeVisible();
  await retry.tap();
  await expect(screen.getByText(sources)).toBeVisible();
  await expect(screen.getByText(/^PI settings are unreadable/u)).toBeHidden();

  await expect(screen.getByText("Full Access")).toBeVisible();
  await expect(screen.getByText("x-hui: 1")).toBeVisible();
  await expect(screen.getByText(health.transport)).toBeVisible();
  await expect(screen.getByText(String(pi.model.authenticated.length))).toBeVisible();
  await expect(screen.getByText("Values redacted")).toBeVisible();
  await expect(screen.getByText("Prompts, transcript content, tool arguments/output and secret values.")).toBeVisible();
  await expect(screen.getByText(`${retention.maximum} events max`)).toBeVisible();
  await expect(screen.getByText("Activity is held in memory for the current gateway process only.")).toBeVisible();

  const healthRead = await hui.intercept("GET", /\/__hui\/health$/u);
  await hui.reload();
  await healthRead.reject(500, "the gateway is unreadable");
  await expect(screen.getByText(/^the gateway is unreadable/u)).toBeVisible();
  await retry.tap();
  await expect(screen.getByText(health.transport)).toBeVisible();
  await expect(screen.getByText(/^the gateway is unreadable/u)).toBeHidden();
});
