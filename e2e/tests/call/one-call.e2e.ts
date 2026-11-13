/**
 * One call at a time (CALL-012): during a call with one bot, Call on another bot refuses with the toast that names the
 * bot to hang up first, and the call that is up stays up.
 *
 * A headless engine has no microphone (CALL-004), so the first call is the one that could not open it: it is still the
 * call HUI holds, which is what the refusal is about. The gateway's own limit — two calls from other tabs or devices —
 * answers *2 calls are already running. Hang up before starting another.*, which needs two live calls and so a real
 * media session.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openBot } from "../bot/bot-panel.ts";

/** What the gateway answers when a ChatGPT login exists, which is what offers Call at all. */
const SIGNED_IN = JSON.stringify({
  model: "gpt-live-1-codex",
  voices: ["cove", "arbor", "breeze", "ember", "juniper", "maple", "sol", "spruce", "vale"],
  chatgpt: { signedIn: true, account: { name: "Personal" } },
  active: 0,
  limit: 2,
});

test("a second bot's Call refuses with the toast naming the bot to hang up first and the call that is up stays", { tags: ["CALL-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const juno = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Juno", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.api("POST", "/__hui/bots", { name: "Rhea", soul: "# Who I am\nAnother fixture bot.\n" });
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);

  await hui.open(`/bots/${juno.id}`);
  await screen.getByTestId("chat-header").getByRole("button", "Call Juno").tap();
  await expect(screen.getByLabel("Call with Juno")).toBeVisible();

  // Another bot's chat keeps Juno's call in sight above it, and its own Call refuses. The call lives in the page, so
  // the other chat is reached from the roster rather than by loading its address, which would end the call.
  await openBot(screen, hui, "Rhea");
  await expect(screen.getByLabel("Call with Juno, minimized")).toBeVisible();
  await screen.getByTestId("chat-header").getByRole("button", "Call Rhea").tap();
  await expect(screen.getByText("Hang up the call with Juno first.", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Call with Rhea")).toHaveCount(0);
  await expect(screen.getByLabel("Call with Juno, minimized")).toBeVisible();
  await signedIn.stop();
});
