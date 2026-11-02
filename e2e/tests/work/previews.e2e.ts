/** Images preview while binary and oversized text files explain themselves and offer Download (WORK-049). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
  "base64",
);

test("images preview while binary and oversized text files explain themselves and offer Download", { tags: ["WORK-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  await writeFile(join(hui.workspace, "pixel.png"), PNG);
  await writeFile(join(hui.workspace, "blob.bin"), Buffer.from([0, 1, 2, 3, 0]));
  await writeFile(join(hui.workspace, "huge.txt"), "x".repeat(2 * 1024 * 1024 + 1));
  const session = await hui.createSession({ title: "Previews" });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", { name: /^Files/u }).tap();

  await screen.getByText("pixel.png", { exact: true }).tap();
  await expect(screen.getByRole("img", "pixel.png")).toBeVisible();

  await screen.getByText("blob.bin", { exact: true }).tap();
  await expect(screen.getByText("Binary file: it has no text to show here.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Download").first()).toBeVisible();

  await screen.getByText("huge.txt", { exact: true }).tap();
  await expect(screen.getByText(/^Too large to edit here \(/u)).toBeVisible();
  await expect(screen.getByRole("button", "Download").first()).toBeVisible();
});
