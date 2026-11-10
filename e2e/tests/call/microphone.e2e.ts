/**
 * Why a call could not open its microphone (CALL-004): the call view shows *Call failed* with the alert that says what
 * went wrong, and **Back to the chat** closes the view, leaving the chat as it was.
 *
 * A headless engine has no microphone at all, so this proves the missing one. A refused permission, a busy microphone
 * and a page the browser gives no microphone to (plain HTTP away from this machine, HUI's desktop app) are the same
 * view with their own sentence, and reaching them needs a real media session or a desktop app; the alert is read
 * against every sentence the call can show, so the check holds wherever it runs.
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

/** Every reason the call view gives for a microphone it could not have (src/lib/voice/voice.ts). */
const MICROPHONE = new RegExp([
  "Microphone access was denied\\. Allow it for this site in the browser's settings, then try again\\.",
  "No microphone was found\\. Connect one and try again\\.",
  "The microphone is busy or unavailable\\. Close other apps using it and try again\\.",
].join("|"), "u");

test("a call whose microphone does not open says why and Back to the chat leaves the chat as it was", { tags: ["CALL-004"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Juno", soul: "# Who I am\nA fixture bot.\n" })).bot;
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);
  const header = screen.getByTestId("chat-header");
  const transcript = screen.getByTestId("transcript");

  await hui.open(`/bots/${bot.id}`);
  // A fresh bot's chat has nothing to say yet: the empty state is the chat that a call must leave untouched.
  await expect(transcript.getByText("Say hi to Juno")).toBeVisible();
  const chat = await hui.textOf(transcript);

  await header.getByRole("button", "Call Juno").tap();
  const view = screen.getByLabel("Call with Juno");
  await expect(view).toBeVisible();
  await expect(view.getByText("Voice call")).toBeVisible();
  await expect(view.getByRole("heading", "Juno")).toBeVisible();
  // The call is still connecting when the microphone is refused, so it fails with the reason in an alert.
  await expect(view.getByText("Call failed")).toBeVisible();
  await expect(view.getByRole("alert")).toHaveText(MICROPHONE);

  // Back to the chat closes the call and leaves no card, no line and no message behind.
  await view.getByRole("button", "Back to the chat").tap();
  await expect(screen.getByLabel("Call with Juno")).toHaveCount(0);
  await expect(header).toBeVisible();
  await expect.poll(async () => hui.textOf(transcript)).toBe(chat);
  await expect(transcript.getByText(/^Call with Juno/u)).toHaveCount(0);
  await signedIn.stop();
});
