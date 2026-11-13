/** A bot sender's marker is named on the wide transcript's position rail; the rail itself stays off phones (CHAT-087). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name: "message_bot", input })).toString("base64url")}`;

test("the wide position rail names a bot's message by its sender handle", { tags: ["CHAT-087"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { bot } = await hui.api<{ bot: { id: string; handle: string } }>("POST", "/__hui/bots", {
    name: "Grace", soul: "# Who I am\nA fixture bot.\n",
  });
  const session = await hui.createSession({ title: "A bot on the rail" });
  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, call({ to: `@${bot.handle}`, message: call({ to: `agent:${session.id}`, message: "A message from Grace." }) }));
  await expect(screen.getByTestId("transcript").getByText("A message from Grace.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(screen.getByRole("button", { name: /^From @grace, marker \d+ of \d+$/u })).toBeVisible();
});
