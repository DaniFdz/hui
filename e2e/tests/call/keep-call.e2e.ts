/**
 * Keeping a call while using the rest of HUI (CALL-011): leaving the bot's chat for another session keeps the call in a
 * bar above the page's content, never over it, and the bar's *Return to the call with <bot>* goes back to the bot's
 * chat with the call view open.
 *
 * A headless engine has no microphone (CALL-004), so the call is the one that could not open it: HUI still holds it,
 * which is what the bar and the way back follow. The audio and the call's own state are not what this outcome is about.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** What the gateway answers when a ChatGPT login exists, which is what offers Call at all. */
const SIGNED_IN = JSON.stringify({
  model: "gpt-live-1-codex",
  voices: ["cove", "arbor", "breeze", "ember", "juniper", "maple", "sol", "spruce", "vale"],
  chatgpt: { signedIn: true, account: { name: "Personal" } },
  active: 0,
  limit: 2,
});

test("leaving a bot's chat keeps its call in a bar above another session, and Return to the call reopens the call view", { tags: ["CALL-011"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Juno", soul: "# Who I am\nA fixture bot.\n" })).bot;
  const notes = await hui.createSession({ title: "Call notes" });
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);

  await hui.open(`/bots/${bot.id}`);
  await screen.getByTestId("chat-header").getByRole("button", "Call Juno").tap();
  await expect(screen.getByLabel("Call with Juno")).toBeVisible();

  // Another session, reached inside the page: the call stays in a bar above that session's chat.
  await hui.sessionList();
  await screen.getByRole("tab", "Agents").tap();
  await hui.activateSidebarRow("Call notes");
  await expect(screen.getByLabel("Message")).toBeVisible();
  await expect.poll(() => hui.url()).toContain(`/sessions/${notes.id}`);
  const bar = screen.getByLabel("Call with Juno, minimized");
  await expect(bar).toBeVisible();
  // The bar takes a band of its own: the page's content starts below it instead of being covered.
  const above = (await bar.boundingBox())!;
  const below = (await screen.getByTestId("chat-header").boundingBox())!;
  expect(below.y).toBeGreaterThanOrEqual(above.y + above.height);

  // The bar's way back reopens the call over the bot's own chat.
  await bar.getByRole("button", "Return to the call with Juno").tap();
  await expect(screen.getByLabel("Call with Juno")).toBeVisible();
  await expect.poll(() => hui.url()).toContain(`/bots/${bot.id}`);
  await signedIn.stop();
});
