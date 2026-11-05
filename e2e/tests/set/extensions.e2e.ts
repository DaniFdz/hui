/** Settings → Extensions lists the installed gateway fixture, loads it, calls its route and withdraws it (SET-083). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Extensions = { extensions: { id: string; state: string; enabled: boolean }[] };

test("Settings enables and disables the installed gateway extension, and its routes follow", { tags: ["SET-086"], platforms: ["web"] }, async ({ screen, hui }) => {
  const row = () => screen.getByTestId("extension-row").filter({ hasText: "Hello" });
  const state = () => row().getByTestId("extension-state");
  const toggle = () => screen.getByRole("switch", "Enable Hello");

  await hui.open("/settings/extensions");
  await expect(screen.getByTestId("settings-page-title")).toHaveText("Extensions");
  await expect(state()).toHaveText("Disabled");
  await expect(screen.getByText(/Gateway extensions run inside the gateway/u)).toBeVisible();

  await hui.flip(toggle());
  await expect(state()).toHaveText("Loaded");
  const loaded = await hui.api<Extensions>("GET", "/__hui/ext");
  expect(loaded.extensions.find((extension) => extension.id === "hello")?.state).toBe("loaded");
  const greeting = await hui.api<{ greeting: string }>("GET", "/__hui/ext/hello/hello?name=Ada");
  expect(greeting.greeting).toBe("hello, Ada");

  await hui.reload();
  await expect(state()).toHaveText("Loaded");

  await hui.flip(toggle());
  await expect(state()).toHaveText("Disabled");
  const off = await hui.api<Extensions>("GET", "/__hui/ext");
  expect(off.extensions.find((extension) => extension.id === "hello")?.state).toBe("disabled");
});
