/** The browser's origin allowlist saves from Settings → Tools and survives a reload (SET-090). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the browser's allowed origins save and persist", { tags: ["SET-090"], platforms: ["web"] }, async ({ screen, hui }) => {
  const origins = screen.getByLabel("Allowed origins");

  await hui.open("/settings/tools");
  await expect(origins).toHaveValue("");

  await origins.fill("example.com\n*.docs.example.com");
  await screen.getByRole("button", "Save origins").click();
  await hui.reload();
  await expect(screen.getByLabel("Allowed origins")).toHaveValue("example.com\n*.docs.example.com");
  await expect(screen.getByText("2 patterns.", { exact: false })).toBeVisible();

  await screen.getByLabel("Allowed origins").fill("");
  await screen.getByRole("button", "Save origins").click();
  await hui.reload();
  await expect(screen.getByLabel("Allowed origins")).toHaveValue("");
  await expect(screen.getByText("Empty lets agents browse anywhere", { exact: false })).toBeVisible();
});
