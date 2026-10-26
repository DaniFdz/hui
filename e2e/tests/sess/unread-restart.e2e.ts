/** Unread marks outlive a gateway restart, whether a background run settled them or a person marked them (SESS-067). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a session marked unread by a background run that settled, or by hand, is still unread after a gateway restart", { tags: ["SESS-067"], platforms: ["web"] }, async ({ screen, hui }) => {
  const unread = (title: string) => screen.getByLabel(`${title}, status idle, tool durable, stage investigation, unread`);
  const settled = await hui.createSession({ title: "Settled elsewhere" });
  await hui.createSession({ title: "Marked by hand" });
  const here = await hui.createSession({ title: "Open meanwhile" });

  await hui.open(`/sessions/${here.id}`);
  await hui.sessionList();
  await expect(unread("Settled elsewhere")).toBeHidden();
  await hui.prompt(settled, "Hello from elsewhere");
  await expect(unread("Settled elsewhere")).toBeVisible();
  await hui.sessionMenu("Marked by hand");
  await screen.getByText("Mark as unread", { visible: true }).tap();
  await expect(screen.getByText("Marked as unread.")).toBeVisible();
  await expect(unread("Marked by hand")).toBeVisible();

  await hui.restartGateway();
  await hui.reload();
  await hui.sessionList();
  await expect(unread("Settled elsewhere")).toBeVisible();
  await expect(unread("Marked by hand")).toBeVisible();
  await expect(unread("Open meanwhile")).toBeHidden();
});