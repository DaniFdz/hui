/** A successful session action clears its toast by itself, while a refused copy stays until Dismiss (SHELL-028). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a successful session action clears its toast and a failed copy waits for Dismiss", { tags: ["SHELL-028"], platforms: ["web"] }, async ({ screen, hui }) => {
  const copy = async (title: string, choice: string) => {
    const menu = await hui.sessionMenu(title);
    await menu.getByText("Copy", { exact: true, visible: true }).tap();
    await menu.getByText(choice, { exact: true, visible: true }).tap();
  };

  const session = await hui.createSession({ title: "Action toast" });
  await hui.clipboard();
  await hui.open(`/sessions/${session.id}`);
  await copy("Action toast", "Session ID");
  await expect(screen.getByText("Session ID copied.", { exact: true })).toBeVisible();
  await expect.poll(() => screen.getByText("Session ID copied.", { exact: true }).count(), { timeout: 10_000 }).toBe(0);

  const refused = await hui.createSession({ title: "Action toast refused" });
  await hui.clipboard({ refuse: true });
  await hui.open(`/sessions/${refused.id}`);
  await copy("Action toast refused", "Session ID");
  const failed = screen.getByText("Could not copy to the clipboard.", { exact: true });
  await expect(failed).toBeVisible();
  await screen.getByRole("button", "Dismiss notification").tap();
  await expect(failed).toBeHidden();
});
