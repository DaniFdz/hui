/** The thinking picker's Autonomy choice decides routine steps on its own and stays with the session (CHAT-087). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Autonomous mode is chosen from the thinking picker and stays with the session", { tags: ["CHAT-087"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { id } = await hui.createSession({ title: "Autonomy" });
  await hui.open(`/sessions/${id}`);

  const picker = screen.getByLabel(/^Thinking: /u);
  await picker.tap();
  const autonomy = screen.getByLabel("Autonomy");
  await expect(autonomy).toBeVisible();
  await autonomy.getByText("Autonomous").tap();
  await expect(screen.getByLabel("Thinking: high, autonomous")).toBeVisible();

  await hui.reload();
  await expect(screen.getByLabel("Thinking: high, autonomous")).toBeVisible();
  await screen.getByLabel("Thinking: high, autonomous").tap();
  await screen.getByLabel("Autonomy").getByText("Ask me").tap();
  await expect(screen.getByLabel("Thinking: high")).toBeVisible();
});
