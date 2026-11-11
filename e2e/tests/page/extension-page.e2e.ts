/** An enabled extension's ui.page adds a sidebar destination and renders sandboxed; disabling removes it (PAGE-047). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("an extension page opens from the sidebar, calls its route through the bridge and closes when disabled", { tags: ["PAGE-047"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/extensions");
  await hui.flip(screen.getByRole("switch", "Enable Hello"));
  await expect(screen.getByTestId("extension-state")).toHaveText("Loaded");
  await expect(screen.getByTestId("extension-page-info")).toHaveText("Page · Hello page");

  await hui.open("/");
  // The destinations live in the sidebar navigation, which a phone keeps in its drawer.
  await hui.sessionList();
  await screen.getByTestId("nav-extension-page").filter({ hasText: "Hello page" }).tap();
  const page = screen.getByTestId("extension-page");
  await expect(page).toHaveAttribute("data-extension-page", "hello");
  const frame = screen.getByTestId("extension-page-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms");
  await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(await frame.getAttribute("src")).toBe("/__hui/ext-ui/hello/page.html");
  await expect(page).toHaveAttribute("data-page-title", "hello, Ada");

  await hui.open("/settings/extensions");
  await hui.flip(screen.getByRole("switch", "Enable Hello"));
  await expect(screen.getByTestId("extension-state")).toHaveText("Disabled");
  await hui.open("/ext/hello");
  await expect(screen.getByTestId("extension-page")).toContainText("This extension is disabled.");
});
