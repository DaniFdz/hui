/** An enabled gateway extension's panel opens sandboxed in the Work pane, from Settings or the + menu, and its route answers (WORK-083). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Extensions = { extensions: { id: string; state: string }[] };

test("an enabled extension's panel opens sandboxed in the Work pane and calls its own route", { tags: ["WORK-083"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Extension panel", cwd: repository.path });
  await hui.api("PUT", "/__hui/ext/hello", { enabled: true });

  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Extension panel");
  const panel = screen.getByTestId("extension-panel");
  await expect(panel).toHaveAttribute("data-extension-panel", "hello");
  const frame = screen.getByTestId("extension-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms");
  await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(await frame.getAttribute("src")).toBe("/__hui/ext-ui/hello/index.html");
  await expect(panel.getByTestId("extension-title")).toHaveText("hello, Ada");

  await screen.getByTestId("nav-settings").tap();
  await screen.getByTestId("settings-page-link").filter({ hasText: "Extensions" }).tap();
  await screen.getByRole("button", "Open panel").tap();
  await expect(screen.getByTestId("extension-panel")).toHaveAttribute("data-extension-panel", "hello");

  const greeting = await hui.api<{ greeting: string }>("GET", "/__hui/ext/hello/hello?name=Ada");
  expect(greeting.greeting).toBe("hello, Ada");
  const listed = await hui.api<Extensions>("GET", "/__hui/ext");
  expect(listed.extensions.find((extension) => extension.id === "hello")?.state).toBe("loaded");

  await hui.api("PUT", "/__hui/ext/hello", { enabled: false });
});
