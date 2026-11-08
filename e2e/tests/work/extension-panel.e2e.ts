/** An enabled gateway extension's panel opens sandboxed in the Work pane, from Settings or the + menu, and its route answers (WORK-085). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Extensions = { extensions: { id: string; state: string }[] };

test("an enabled extension's panel opens sandboxed in the Work pane and calls its own route", { tags: ["WORK-085"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Extension panel", cwd: repository.path });

  // Enable it through the page, so the app learns a panel exists before the Work pane offers it.
  await hui.open("/settings/extensions");
  await hui.flip(screen.getByRole("switch", "Enable Hello"));
  await expect(screen.getByTestId("extension-state")).toHaveText("Loaded");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await expect(screen.getByRole("button", "Extension panel")).toBeVisible();
  await screen.getByRole("button", "Open Work view").tap();
  await screen.getByRole("menuitem").filter({ hasText: "Extension panel" }).tap();
  const panel = screen.getByTestId("extension-panel");
  await expect(panel).toHaveAttribute("data-extension-panel", "hello");
  const frame = screen.getByTestId("extension-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms");
  await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(await frame.getAttribute("src")).toBe("/__hui/ext-ui/hello/index.html");
  await expect(panel.getByTestId("extension-title")).toHaveText("hello, Ada");
  const style = await frame.getAttribute("style");
  expect(style).toMatch(/height:\d+px/u);
  expect(style).not.toContain("height:360px");

  await screen.getByTestId("nav-settings").tap();
  await screen.getByTestId("settings-page-link").filter({ hasText: "Extensions" }).tap();
  await screen.getByRole("button", "Open panel").tap();
  await expect(screen.getByTestId("extension-panel")).toHaveAttribute("data-extension-panel", "hello");

  const greeting = await hui.api<{ greeting: string }>("GET", "/__hui/ext/hello/hello?name=Ada");
  expect(greeting.greeting).toBe("hello, Ada");
  const listed = await hui.api<Extensions>("GET", "/__hui/ext");
  expect(listed.extensions.find((extension) => extension.id === "hello")?.state).toBe("loaded");

  await hui.reload();
  await expect(screen.getByTestId("extension-panel")).toHaveAttribute("data-extension-panel", "hello");

  await hui.api("PUT", "/__hui/ext/hello", { enabled: false });
});
