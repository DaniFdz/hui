/** A session menu disables the session's current group and Conversation as Markdown for any other session (SESS-072). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a session menu disables the current group and Conversation as Markdown for another session", { tags: ["SESS-072"], platforms: ["web"] }, async ({ hui }) => {
  const open = await hui.createSession({ title: "Open session" });
  await hui.createSession({ title: "Other session" });
  await hui.open(`/sessions/${open.id}`);

  await hui.sessionList();
  const others = await hui.sessionMenu("Other session");
  await others.getByText("Move to group", { exact: true, visible: true }).tap();
  const current = others.getByTestId("session-move-group").filter({ hasText: "OTHER" });
  await expect(current).toHaveAttribute("aria-disabled", "true");
  await others.getByText("Copy", { exact: true, visible: true }).tap();
  await expect(others.getByTestId("session-copy-markdown")).toHaveAttribute("aria-disabled", "true");
  // The first menu would intercept the pointer over the other row.
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");

  await hui.sessionList();
  const own = await hui.sessionMenu("Open session");
  await own.getByText("Copy", { exact: true, visible: true }).tap();
  await expect(own.getByTestId("session-copy-markdown")).toHaveAttribute("aria-disabled", "false");
});
